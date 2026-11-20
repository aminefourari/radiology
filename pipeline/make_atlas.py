"""Z-Anatomy 3D atlas for the CT page.

  make_atlas.py export   Blender export -> site/atlas/<system>.glb + index.json (needs data/zanatomy, data/bp3d)
  make_atlas.py map      draft site->atlas links into data/zanatomy/atlas_map.draft.json (review by hand
                         into pipeline/atlas_map.json)
  make_atlas.py link     validate pipeline/atlas_map.json and copy it into site/atlas/index.json
  make_atlas.py fit site/cases/<id> ...   per-case CT->atlas plane fit -> atlaslink.json
"""
import json
import os
import re
import subprocess
import sys

import gzip

import numpy as np

from atlaslib import case_centroids, draft_map, fit_axes, part_parents, validate_map

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, "pipeline")
ZA = os.path.join(ROOT, "data", "zanatomy")
ATLAS = os.path.join(ROOT, "site", "atlas")
BLENDER = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")

# Target triangles per system after decimation. Sized so each region's defaults stay <= 6 MB.
BUDGETS = {"skeleton": 480_000, "joints": 100_000, "muscles": 420_000, "vessels": 300_000, "lymph": 40_000,
           "nervous": 320_000, "respiratory": 110_000, "digestive": 180_000, "urinary": 30_000,
           "genital": 20_000, "endocrine": 11_000}
REGION_DEFAULTS = {"head": ["nervous", "vessels"],  # the skull would hide the brain
                   "neck": ["skeleton", "vessels", "respiratory", "endocrine"],
                   "chest": ["skeleton", "vessels", "respiratory"],
                   "abdomen-pelvis": ["skeleton", "vessels", "digestive", "urinary"],
                   "lower-limb": ["skeleton", "muscles", "vessels"]}
NAMES = {
    "skeleton": ["Skeleton", "Skelett", "Esqueleto", "الهيكل العظمي", "Squelette", "Scheletro", "Skelet"],
    "joints": ["Joints & ligaments", "Gelenke & Bänder", "Articulaciones y ligamentos", "المفاصل والأربطة",
               "Articulations & ligaments", "Articolazioni e legamenti", "Gewrichten & banden"],
    "muscles": ["Muscles", "Muskeln", "Músculos", "العضلات", "Muscles", "Muscoli", "Spieren"],
    "vessels": ["Heart & vessels", "Herz & Gefäße", "Corazón y vasos", "القلب والأوعية", "Cœur & vaisseaux",
                "Cuore e vasi", "Hart & vaten"],
    "lymph": ["Lymphatic", "Lymphsystem", "Linfático", "الجهاز اللمفاوي", "Lymphatique", "Linfatico", "Lymfestelsel"],
    "nervous": ["Nervous system", "Nervensystem", "Sistema nervioso", "الجهاز العصبي", "Système nerveux",
                "Sistema nervoso", "Zenuwstelsel"],
    "respiratory": ["Respiratory", "Atmung", "Respiratorio", "الجهاز التنفسي", "Respiratoire", "Respiratorio",
                    "Ademhaling"],
    "digestive": ["Digestive", "Verdauung", "Digestivo", "الجهاز الهضمي", "Digestif", "Digerente", "Spijsvertering"],
    "urinary": ["Urinary", "Harnwege", "Urinario", "الجهاز البولي", "Urinaire", "Urinario", "Urinewegen"],
    "genital": ["Reproductive", "Geschlechtsorgane", "Reproductor", "الجهاز التناسلي", "Génital", "Genitale",
                "Voortplanting"],
    "endocrine": ["Endocrine glands", "Hormondrüsen", "Glándulas endocrinas", "الغدد الصماء", "Glandes endocrines",
                  "Ghiandole endocrine", "Hormoonklieren"],
}
# Drawn only on request: sheets that cover the organs a CT reader looks for.
OFF = re.compile(r"omentum|mesocolon|meso_appendix|taenia|peritoneum|gingiva|^pleura$")
LANGS = ["en", "de", "es", "ar", "fr", "it", "nl"]
LICENSE = """3D atlas models in this folder: CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/).

Derived from:
- Z-Anatomy, the libre 3D atlas of anatomy (Gauthier Kervyn et al.), CC BY-SA 4.0
  https://github.com/Z-Anatomy/Models-of-human-anatomy
- BodyParts3D, The Database Center for Life Science (DBCLS), CC BY-SA 2.1 Japan
  https://dbarchive.biosciencedbc.jp/en/bodyparts3d/ (kidneys from the STL set at
  https://github.com/Kevin-Mattheus-Moerman/BodyParts3D)

Z-Anatomy also includes and adapts, and these files keep:
- "Cranial Nerves and Foramina" by the University of Dundee, CAHID, CC BY 4.0
- "Brainder" and "White matter" models from the University of Washington

Changes: converted to RAS millimetres, simplified, compressed (meshopt). Left out because they are
non-commercial in Z-Anatomy, with neighbouring parts of uncertain origin: the inner ear, auditory ossicles,
tympanic membrane and auditory tube (University of Dundee, CC BY-NC-SA) and the kidney by Lissie Cowley
(CC BY-NC) with the intrarenal and segmental renal vessels; the kidneys are BodyParts3D's.
"""


