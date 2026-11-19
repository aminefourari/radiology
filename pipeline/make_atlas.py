"""Z-Anatomy 3D atlas for the CT page.

  make_atlas.py export   Blender export -> site/atlas/<system>.glb + index.json (needs data/zanatomy, data/bp3d)
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HERE = os.path.join(ROOT, "pipeline")
ZA = os.path.join(ROOT, "data", "zanatomy")
ATLAS = os.path.join(ROOT, "site", "atlas")
BLENDER = os.environ.get("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")

# Target triangles per system after decimation. Sized so each region's defaults stay <= 6 MB.
BUDGETS = {"skeleton": 480_000, "joints": 100_000, "muscles": 420_000, "vessels": 300_000, "lymph": 40_000,
           "nervous": 320_000, "respiratory": 110_000, "digestive": 180_000, "urinary": 30_000,
           "genital": 20_000, "endocrine": 11_000}
REGION_DEFAULTS = {"head": ["skeleton", "nervous", "vessels"],
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
    index = {"systems": systems, "regionDefaults": REGION_DEFAULTS, "structures": meta["structures"], "links": links}
    with open(index_path, "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, separators=(",", ":"))
    open(os.path.join(ATLAS, "LICENSE.txt"), "w").write(LICENSE)
    for region, keys in REGION_DEFAULTS.items():
        mb = sum(s["bytes"] for s in systems if s["key"] in keys) / 1e6
        print(f"{region}: {mb:.2f} MB")


if __name__ == "__main__":
    {"export": export}[sys.argv[1]]()
