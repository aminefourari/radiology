"""Simulated free fluid for the FAST trainer. Pure numpy/scipy, arrays [x, y, z] (RAS).

fluid_map() returns uint8 with value site * 4 + level (level 1 = small, 2 = large, 0 = dry).
The browser shows a voxel as fluid when level <= the amount chosen for its site.
Fluid only goes into free voxels: no organ label, soft-tissue/fat HU, never bone, gas or lung.
"""
import numpy as np
from scipy.ndimage import binary_closing, binary_fill_holes, distance_transform_edt, label

SITES = ["morison", "splenorenal", "pelvis", "pericardium"]

# Band widths in mm, tuned by eye on s0739-trunk (see make_fluid.py).
PAIR_SMALL, PAIR_LARGE = 5.0, 12.0
PELVIS_WALL, PELVIS_SMALL, PELVIS_LARGE = 3.0, 8.0, 16.0  # the bladder mask is urine; leave its wall
PERI_SMALL, PERI_LARGE = 3.0, 10.0


def _dist(mask, sp):
    return distance_transform_edt(~mask, sampling=sp)


def _grow(small, large):
    """Keep the parts of `large` connected to `small`, so the wedge spreads from the stripe."""
    lab, _ = label(large)
    keep = np.unique(lab[small & large])
    return small, np.isin(lab, keep[keep > 0])


def _solid(mask, sp, mm=5.0):
    """Close gaps between labelled chambers (the RV wall has no label) so the shell stays outside."""
    r = int(np.ceil(mm / min(sp)))
    g = np.mgrid[-r:r + 1, -r:r + 1, -r:r + 1]
    ball = (g ** 2).sum(0) <= r * r
    padded = np.pad(mask, r)
    return binary_fill_holes(binary_closing(padded, ball))[r:-r, r:-r, r:-r]


def fluid_map(ct, masks, spacing_mm, sex):
    """masks: bool arrays for liver, kidney_right, spleen, kidney_left, urinary_bladder, heart, lung,
    and `occupied` (every labelled voxel). sex is kept for the pelvic pouch's name, the space is the same."""
    sp = (spacing_mm,) * 3 if np.isscalar(spacing_mm) else tuple(spacing_mm)
    free = ~masks["occupied"] & ~masks["lung"] & (ct >= -150) & (ct <= 100)
    zz = np.arange(ct.shape[2])[None, None, :]
    yy = np.arange(ct.shape[1])[None, :, None]
    xx = np.arange(ct.shape[0])[:, None, None]
    out = np.zeros(ct.shape, np.uint8)

    def put(site, small, large):
        small, large = _grow(small & free, large & free)
        large |= small
        for level, m in ((2, large), (1, small)):
            out[m & ((out == 0) | (out // 4 == site))] = site * 4 + level

    def pair(a, b):
        da, db = _dist(masks[a], sp), _dist(masks[b], sp)
        return (da <= PAIR_SMALL) & (db <= PAIR_SMALL), (da <= PAIR_LARGE) & (db <= 2 * PAIR_LARGE)

    put(1, *pair("liver", "kidney_right"))
    s, l = pair("spleen", "kidney_left")
    sx, sy, sz = [c.mean() for c in np.nonzero(masks["spleen"])]
    # Left subphrenic space: the lateral half of the spleen, above or behind it.
    wrap = (_dist(masks["spleen"], sp) <= PAIR_LARGE) & (xx <= sx) & ((zz >= sz) | (yy <= sy))
    # RAS: +x is the patient's right, so the left side's lateral direction is smaller x.
    lateral = xx <= max(sx, np.nonzero(masks["kidney_left"])[0].max())  # not medially into the lesser sac
    put(2, s & lateral, (l | wrap) & lateral)

    bl = masks["urinary_bladder"]
    by = np.nonzero(bl)[1].mean()
    db = _dist(bl, sp)
    behind = yy < by
    wall = db >= PELVIS_WALL
    put(3, (db <= PELVIS_SMALL) & behind & wall, (db <= PELVIS_LARGE) & behind & wall)

    heart = _solid(masks["heart"], sp)
    dh = _dist(heart, sp)
    hy, hz = [c.mean() for c in np.nonzero(heart)[1:]]
    # Thicker posteroinferiorly, where an effusion collects first in a supine patient.
    extra = np.clip(((hy - yy) + (hz - zz)) * min(sp) / 40.0, 0, 1)
    put(4, (dh > 0) & (dh <= PERI_SMALL), (dh > 0) & (dh <= PERI_LARGE * (0.6 + 0.4 * extra)))
    return out
