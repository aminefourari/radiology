import numpy as np
import pytest

from atlaslib import blender_to_ras, fit_axes, slug


def test_blender_to_ras_flips_x_and_y_and_scales():
    assert blender_to_ras((1, 2, 3), 10) == (-10, -20, 30)


def test_slug_sides():
    assert slug("Rib 5.l") == "rib_5_left"
    assert slug("Liver") == "liver"
    assert slug("(Accessory parotid gland).r") == "accessory_parotid_gland_right"


def test_fit_recovers_scale_and_offset():
    ct = np.array([[0, 0, 0], [100, 50, 200], [40, 90, 10]], float)
    f = fit_axes(ct, ct * 1.1 + [5, -3, 20])
    assert np.allclose(f["x"], [1.1, 5]) and np.allclose(f["z"], [1.1, 20])


def test_fit_skips_axis_without_spread():
    ct = np.array([[0, 0, 0], [100, 0, 200]], float)
    assert fit_axes(ct, ct)["y"] is None


def test_fit_needs_two_landmarks():
    assert fit_axes(np.zeros((1, 3)), np.zeros((1, 3))) == {"x": None, "y": None, "z": None}


def test_validate_map_rejects_unknown_atlas_key():
    from atlaslib import validate_map
    with pytest.raises(ValueError, match="nope"):
        validate_map({"liver": ["nope"]}, {"liver"}, {"liver"})


def test_validate_map_rejects_unknown_site_key():
    from atlaslib import validate_map
    with pytest.raises(ValueError, match="kidney_x"):
        validate_map({"kidney_x": ["liver"]}, {"liver"}, {"liver"})


def test_draft_map_matches_sides():
    from atlaslib import draft_map
    site = [{"key": "kidney_left", "names": {"en": "Left kidney"}}]
    atlas = [{"key": "kidney_left", "en": "Kidney (left)"}, {"key": "kidney_right", "en": "Kidney (right)"}]
    assert draft_map(site, atlas) == {"kidney_left": ["kidney_left"]}


def test_case_centroids_voxel_centres():
    from atlaslib import case_centroids
    lab = np.zeros((4, 4, 4), np.uint8)
    lab[1, 2, 3] = 7
    assert case_centroids(lab, (2, 2, 2), [7, 9]) == {7: (3.0, 5.0, 7.0)}


def test_part_parents_from_site_parents():
    from atlaslib import part_parents
    site = [{"key": "liver", "parent": None}, {"key": "liver_segment_4", "parent": "liver"}]
    links = {"liver": ["liver"], "liver_segment_4": ["seg_iv"]}
    assert part_parents(site, links) == {"seg_iv": "liver"}
