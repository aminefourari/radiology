"""Turn one TotalSegmentator-dataset case into viewer files under <out>/cases/<case_id>/.

Usage: make_case.py <dataset_case_dir> <case_id> [--case-file pipeline/cases/<id>.json]
                    [--voxel-mm MM] [--z-range LO:HI] [--out site] [--device gpu|cpu|mps]

The case file picks region, TotalSegmentator tasks, systems, default systems, windows,
per-case system overrides, title and key levels. `total` comes from the dataset's own
segmentations/; every other task is run once and cached in data/tmp/<case_id>_<task>/.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

from caselib import (best_slices, body_bbox, build_label_map, check_tasks, load_canonical,
                     resample, select_structures, validate_case, write_volume)

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = {"name": "TotalSegmentator dataset", "license": "CC BY 4.0",
          "url": "https://doi.org/10.5281/zenodo.6802613"}


REGION_ORDER = ["head", "neck", "chest", "abdomen-pelvis", "lower-limb", "upper-limb"]


def task_dir(ct_path, case_id, task, device):
    out = os.path.join("data", "tmp", f"{case_id}_{task}")
    if not (os.path.isdir(out) and any(f.endswith(".nii.gz") for f in os.listdir(out))):
        env = {**os.environ, "PATH": os.path.dirname(sys.executable) + os.pathsep + os.environ["PATH"],
               "PYTORCH_ENABLE_MPS_FALLBACK": "1"}
        subprocess.run(["TotalSegmentator", "-i", ct_path, "-o", out, "-ta", task, "-d", device], check=True, env=env)
    return out


def read_json(path, default):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("src")
    p.add_argument("case_id")
    p.add_argument("--case-file", default=None)
    p.add_argument("--voxel-mm", type=float, default=None)
    p.add_argument("--z-range", default=None, help="LO:HI axial range in canonical source voxels")
    p.add_argument("--out", default="site")
    p.add_argument("--device", default="gpu", help="TotalSegmentator device: gpu, cpu or mps (Apple)")
    a = p.parse_args(argv)

    case = read_json(a.case_file or os.path.join(HERE, "cases", f"{a.case_id}.json"), None)
    assert case, f"no case file for {a.case_id}"
    check_tasks(case["tasks"])
    catalogue = select_structures(read_json(os.path.join(HERE, "structures.json"), None)["structures"], case)
    system_defs = {s["key"]: s for s in read_json(os.path.join(HERE, "systems.json"), None)["systems"]}
    ct_path = os.path.join(a.src, "ct.nii.gz")

    ct, spacing = load_canonical(ct_path)
    box = list(body_bbox(ct))
    if a.z_range:
        lo, hi = (int(v) for v in a.z_range.split(":"))
        box[2] = slice(max(box[2].start, lo), min(box[2].stop, hi))
    box = tuple(box)

    def prep(arr, order):
        return resample(arr[box], spacing, a.voxel_mm, order)

    ct, out_spacing = prep(ct.astype(np.float32), 1)
    ct = np.clip(np.rint(ct), -1024, 3071).astype(np.int16)

    seg_dirs = {t: os.path.join(a.src, "segmentations") if t == "total" else task_dir(ct_path, a.case_id, t, a.device)
                for t in case["tasks"]}
    masks = {}
    for s in catalogue:
        d = seg_dirs.get(s["source"])
        path = d and os.path.join(d, s["key"] + ".nii.gz")
        if path and os.path.exists(path):
            m, _ = load_canonical(path)
            masks[s["key"]] = prep((m > 0).astype(np.uint8), 0)[0] > 0

    labels, kept = build_label_map(masks, catalogue)
    best = best_slices(labels, [s["id"] for s in kept])
    ids = {s["key"]: s["id"] for s in kept}
    structures = [{"id": s["id"], "key": s["key"], "system": s["system"], "color": s["color"],
                   "parent": ids.get(s["parent"]), "names": s["names"], "best": best[s["id"]]}
                  for s in kept]
    present = {s["system"] for s in kept}
    systems = [system_defs[k] for k in case["systems"] if k in present]
    case_dir = os.path.join(a.out, "cases", a.case_id)
    os.makedirs(case_dir, exist_ok=True)
    write_volume(os.path.join(case_dir, "ct.bin.gz"), ct, "<i2")
    write_volume(os.path.join(case_dir, "labels.bin.gz"), labels, "u1")
    write_json(os.path.join(case_dir, "meta.json"), {
        "id": a.case_id, "dims": list(ct.shape), "spacing": [round(s, 4) for s in out_spacing],
        "orientation": "RAS", "region": case["region"],
        "source": {**SOURCE, "case": os.path.basename(os.path.normpath(a.src)), "tasks": case["tasks"]},
        "systems": systems, "defaultSystems": [k for k in case["defaultSystems"] if k in present],
        "windows": case["windows"], "structures": structures, "keyLevels": case.get("keyLevels", [])})

    index_path = os.path.join(a.out, "cases", "index.json")
    index = [c for c in read_json(index_path, []) if c["id"] != a.case_id]
    index.append({"id": a.case_id, "region": case["region"], "title": case.get("title", {"en": a.case_id})})
    write_json(index_path, sorted(index, key=lambda c: (REGION_ORDER.index(c["region"]), c["id"])))

    validate_case(case_dir)
    print(f"{a.case_id}: {ct.shape} @ {out_spacing} mm, {len(structures)} structures")


if __name__ == "__main__":
    main()
