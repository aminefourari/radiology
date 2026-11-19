"""Pure helpers that turn NIfTI volumes into viewer case files.

Conventions (see CLAUDE.md): arrays are RAS+ indexed [x, y, z]; files on disk are
C-order [z][y][x], little-endian, gzipped.
"""
import gzip
import json
import os

import nibabel as nib
import numpy as np
from scipy import ndimage


def load_canonical(path):
    img = nib.as_closest_canonical(nib.load(path))
    spacing = tuple(float(s) for s in img.header.get_zooms()[:3])
    return np.asanyarray(img.dataobj), spacing


def resample(arr, spacing, target_mm, order):
    if target_mm is None or all(abs(s - target_mm) < 1e-6 for s in spacing):
        return arr, tuple(spacing)
    factors = [s / target_mm for s in spacing]
    out = ndimage.zoom(arr, factors, order=order, mode="nearest", grid_mode=True)
    # Report the spacing actually achieved after rounding the shape.
    new_spacing = tuple(s * n / m for s, n, m in zip(spacing, arr.shape, out.shape))
    return out, new_spacing


def body_bbox(ct, threshold=-500, margin=2):
    idx = np.argwhere(ct > threshold)
    if idx.size == 0:
        return tuple(slice(0, n) for n in ct.shape)
    lo = np.maximum(idx.min(0) - margin, 0)
    hi = np.minimum(idx.max(0) + 1 + margin, ct.shape)
    return tuple(slice(int(a), int(b)) for a, b in zip(lo, hi))


def build_label_map(masks, structures):
    """Paint masks in catalogue order (later wins); drop missing/empty ones."""
    shape = next(iter(masks.values())).shape
    lab = np.zeros(shape, np.uint8)
    kept = []
    for s in structures:
        m = masks.get(s["key"])
        if m is None or not m.any():
            continue
        assert len(kept) < 255, "uint8 label map holds at most 255 structures"
        kept.append({**s, "id": len(kept) + 1})
        lab[m.astype(bool)] = len(kept)
    return lab, kept


def best_slices(labels, ids):
    """Per id, the index with the most voxels along each axis (x=sagittal, y=coronal, z=axial)."""
    n = int(labels.max()) + 1
    out = {i: {} for i in ids}
    for axis, plane in ((2, "axial"), (1, "coronal"), (0, "sagittal")):
        moved = np.moveaxis(labels, axis, 0).reshape(labels.shape[axis], -1)
        counts = np.stack([np.bincount(row, minlength=n) for row in moved])  # [slice, id]
        for i in ids:
            out[i][plane] = int(counts[:, i].argmax())
    return out


def write_volume(path, arr_xyz, dtype):
    data = np.ascontiguousarray(np.transpose(arr_xyz, (2, 1, 0)).astype(dtype))
    # mtime=0 and no filename: identical data gives identical bytes, so rebuilds don't churn git.
    with open(path, "wb") as raw, gzip.GzipFile(filename="", fileobj=raw, mode="wb", compresslevel=9, mtime=0) as f:
        f.write(data.tobytes())


def validate_case(case_dir, budget_bytes=25 * 1024 * 1024):
    with open(os.path.join(case_dir, "meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    X, Y, Z = meta["dims"]
    with gzip.open(os.path.join(case_dir, "ct.bin.gz")) as f:
        assert len(f.read()) == X * Y * Z * 2, "ct size does not match meta.dims"
    with gzip.open(os.path.join(case_dir, "labels.bin.gz")) as f:
        lab = np.frombuffer(f.read(), np.uint8)
    assert lab.size == X * Y * Z, "labels size does not match meta.dims"
    known = {0} | {s["id"] for s in meta["structures"]}
    unknown = set(np.unique(lab).tolist()) - known
    assert not unknown, f"label ids missing from meta: {sorted(unknown)}"
    total = sum(os.path.getsize(os.path.join(case_dir, n)) for n in ("ct.bin.gz", "labels.bin.gz", "meta.json"))
    assert total <= budget_bytes, f"case is {total / 2**20:.1f} MB, over budget"


OPEN_TASKS = {"total", "liver_segments", "ventricle_parts", "head_glands_cavities", "headneck_bones_vessels",
              "headneck_muscles", "head_muscles", "oculomotor_muscles", "lung_vessels", "trunk_cavities", "body",
              "abdominal_muscles", "breasts"}
# Licensed tasks: registered 2026-11-19; the author confirmed publishing their outputs here is fine.
LICENSED_TASKS = {"brain_structures", "heartchambers_highres", "coronary_arteries", "aortic_sinuses",
                  "appendicular_bones", "vertebrae_pp_refined", "tissue_types"}
ALLOWED_TASKS = frozenset(OPEN_TASKS | LICENSED_TASKS)


def check_tasks(tasks):
    for t in tasks:
        if t not in ALLOWED_TASKS:
            raise ValueError(f"TotalSegmentator task not allowed: {t}")


def select_structures(catalogue, case):
    """Catalogue entries this case uses, with per-case system overrides applied.
    `exclude` drops structures the sanity pass found broken in this scan."""
    overrides = case.get("systemOverrides", {})
    exclude = set(case.get("exclude", []))
    out = []
    for s in catalogue:
        system = overrides.get(s["key"], s["system"])
        if s["source"] in case["tasks"] and system in case["systems"] and s["key"] not in exclude:
            out.append({**s, "system": system})
    return out
