"""Runs inside Blender: export Z-Anatomy as one GLB per atlas system, in RAS mm, plus metadata.

Blender -b Startup.blend --python pipeline/atlas_export.py -- <out_dir> <bp3d_stl_dir> <TA2.csv> <budgets.json>

Z-Anatomy (Blender 5.2 check): world units are metres, the body faces -Y, its right side is at -X.
Top-level numbered collections are the systems; ".j"/".g"/".i" objects are label/group helpers.
"""
import json
import os
import re
import sys

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from atlaslib import fit_axes, slug  # noqa: E402

out_dir, bp3d_dir, ta2_path, budgets_path = sys.argv[sys.argv.index("--") + 1:]
BUDGETS = json.load(open(budgets_path))  # system -> target triangles

TOP = {
    "1: Skeletal system": "skeleton", "3: Joints": "joints", "4: Muscular system": "muscles",
    "5: Cardiovascular system": "vessels", "6: Lymphoid organs": "lymph",
    "7: Nervous system & Sense organs": "nervous", "8: Visceral systems": None,  # split below
}
VISCERAL = [("Respiratory system", "respiratory"), ("Bronchi", "respiratory"), ("Lungs", "respiratory"),
            ("Urinary system", "urinary"), ("Genital systems'", "genital"), ("Endocrine glands", "endocrine")]
# Non-commercial parts (Z-Anatomy credits): inner ear (Dundee, CC BY-NC-SA) and the kidney by Lissie
# Cowley (CC BY-NC). The kidney is replaced by BodyParts3D's below.
EXCLUDE = re.compile(r"(?i)^(cochlea|vestibule|semicircular|.*\bduct of cochlea|.*labyrinth|malleus|incus|stapes"
                     r"|kidney|renal pelvis)\b")
HELPER = re.compile(r"\.[a-z]$")
SIDE = re.compile(r"\.[lr]$")

# Colours: Z-Anatomy materials where they carry meaning, else by tissue.
MAT_COLOR = {"Artery": "#b8302c", "Pulmonary vein": "#b8302c", "Vein": "#33589e", "Pulmonary artery": "#33589e",
             "Cartilage": "#c3d3da", "Ligament": "#d9d3c2", "Articular capsule": "#d9d3c2", "Tendon": "#e3dccb",
             "Fascia": "#d9cbb8", "Bursa": "#c9d8e0", "Gland": "#d4ab78", "White matter": "#ece4d8",
             "Cerebellum": "#d6a08f", "Teeth-roots": "#efe6cf"}
NAME_COLOR = [(r"liver", "#7a2f25"), (r"spleen", "#6c2b3b"), (r"kidney", "#87392c"), (r"suprarenal", "#c99c48"),
              (r"pancrea", "#d8ae76"), (r"gallbladder|bile", "#4c7739"), (r"lung|bronch|trachea|larynx", "#e4a9a6"),
              (r"heart|atrium|ventricle of heart|myocard", "#a63a33"), (r"thyroid", "#a4474a"),
              (r"stomach|duoden|oesophag|esophag|jejun|ileum|colon|caecum|cecum|rectum|appendix", "#c4766c"),
              (r"bladder|ureter|urethra", "#d6b493"), (r"prostate|testis|uterus|ovary", "#b5766a")]
SYSTEM_COLOR = {"skeleton": "#e2d5bb", "joints": "#d9d3c2", "muscles": "#a3463c", "vessels": "#b8302c",
                "lymph": "#7fa05a", "nervous": "#ecd28a", "respiratory": "#e4a9a6", "digestive": "#c4766c",
                "urinary": "#d6b493", "genital": "#b5766a", "endocrine": "#c99c48"}
NERVOUS_ORGAN = re.compile(r"(?i)brain|cerebr|gyrus|lobe|pole|sulcus|nucleus|thalam|cortex|pons|medulla|mesenceph|"
                           r"ventric|plexus|falx|tentorium|dura|eye|retina|lens|cornea")


def latin_table(path):
    t = {}
    for line in open(path, encoding="utf-8-sig"):
        f = line.strip().strip('"').split(";")
        if len(f) > 2:
            t.setdefault(f[1].strip().lower(), f[2].strip())
    return t


def system_of(o):
    for c in bpy.context.scene.collection.children:
        if c.name in TOP and o.name in c.objects:
            if TOP[c.name]:
                return TOP[c.name]
            names = {u.name for u in o.users_collection}
            return next((s for coll, s in VISCERAL if coll in names), "digestive")
    return None


def color_of(o, system, base):
    """Vessel materials first, then organ names (an organ's material may be e.g. 'Ligament'), then materials."""
    m = o.active_material
    if m and system == "vessels" and m.name in MAT_COLOR:
        return MAT_COLOR[m.name]
    for pat, c in NAME_COLOR:
        if re.search(pat, base, re.I):
            return c
    if m and m.name in MAT_COLOR:
        return MAT_COLOR[m.name]
    if system == "nervous" and NERVOUS_ORGAN.search(base):
        return "#d9a493"
    return SYSTEM_COLOR[system]


