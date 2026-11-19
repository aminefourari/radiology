"""Smooth per-structure surface meshes from a case label map, for the 3D view.

Meshes are in RAS mm, same frame as the volume (voxel i spans [i, i+1) * spacing).
On disk: mesh.bin.gz holds, per mesh, uint16 positions quantised over `box` then uint16 indices;
meshes.json indexes it.
"""
import gzip
import json
import os

import fast_simplification
import numpy as np
from scipy import ndimage
from skimage.measure import marching_cubes

PAD = 3
MAX_VERTS = 65535


def structure_mesh(mask, spacing, target_tris):
    """Smoothed, decimated surface of a boolean [x,y,z] mask, or None if it is empty."""
    sl = ndimage.find_objects(mask.astype(np.uint8))
    if not sl:
        return None
    lo = [max(0, s.start - PAD) for s in sl[0]]
    hi = [min(n, s.stop + PAD) for s, n in zip(sl[0], mask.shape)]
    crop = np.pad(mask[lo[0]:hi[0], lo[1]:hi[1], lo[2]:hi[2]].astype(np.float32), 1)
    for sigma in (1.0, 0.5, 0.0):  # thin or tiny structures vanish under heavy smoothing
        field = ndimage.gaussian_filter(crop, sigma) if sigma else crop
        if field.max() > 0.5:
            break
    verts, faces, _, _ = marching_cubes(field, 0.5, spacing=spacing)
    # Back to full-volume mm: undo the 1-voxel pad, shift by the crop origin, voxel centres at +0.5.
    verts = verts + (np.array(lo) - 1 + 0.5) * np.array(spacing)
    faces = faces.astype(np.uint32)
    if len(faces) > target_tris:
        verts, faces = fast_simplification.simplify(verts, faces, 1 - target_tris / len(faces))
    while len(verts) >= MAX_VERTS:
        verts, faces = fast_simplification.simplify(verts, faces, 0.5)
    return verts.astype(np.float32), faces.astype(np.uint32)


def build_meshes(labels, spacing, structures, total_tris=150_000):
    """One mesh per structure present; a parent with children gets the union of its and their voxels."""
    children = {}
    for s in structures:
        if s.get("parent"):
            children.setdefault(s["parent"], []).append(s["id"])
    masks = {}
    for s in structures:
        ids = [s["id"]] + children.get(s["id"], [])
        m = np.isin(labels, ids) if len(ids) > 1 else labels == s["id"]
        if m.any():
            masks[s["id"]] = m
    surface = {i: int((m & ~ndimage.binary_erosion(m)).sum()) for i, m in masks.items()}
    total = sum(surface.values()) or 1
    out = []
    for i, m in masks.items():
        mesh = structure_mesh(m, spacing, max(200, round(total_tris * surface[i] / total)))
        if mesh is None:
            continue
        verts, faces = mesh
        centroid = (np.argwhere(m).mean(0) + 0.5) * np.array(spacing)
        anchor = verts[np.argmin(((verts - centroid) ** 2).sum(1))]
        out.append({"id": i, "verts": verts, "faces": faces, "anchor": anchor, "size": int(m.sum())})
    return out


def write_meshes(case_dir, entries):
    allv = np.concatenate([e["verts"] for e in entries])
    lo, hi = allv.min(0), allv.max(0)
    span = np.maximum(hi - lo, 1e-6)
    blobs, index, offset = [], [], 0
    for e in entries:
        q = np.round((e["verts"] - lo) / span * 65535).astype("<u2")
        ind = e["faces"].astype("<u2").ravel()
        blobs += [q.tobytes(), ind.tobytes()]
        index.append({"id": e["id"], "offset": offset, "vertexCount": len(q), "indexCount": len(ind),
                      "anchor": [round(float(a), 1) for a in e["anchor"]], "size": e["size"]})
        offset += q.nbytes + ind.nbytes
    with open(os.path.join(case_dir, "mesh.bin.gz"), "wb") as raw, \
            gzip.GzipFile(filename="", fileobj=raw, mode="wb", compresslevel=9, mtime=0) as f:
        f.write(b"".join(blobs))
    with open(os.path.join(case_dir, "meshes.json"), "w", encoding="utf-8") as f:
        json.dump({"box": [round(float(v), 3) for v in (*lo, *hi)], "meshes": index}, f, separators=(",", ":"))
