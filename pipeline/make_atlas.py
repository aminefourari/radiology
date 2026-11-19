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

Changes: converted to RAS millimetres, simplified, compressed (meshopt). Left out because they are
non-commercial in Z-Anatomy: the inner ear and auditory ossicles (University of Dundee, CC BY-NC-SA) and
the kidney by Lissie Cowley (CC BY-NC), replaced by the BodyParts3D kidneys.
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
        json.dump(result, open(os.path.join(d, "atlaslink.json"), "w"), separators=(",", ":"))
        print(meta["id"], {k: result[k] for k in "xyz"}, len(used), "landmarks")


if __name__ == "__main__":
    cmd = sys.argv[1]
    fit(sys.argv[2:]) if cmd == "fit" else {"export": export, "map": draft, "link": link}[cmd]()