def read_stl(path):
    b = open(path, "rb").read()
    n = int.from_bytes(b[80:84], "little")
    tri = np.frombuffer(b[84:84 + n * 50], dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]))["v"]
    verts, inv = np.unique(tri.reshape(-1, 3).round(4), axis=0, return_inverse=True)
    return verts.astype(float), inv.reshape(-1, 3)


def world_box_mm(o):
    v = np.array([o.matrix_world @ c.co for c in o.data.vertices]) * 1000
    return v.min(0), v.max(0)


def stl_box(fma):
    v, _ = read_stl(os.path.join(bp3d_dir, f"{fma}.stl"))
    return v.min(0), v.max(0)


def ras_mesh(name, verts_mm_blender, faces):
    """New mesh object in RAS mm from Blender-axis mm vertices (180 deg about z: no mirroring)."""
    v = np.asarray(verts_mm_blender, float) * [-1, -1, 1]
    me = bpy.data.meshes.new(name)
    me.from_pydata(v.tolist(), [], [list(map(int, f)) for f in faces])
    me.validate()
    return bpy.data.objects.new(name, me)


def main():
    latin = latin_table(ta2_path)
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.collections.new("atlas_export")
    bpy.context.scene.collection.children.link(out)
    items, seen, done = [], set(), set()

    def add(obj, system, en_base, side, color):
        key = slug(en_base + {"left": ".l", "right": ".r"}.get(side, ""))
        n = 2
        while key in seen:
            key, n = f"{slug(en_base)}_{n}" + (f"_{side}" if side else ""), n + 1
        seen.add(key)
        obj.name = obj.data.name = key
        out.objects.link(obj)
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(obj.data)
        area = sum(f.calc_area() for f in bm.faces)
        bm.free()
        v = np.array([p.co for p in obj.data.vertices])
        c = v.mean(0)
        anchor = v[np.argmin(((v - c) ** 2).sum(1))]
        items.append({"key": key, "system": system,
                      "en": en_base + (f" ({side})" if side else ""), "la": latin.get(en_base.lower()),
                      "color": color, "anchor": [round(float(a)) for a in anchor],
                      "centroid": [round(float(a)) for a in c],
                      "size": round(area), "tris": len(obj.data.polygons), "obj": obj})

    for c in bpy.context.scene.collection.children:
        if c.name not in TOP:
            continue
        for o in c.objects:
            if o.type not in ("MESH", "CURVE") or o.name in done or (HELPER.search(o.name) and not SIDE.search(o.name)):
                continue
            done.add(o.name)
            base = SIDE.sub("", o.name).strip("()[] ")
            if EXCLUDE.search(base):
                continue
            system = system_of(o)
            me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), depsgraph=dg)
            if len(me.polygons) < 4:
                bpy.data.meshes.remove(me)
                continue
            me.transform(o.matrix_world)
            v = np.array([p.co for p in me.vertices]) * 1000
            f = [list(p.vertices) for p in me.polygons]
            bpy.data.meshes.remove(me)
            side = {".l": "left", ".r": "right"}.get(o.name[-2:])
            add(ras_mesh(o.name, v, f), system, base, side, color_of(o, system, base))

    # BodyParts3D kidneys, placed by a per-axis fit of BodyParts3D boxes onto Z-Anatomy's.
    pairs = [("FMA7197", "Liver"), ("FMA7196", "Spleen"), ("FMA24474", "Femur.r"), ("FMA24475", "Femur.l")]
    src = np.concatenate([np.array(stl_box(f)) for f, _ in pairs])
    dst = np.concatenate([np.array(world_box_mm(bpy.data.objects[n])) for _, n in pairs])
    fit = fit_axes(src, dst)
    a = np.array([fit[k][0] for k in "xyz"])
    b = np.array([fit[k][1] for k in "xyz"])
    print("BodyParts3D -> Z-Anatomy fit", fit)
    for fma, side in (("FMA7204", "right"), ("FMA7205", "left")):
        v, f = read_stl(os.path.join(bp3d_dir, f"{fma}.stl"))
        add(ras_mesh("Kidney", v * a + b, f), "urinary", "Kidney", side, "#87392c")

    # Decimate each system to its budget; small parts keep at least 80 triangles.
    for system in sorted({i["system"] for i in items}):
        group = [i for i in items if i["system"] == system]
        total = sum(i["tris"] for i in group)
        ratio = min(1.0, BUDGETS[system] / total)
        for i in group:
            r = max(ratio, min(1.0, 80 / max(i["tris"], 1)))
            if r < 1:
                m = i["obj"].modifiers.new("dec", "DECIMATE")
                m.ratio = r
        bpy.ops.object.select_all(action="DESELECT")
        for i in group:
            i["obj"].select_set(True)
        bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, f"{system}.glb"), export_format="GLB",
                                  use_selection=True, export_apply=True, export_yup=False,
                                  export_materials="NONE", export_normals=False, export_texcoords=False,
                                  export_extras=False, export_animations=False)
        print(system, "parts", len(group), "tris", total, "->", round(total * ratio))

    for i in items:
        del i["obj"], i["tris"]
    json.dump({"structures": items, "kidneyFit": fit}, open(os.path.join(out_dir, "meta.json"), "w"))


main()
