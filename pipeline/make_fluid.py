"""Write simulated free fluid for a built case: <case_dir>/fluid.bin.gz, plus meta.fluid.

Usage: make_fluid.py site/cases/<id> [--case-file pipeline/cases/<id>.json] [--png DIR]

Rerun after rebuilding the case with make_case.py (it rewrites meta.json).
--png writes axial and sagittal check images through each site, fluid in blue.
"""
import argparse
import gzip
import json
import os
import struct
import zlib

import numpy as np

from caselib import validate_case, write_volume
from fluidlib import SITES, fluid_map

HERE = os.path.dirname(os.path.abspath(__file__))


def read_volume(path, dims, dtype):
    X, Y, Z = dims
    with gzip.open(path) as f:
        return np.frombuffer(f.read(), dtype).reshape(Z, Y, X).transpose(2, 1, 0)


def masks_from_labels(labels, structures):
    ids = {s["key"]: s["id"] for s in structures}
    union = lambda pred: np.isin(labels, [i for k, i in ids.items() if pred(k)])
    m = {k: labels == ids[k] for k in ("liver", "kidney_right", "spleen", "kidney_left", "urinary_bladder")}
    m["heart"] = union(lambda k: k.startswith("heart_") or k == "atrial_appendage_left")
    m["lung"] = union(lambda k: k.startswith("lung_"))
    m["occupied"] = labels > 0
    return m


def write_png(gray_rgb, path):
    h, w, _ = gray_rgb.shape
    raw = b"".join(b"\x00" + gray_rgb[i].tobytes() for i in range(h))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def check_pngs(ct, fl, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for site in range(1, 5):
        idx = np.nonzero(fl // 4 == site)
        if not len(idx[0]):
            continue
        cx, cy, cz = (int(np.median(a)) for a in idx)
        for name, ct2, fl2 in (("axial", ct[:, :, cz].T[::-1, ::-1], fl[:, :, cz].T[::-1, ::-1]),
                               ("sagittal", ct[cx].T[::-1, ::-1], fl[cx].T[::-1, ::-1])):
            g = np.clip((ct2.astype(float) + 160) / 400 * 255, 0, 255).astype(np.uint8)
            rgb = np.stack([g, g, g], -1)
            wet = fl2 // 4 == site
            rgb[wet & (fl2 % 4 == 1)] = (40, 120, 255)
            rgb[wet & (fl2 % 4 == 2)] = (120, 200, 255)
            write_png(np.ascontiguousarray(rgb), os.path.join(out_dir, f"{SITES[site - 1]}_{name}.png"))


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("case_dir")
    p.add_argument("--case-file", default=None)
    p.add_argument("--png", default=None)
    a = p.parse_args(argv)
    meta_path = os.path.join(a.case_dir, "meta.json")
    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    case_file = a.case_file or os.path.join(HERE, "cases", f"{meta['id']}.json")
    with open(case_file, encoding="utf-8") as f:
        sex = json.load(f).get("sex", "M")
    ct = read_volume(os.path.join(a.case_dir, "ct.bin.gz"), meta["dims"], "<i2")
    labels = read_volume(os.path.join(a.case_dir, "labels.bin.gz"), meta["dims"], "u1")
    fl = fluid_map(ct, masks_from_labels(labels, meta["structures"]), meta["spacing"], sex)
    write_volume(os.path.join(a.case_dir, "fluid.bin.gz"), fl, "u1")
    meta["fluid"] = {"sites": SITES, "simulated": True}
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    validate_case(a.case_dir, budget_bytes=32 * 1024 * 1024)
    for s in range(1, 5):
        print(f"{SITES[s - 1]}: small {(fl == s * 4 + 1).sum()} voxels, large {(fl // 4 == s).sum()}")
    if a.png:
        check_pngs(ct, fl, a.png)


if __name__ == "__main__":
    main()