def export():
    raw = os.path.join(ZA, "out")
    os.makedirs(raw, exist_ok=True)
    os.makedirs(ATLAS, exist_ok=True)
    budgets = os.path.join(raw, "budgets.json")
    json.dump(BUDGETS, open(budgets, "w"))
    subprocess.run([BLENDER, "-b", os.path.join(ZA, "Z-Anatomy", "Startup.blend"), "--python",
                    os.path.join(HERE, "atlas_export.py"), "--", raw, os.path.join(ROOT, "data", "bp3d"),
                    os.path.join(ZA, "TA2.csv"), budgets], check=True)
    meta = json.load(open(os.path.join(raw, "meta.json")))
    systems = []
    for key in NAMES:
        src, dst = os.path.join(raw, f"{key}.glb"), os.path.join(ATLAS, f"{key}.glb")
        if not os.path.exists(src):
            continue
        subprocess.run(["npx", "-y", "gltfpack@1.3.0", "-i", src, "-o", dst, "-cc", "-kn", "-vp", "16"], check=True)
        systems.append({"key": key, "names": dict(zip(LANGS, NAMES[key])), "file": f"{key}.glb",
                        "bytes": os.path.getsize(dst)})
    index_path = os.path.join(ATLAS, "index.json")
    links = json.load(open(index_path)).get("links", {}) if os.path.exists(index_path) else {}
    for s in meta["structures"]:
        if not s["la"]:
            del s["la"]
        if OFF.search(s["key"]):
            s["off"] = True
    index = {"systems": systems, "regionDefaults": REGION_DEFAULTS, "structures": meta["structures"], "links": links}
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(ATLAS, "LICENSE.txt"), "w").write(LICENSE)
    for region, keys in REGION_DEFAULTS.items():
        mb = sum(s["bytes"] for s in systems if s["key"] in keys) / 1e6
        print(f"{region}: {mb:.2f} MB")


def load_index():
    return json.load(open(os.path.join(ATLAS, "index.json"), encoding="utf-8"))


def site_structures():
    return json.load(open(os.path.join(HERE, "structures.json"), encoding="utf-8"))["structures"]


def draft():
    out = os.path.join(ZA, "atlas_map.draft.json")
    m = draft_map(site_structures(), load_index()["structures"])
    json.dump(m, open(out, "w"), indent=1)
    print(f"{len(m)} drafted -> {out}")


