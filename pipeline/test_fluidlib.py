import numpy as np
import pytest

from fluidlib import SITES, fluid_map

SP = 1.0


def phantom():
    """Soft-tissue box with organ blocks; arrays are [x, y, z] (RAS)."""
    ct = np.full((80, 60, 80), -1000, np.int16)
    ct[2:78, 2:58, 2:78] = 40
    blocks = {
        "liver": np.s_[10:30, 25:45, 45:65],
        "kidney_right": np.s_[12:24, 20:32, 30:41],  # 4 mm gap below the liver
        "spleen": np.s_[55:70, 25:40, 45:60],
        "kidney_left": np.s_[52:64, 20:32, 30:41],
        "urinary_bladder": np.s_[35:45, 30:40, 5:15],
        "heart": np.s_[33:48, 35:50, 66:76],
        "lung": np.s_[49:60, 35:50, 62:78],
    }
    masks = {}
    for k, sl in blocks.items():
        m = np.zeros(ct.shape, bool)
        m[sl] = True
        masks[k] = m
    ct[30:34, 50:54, 20:30] = 700  # bone
    ct[40:44, 10:14, 20:30] = -900  # gas
    masks["occupied"] = np.logical_or.reduce([masks[k] for k in blocks])
    return ct, masks


@pytest.fixture(scope="module")
def out():
    ct, masks = phantom()
    return ct, masks, fluid_map(ct, masks, SP, "M")


def site_level(v):
    return v // 4, v % 4


def test_sites_are_named_in_order():
    assert SITES == ["morison", "splenorenal", "pelvis", "pericardium"]


def test_fluid_never_in_organ_bone_air_or_lung(out):
    ct, masks, f = out
    wet = f > 0
    assert not (wet & masks["occupied"]).any()
    assert not (wet & (ct > 300)).any()
    assert not (wet & (ct < -300)).any()
    assert not (wet & masks["lung"]).any()


def test_values_decode_to_known_sites_and_levels(out):
    site, level = site_level(out[2][out[2] > 0])
    assert set(np.unique(site)) <= {1, 2, 3, 4}
    assert set(np.unique(level)) <= {1, 2}


def test_large_contains_small(out):
    f = out[2]
    site, level = site_level(f)
    for s in range(1, 5):
        small = (site == s) & (level == 1)
        large = (site == s) & (level >= 1)
        assert small.sum() < large.sum()


def test_every_site_nonempty_at_small(out):
    site, level = site_level(out[2])
    for s in range(1, 5):
        assert ((site == s) & (level == 1)).sum() > 0, SITES[s - 1]


def near(mask, idx, mm):
    from scipy.ndimage import distance_transform_edt
    return distance_transform_edt(~mask, sampling=SP)[idx] <= mm + 1e-6


def test_morison_small_is_between_liver_and_right_kidney(out):
    _, masks, f = out
    idx = np.nonzero(f == 1 * 4 + 1)
    assert near(masks["liver"], idx, 5).all() and near(masks["kidney_right"], idx, 5).all()


def test_splenorenal_small_is_between_spleen_and_left_kidney(out):
    _, masks, f = out
    idx = np.nonzero(f == 2 * 4 + 1)
    assert near(masks["spleen"], idx, 5).all() and near(masks["kidney_left"], idx, 5).all()


def test_pelvis_sits_behind_bladder(out):
    _, masks, f = out
    ys = np.nonzero(f // 4 == 3)[1]
    cy = np.nonzero(masks["urinary_bladder"])[1].mean()
    assert len(ys) and (ys < cy).all()


def test_pericardium_is_a_shell_round_the_heart(out):
    _, masks, f = out
    small = np.nonzero(f == 4 * 4 + 1)
    large = np.nonzero(f // 4 == 4)
    assert near(masks["heart"], small, 3).all()
    assert near(masks["heart"], large, 12).all()


def test_no_fluid_in_unlabelled_gaps_inside_the_heart():
    ct, masks = phantom()
    masks["heart"][38:41, 35:50, 66:76] = False  # an unlabelled septum-like slit
    masks["occupied"][38:41, 35:50, 66:76] = False
    f = fluid_map(ct, masks, SP, "M")
    assert not (f[38:41, 37:48, 68:74] > 0).any()


def test_splenic_wrap_stays_on_the_lateral_side(out):
    _, masks, f = out
    xs = np.nonzero(f // 4 == 2)[0]
    sx = np.nonzero(masks["spleen"])[0].mean()
    kx = np.nonzero(masks["kidney_left"])[0]
    assert (xs >= min(sx, kx.min()) - 5).all()
