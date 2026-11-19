"""Pure helpers for the Z-Anatomy 3D atlas (export, site<->atlas map, per-case plane fit)."""
import re

import numpy as np

AXES = "xyz"


def blender_to_ras(p, scale):
    """Z-Anatomy faces -Y in Blender with its right hand at -X; RAS has right at +x, anterior at +y."""
    x, y, z = p
    return (-x * scale, -y * scale, z * scale)


def slug(name):
    """Stable atlas key: 'Rib 5.l' -> 'rib_5_left'."""
    side = {".l": "_left", ".r": "_right"}.get(name[-2:], "")
    if side:
        name = name[:-2]
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") + side


def fit_axes(src, dst, min_spread_mm=30):
    """Per axis least squares dst = a*src + b, as {"x": [a, b] | None, ...}.

    None when that axis has fewer than 2 points, src spreads less than min_spread_mm, or a <= 0.
    """
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    out = {}
    for i, k in enumerate(AXES):
        out[k] = None
        if len(src) < 2 or np.ptp(src[:, i]) < min_spread_mm:
            continue
        a, b = np.polyfit(src[:, i], dst[:, i], 1)
        if a > 0:
            out[k] = [round(float(a), 5), round(float(b), 3)]
    return out