def link():
    index = load_index()
    m = json.load(open(os.path.join(HERE, "atlas_map.json"), encoding="utf-8"))
    validate_map(m, {s["key"] for s in site_structures()}, {s["key"] for s in index["structures"]})
    index["links"] = m
    # 7-language names of linked site structures, for 3D labels and popups whatever case is open.
    index["siteNames"] = {st["key"]: st["names"] for st in site_structures() if st["key"] in m}
    parents = part_parents(site_structures(), m)
    for s in index["structures"]:
        s.pop("parent", None)
        if s["key"] in parents:
            s["parent"] = parents[s["key"]]
    with open(os.path.join(ATLAS, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(m)} links")


def landmarks(meta, index):
    """([all], [bones]) as (site key, ct structure id, atlas point) for linked structures.

    Skips unsided site structures whose atlas parts lie on both sides of the body (a limb case may show one
    leg), since their atlas mean sits on the midline.
    """
    atlas = {s["key"]: s for s in index["structures"]}
    out, bones = [], []
    for s in meta["structures"]:
        parts = [atlas[k] for k in index["links"].get(s["key"], [])]
        if not parts:
            continue
        xs = [p["centroid"][0] for p in parts]
        if max(xs) - min(xs) > 100:
            continue
        lm = (s["key"], s["id"], np.mean([p["centroid"] for p in parts], 0))
        out.append(lm)
        if all(p["system"] == "skeleton" for p in parts):
            bones.append(lm)
    return out, bones


def fit(case_dirs):
    index = load_index()
    for d in case_dirs:
        meta = json.load(open(os.path.join(d, "meta.json"), encoding="utf-8"))
        X, Y, Z = meta["dims"]
        with gzip.open(os.path.join(d, "labels.bin.gz")) as f:
            labels = np.frombuffer(f.read(), np.uint8).reshape(Z, Y, X).transpose(2, 1, 0)
        from scipy import ndimage
        boxes = ndimage.find_objects(labels)
        cut = {i + 1 for i, b in enumerate(boxes)  # cut off by the scan edge: centroid is not the organ's
               if b and any(sl.start == 0 or sl.stop == n for sl, n in zip(b, labels.shape))}
        every, bones = landmarks(meta, index)
        cents = case_centroids(labels, meta["spacing"], [i for _, i, _ in every if i not in cut])

        def fit_of(lms):
            used = [(k, cents[i], a) for k, i, a in lms if i in cents]
            return fit_axes([c for _, c, _ in used] or np.zeros((0, 3)), [a for _, _, a in used] or np.zeros((0, 3))), used

        # Bones are the steadiest landmarks; an axis they don't span falls back to every linked structure.
        result, used = fit_of(bones)
        if None in result.values():
            more, used_all = fit_of(every)
            result = {k: result[k] or more[k] for k in "xyz"}
            used = used_all
        result["landmarks"] = [k for k, _, _ in used]
        result["keys"] = [s["key"] for s in meta["structures"]]  # what "Show in CT" can open this case for
        json.dump(result, open(os.path.join(d, "atlaslink.json"), "w"), separators=(",", ":"))
        print(meta["id"], {k: result[k] for k in "xyz"}, len(used), "landmarks")


HEART = os.path.join(ROOT, "site", "heart")
CHAMBERS = ["right_atrium", "left_atrium", "right_ventricle", "left_ventricle"]  # chamber ids 0..3


def heart():
    """Heart mesh (site/heart/heart.glb) and simulation graph (site/heart/heart-graph.json)."""
    import numpy as np
    from heartlib import boundary_loops, components, nearest_links, snap_landmarks, vertex_area

    raw = os.path.join(ROOT, "data", "heart")
    subprocess.run([BLENDER, "-b", os.path.join(ZA, "Z-Anatomy", "Startup.blend"), "--python",
                    os.path.join(HERE, "heart_export.py"), "--", raw], check=True)
    os.makedirs(HEART, exist_ok=True)
    subprocess.run(["npx", "-y", "gltfpack@1.3.0", "-i", os.path.join(raw, "heart_raw.glb"),
                    "-o", os.path.join(HEART, "heart.glb"), "-cc", "-kn", "-vp", "16"], check=True)
    ch = json.load(open(os.path.join(raw, "heart_raw.json")))["chambers"]
    lm = json.load(open(os.path.join(HERE, "heart_landmarks.json")))

    offs, pos, chamber, area, tris, n = {}, [], [], [], {}, 0
    for cid, name in enumerate(CHAMBERS):
        v, t = np.array(ch[name]["verts"]), np.array(ch[name]["tris"])
        offs[name], n = n, n + len(v)
        pos.append(v)
        chamber += [cid] * len(v)
        area.append(vertex_area(v, t))
        tris[name] = t
    pos, chamber, area = np.concatenate(pos), np.array(chamber), np.concatenate(area)
    vid = lambda name, i: offs[name] + int(i)
    chv = lambda name: pos[chamber == CHAMBERS.index(name)]

    def nearest(name, p, tol=15.0):
        return vid(name, snap_landmarks(chv(name), {name: p}, tol)[name])

    # Valve rings: the tricuspid ring is the RA opening that meets the RV, the mitral the LA's that meets the LV.
    def ring(atrium, ventricle):
        va, vv = chv(atrium), chv(ventricle)
        al = [l for l in boundary_loops(tris[atrium]) if len(l) > 10]
        vl = [l for l in boundary_loops(tris[ventricle]) if len(l) > 10]
        best = min(((a, b) for a in al for b in vl), key=lambda ab: np.linalg.norm(va[ab[0]].mean(0) - vv[ab[1]].mean(0)))
        return [vid(atrium, i) for i in best[0]]

    tri_ring, mit_ring = ring("right_atrium", "right_ventricle"), ring("left_atrium", "left_ventricle")
    mitral_c = pos[mit_ring].mean(0)
    lv = chamber == 3
    apex = int(np.nonzero(lv)[0][np.linalg.norm(pos[lv] - mitral_c, axis=1).argmax()])
    axis = pos[apex] - mitral_c
    frac = np.clip((pos - mitral_c) @ axis / (axis @ axis), 0, 1)  # 0 base .. 1 apex

    # The LV mesh is two pieces: the inner endocardial shell (incl. the septum's left face) and the outer free
    # wall. The RV mesh is a thin shell over the septum and free wall, so all of it is RV endocardium-ish.
    lv_ids = np.nonzero(lv)[0]
    cav = pos[lv].mean(0)
    lab = components(len(lv_ids), tris["left_ventricle"])
    inner = min(np.unique(lab), key=lambda k: np.linalg.norm(pos[lv_ids[lab == k]] - cav, axis=1).mean())
    lv_endo = lv_ids[lab == inner]
    rv_ids = np.nonzero(chamber == 2)[0]
    # Across the LV free wall and the septum (~10 mm, wider than the muscle neighbourhood): explicit links.
    across = np.concatenate([lv_ids[lab != inner], rv_ids])
    links = [[int(across[i]), int(lv_endo[j])] for i, j in nearest_links(pos[across], pos[lv_endo], 3, 14.0)]

    # Conduction system. AV node: the RA tricuspid-ring point nearest the mitral ring; His runs onto the septal
    # crest (the LV endocardium nearest the node); the RBB runs down the RV septal surface to the moderator band.
    avnode = tri_ring[int(np.linalg.norm(pos[tri_ring] - mitral_c, axis=1).argmin())]
    d_rv = np.array([np.linalg.norm(pos[rv_ids] - p, axis=1).min() for p in pos[lv_endo]])
    sept_endo = lv_endo[d_rv < 12]
    his_end = int(sept_endo[np.linalg.norm(pos[sept_endo] - pos[avnode], axis=1).argmin()])
    on_septum = lambda f: int(sept_endo[np.linalg.norm(pos[sept_endo] - (pos[his_end] + f * (pos[apex] - pos[his_end])),
                                                         axis=1).argmin()])
    split, mid = on_septum(0.3), pos[on_septum(0.5)]
    rv_mid = int(rv_ids[np.linalg.norm(pos[rv_ids] - mid, axis=1).argmin()])
    hint = {k: nearest(n, p) for k, (n, p) in lm["hints"].items()}
    lines = {"his": [avnode, his_end], "lbb": [his_end, split], "laf": [split, hint["laf_end"]],
             "lpf": [split, hint["lpf_end"]], "rbb": [his_end, rv_mid, hint["rbb_end"]]}

    # Purkinje regions: apical 3/4 of the endocardium. 0 LV septal (main LBB), 1 anterior fascicle,
    # 2 posterior fascicle, 3 right ventricle; -1 none.
    purk = np.full(len(pos), -1)
    lv_p = lv_endo[frac[lv_endo] > 0.1]
    ends = pos[[split, hint["laf_end"], hint["lpf_end"]]]
    purk[lv_p] = np.linalg.norm(pos[lv_p][:, None] - ends[None], axis=2).argmin(1)
    purk[rv_ids[frac[rv_ids] > 0.1]] = 3

    # Flutter circuit: the tricuspid ring ordered so the septal side (towards the LV) is climbed.
    tc = pos[tri_ring].mean(0)
    k = int(np.linalg.norm(pos[tri_ring] - mitral_c, axis=1).argmin())
    nxt = tri_ring[(k + 1) % len(tri_ring)]
    if pos[nxt][2] < pos[tri_ring[k]][2]:
        tri_ring = tri_ring[::-1]
    low = sorted(tri_ring, key=lambda i: pos[i][2])[: max(3, len(tri_ring) // 6)]
    vt_scar = [int(i) for i in lv_ids[np.linalg.norm(pos[lv_ids] - pos[hint["vt_exit"]], axis=1) < 9]]

    graph = {
        "pos": np.round(pos, 1).ravel().tolist(), "chamber": chamber.tolist(), "area": np.round(area, 2).tolist(),
        "purkinje": purk.tolist(), "lines": lines, "links": links,
        "landmarks": {"sa": hint["sa"], "avnode": avnode, "his": his_end, "apex": apex,
                      "tricuspid_ring": [int(i) for i in tri_ring], "cti": [int(i) for i in low],
                      "mitral_ring": [int(i) for i in mit_ring],
                      "accessory": [hint["acc_atrial"], hint["acc_ventricular"]], "pvc": hint["pvc"],
                      "vt_exit": hint["vt_exit"], "vt_scar": vt_scar},
        "electrodes": lm["electrodes"], "centre": np.round(pos[chamber >= 2].mean(0), 1).tolist(),
    }
    json.dump(graph, open(os.path.join(HEART, "heart-graph.json"), "w"), separators=(",", ":"))
    print("heart graph", len(pos), "vertices;", "LV endo", len(lv_endo),
          "purkinje", int((purk >= 0).sum()), "tricuspid ring", len(tri_ring))


if __name__ == "__main__":
    cmd = sys.argv[1]
    fit(sys.argv[2:]) if cmd == "fit" else {"export": export, "map": draft, "link": link, "heart": heart}[cmd]()
