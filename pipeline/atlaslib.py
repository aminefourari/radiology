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


def validate_map(m, site_keys, atlas_keys):
    """Raise ValueError naming the first site or atlas key the map uses that does not exist."""
    for site, atlas in m.items():
        if site not in site_keys:
            raise ValueError(f"unknown site key: {site}")
        for a in atlas:
            if a not in atlas_keys:
                raise ValueError(f"unknown atlas key: {a} (for {site})")


def _side(text):
    t = text.lower()
    return "left" if re.search(r"\bleft\b", t) else "right" if re.search(r"\bright\b", t) else None


def _bare(text):
    return re.sub(r"\(?\b(left|right)\b\)?", "", text.lower()).strip(" ,()")


def draft_map(site, atlas):
    """First draft of site key -> [atlas keys] by English name and side; reviewed by hand afterwards."""
    by_name = {}
    for a in atlas:
        by_name.setdefault((_bare(a["en"]), _side(a["en"])), []).append(a["key"])
    out = {}
    for s in site:
        en = s["names"]["en"]
        hit = by_name.get((_bare(en), _side(en) or _side(s["key"].replace("_", " "))))
        if hit:
            out[s["key"]] = hit
    return out


def case_centroids(labels, spacing, ids):
    """Centroid in mm of each label id present in an [x,y,z] label map (voxel centre = (i + 0.5) * spacing)."""
    from scipy import ndimage
    present = [i for i in ids if (labels == i).any()]
    cents = ndimage.center_of_mass(np.ones_like(labels), labels, present)
    return {i: tuple(float((c + 0.5) * s) for c, s in zip(cent, spacing)) for i, cent in zip(present, cents)}
