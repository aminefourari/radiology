"""Turn one TotalSegmentator-dataset case into viewer files under <out>/cases/<case_id>/.

Usage: make_case.py <dataset_case_dir> <case_id> [--no-liver-segments] [--voxel-mm MM]
                    [--z-range LO:HI] [--out site] [--device gpu|cpu|mps]
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np

from caselib import (best_slices, body_bbox, build_label_map, load_canonical,
                     resample, validate_case, write_volume)

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = {"name": "TotalSegmentator dataset", "license": "CC BY 4.0",
          "url": "https://doi.org/10.5281/zenodo.6802613"}


def liver_segment_dir(ct_path, case_id, device):
    out = os.path.join("data", "tmp", f"{case_id}_liverseg")
    if not os.path.exists(os.path.join(out, "liver_segment_8.nii.gz")):
        subprocess.run(["TotalSegmentator", "-i", ct_path, "-o", out, "-ta", "liver_segments", "-d", device],
                       check=True, env={**os.environ, "PATH": os.path.dirname(sys.executable) + os.pathsep + os.environ["PATH"]})
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
    p.add_argument("--no-liver-segments", action="store_true")
    p.add_argument("--voxel-mm", type=float, default=None)
    p.add_argument("--z-range", default=None, help="LO:HI axial range in canonical source voxels")
    p.add_argument("--out", default="site")
    p.add_argument("--device", default="gpu", help="TotalSegmentator device: gpu, cpu or mps (Apple)")
    a = p.parse_args(argv)

    catalogue = read_json(os.path.join(HERE, "structures.json"), None)["structures"]
    curated = read_json(os.path.join(HERE, "cases", f"{a.case_id}.json"), {})
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

    seg_dirs = {"total": os.path.join(a.src, "segmentations")}
    if not a.no_liver_segments:
        seg_dirs["liver_segments"] = liver_segment_dir(ct_path, a.case_id, a.device)
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

    case_dir = os.path.join(a.out, "cases", a.case_id)
    os.makedirs(case_dir, exist_ok=True)
    write_volume(os.path.join(case_dir, "ct.bin.gz"), ct, "<i2")
    write_volume(os.path.join(case_dir, "labels.bin.gz"), labels, "u1")
    write_json(os.path.join(case_dir, "meta.json"), {
        "id": a.case_id, "dims": list(ct.shape), "spacing": [round(s, 4) for s in out_spacing],
        "orientation": "RAS", "source": {**SOURCE, "case": os.path.basename(os.path.normpath(a.src))},
        "structures": structures, "keyLevels": curated.get("keyLevels", [])})

    index_path = os.path.join(a.out, "cases", "index.json")
    index = [c for c in read_json(index_path, []) if c["id"] != a.case_id]
    index.append({"id": a.case_id, "title": curated.get("title", {"en": a.case_id})})
    write_json(index_path, sorted(index, key=lambda c: c["id"]))

    validate_case(case_dir)
    print(f"{a.case_id}: {ct.shape} @ {out_spacing} mm, {len(structures)} structures")


if __name__ == "__main__":
    main()
