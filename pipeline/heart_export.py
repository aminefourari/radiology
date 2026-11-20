"""Runs inside Blender: export the Z-Anatomy heart for the electrophysiology page, in RAS mm.

Blender -b Startup.blend --python pipeline/heart_export.py -- <out_dir>

Writes <out_dir>/heart_raw.glb (chambers, papillary muscles, valve leaflets; one mesh each) and
<out_dir>/heart_raw.json ({"chambers": {name: {"verts": [[x,y,z]...], "tris": [[a,b,c]...]}}}).
The four chamber meshes are thick-walled shells (endocardial and epicardial surface, open at the
valve rings), ~2.8k vertices each, so they are used undecimated for both rendering and simulation.
"""
import json
import os
import sys

import bmesh
import bpy
import numpy as np

out_dir = sys.argv[sys.argv.index("--") + 1]
CHAMBERS = ["Right atrium", "Left atrium", "Right ventricle", "Left ventricle"]


def all_objects(c):
    yield from c.objects
    for k in c.children:
        yield from all_objects(k)


def ras_triangles(o):
    """Triangulated world-space mesh in RAS mm (Blender metres, body faces -Y, right at -X)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.verts.ensure_lookup_table()
    m = o.matrix_world
    v = np.array([list(m @ p.co) for p in bm.verts]) * 1000 * [-1, -1, 1]
    f = [[p.verts[0].index, p.verts[1].index, p.verts[2].index] for p in bm.faces]
    bm.free()
    return v, f


def main():
    os.makedirs(out_dir, exist_ok=True)
    out = bpy.data.collections.new("heart_export")
    bpy.context.scene.collection.children.link(out)
    raw = {}
    for o in all_objects(bpy.data.collections["Heart"]):
        if o.type != "MESH" or len(o.data.vertices) < 50:
            continue
        v, f = ras_triangles(o)
        key = o.name.lower().replace(" ", "_")
        if o.name in CHAMBERS:
            raw[key] = {"verts": np.round(v, 2).tolist(), "tris": f}
        me = bpy.data.meshes.new(key)
        me.from_pydata(v.tolist(), [], f)
        me.validate()
        ob = bpy.data.objects.new(key, me)
        out.objects.link(ob)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in out.objects:
        ob.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(out_dir, "heart_raw.glb"), export_format="GLB",
                              use_selection=True, export_apply=True, export_yup=False,
                              export_materials="NONE", export_normals=False, export_texcoords=False,
                              export_extras=False, export_animations=False)
    json.dump({"chambers": raw}, open(os.path.join(out_dir, "heart_raw.json"), "w"))
    print("heart export", {k: len(r["verts"]) for k, r in raw.items()})


main()
