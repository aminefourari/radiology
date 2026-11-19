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
