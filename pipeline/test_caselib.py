import gzip
import json
import os

import nibabel as nib
import numpy as np
import pytest

from caselib import (best_slices, body_bbox, build_label_map, load_canonical,
                     resample, validate_case, write_volume)


def save(path, arr, affine=None):
    nib.save(nib.Nifti1Image(arr, np.eye(4) if affine is None else affine), str(path))


def test_load_canonical_reorients_las_to_ras(tmp_path):
    arr = np.arange(12, dtype=np.int16).reshape(3, 2, 2)
    save(tmp_path / "a.nii.gz", arr, np.diag([-1.0, 1, 1, 1]))
    out, spacing = load_canonical(str(tmp_path / "a.nii.gz"))
    assert out[0, 0, 0] == arr[2, 0, 0]
    assert spacing == (1.0, 1.0, 1.0)


def test_resample_noop_and_halves():
    arr = np.ones((4, 4, 4), np.float32)
    same, sp = resample(arr, (1.0, 1.0, 1.0), None, 1)
    assert same is arr and sp == (1.0, 1.0, 1.0)
    out, sp = resample(arr, (1.0, 1.0, 1.0), 2.0, 1)
    assert out.shape == (2, 2, 2)
    assert sp == (2.0, 2.0, 2.0)


def test_body_bbox_trims_air():
    ct = np.full((8, 8, 8), -1000, np.int16)
    ct[3:5, 3:5, 3:5] = 0
    assert body_bbox(ct, margin=0) == (slice(3, 5),) * 3


def test_build_label_map_later_wins_and_drops_empty():
    liver = np.zeros((4, 4, 4), bool)
    liver[:2] = True
    seg = np.zeros_like(liver)
    seg[1:3] = True
    structures = [{"key": "liver"}, {"key": "liver_segment_1"}, {"key": "empty_thing"}]
    masks = {"liver": liver, "liver_segment_1": seg, "empty_thing": np.zeros_like(liver)}
    lab, kept = build_label_map(masks, structures)
    assert [s["key"] for s in kept] == ["liver", "liver_segment_1"]
    assert [s["id"] for s in kept] == [1, 2]
    assert lab.dtype == np.uint8
    assert lab[0, 0, 0] == 1 and lab[1, 0, 0] == 2 and lab[2, 0, 0] == 2 and lab[3, 0, 0] == 0


def test_best_slices_picks_max_area():
    lab = np.zeros((5, 5, 5), np.uint8)
    lab[0, 0, 1] = 1
    lab[:, :, 3] = 1
    assert best_slices(lab, [1])[1]["axial"] == 3


def test_write_volume_layout(tmp_path):
    x, y, z = np.meshgrid(np.arange(2), np.arange(3), np.arange(4), indexing="ij")
    arr = (x + 10 * y + 100 * z).astype(np.int16)
    write_volume(str(tmp_path / "v.bin.gz"), arr, "<i2")
    flat = np.frombuffer(gzip.decompress((tmp_path / "v.bin.gz").read_bytes()), "<i2")
    for (i, j, k), v in np.ndenumerate(arr):
        assert flat[k * 3 * 2 + j * 2 + i] == v


def make_case_dir(d, labels, structures):
    os.makedirs(d, exist_ok=True)
    X, Y, Z = labels.shape
    write_volume(os.path.join(d, "ct.bin.gz"), np.zeros(labels.shape, np.int16), "<i2")
    write_volume(os.path.join(d, "labels.bin.gz"), labels, "u1")
    with open(os.path.join(d, "meta.json"), "w") as f:
        json.dump({"dims": [X, Y, Z], "structures": structures}, f)


def test_validate_case_accepts_good_case(tmp_path):
    lab = np.zeros((3, 3, 3), np.uint8)
    lab[1, 1, 1] = 1
    make_case_dir(tmp_path, lab, [{"id": 1}])
    validate_case(str(tmp_path))


def test_validate_case_rejects_unknown_label(tmp_path):
    lab = np.zeros((3, 3, 3), np.uint8)
    lab[1, 1, 1] = 7
    make_case_dir(tmp_path, lab, [{"id": 1}])
    with pytest.raises(AssertionError):
        validate_case(str(tmp_path))


def test_check_tasks_rejects_tasks_outside_allow_list():
    from caselib import check_tasks
    with pytest.raises(ValueError, match="face"):
        check_tasks(["total", "face"])
    check_tasks(["total", "ventricle_parts", "brain_structures"])


def test_select_structures_overrides_and_filters():
    from caselib import select_structures
    catalogue = [
        {"key": "hyoid", "system": "skull-face", "source": "headneck_bones_vessels"},
        {"key": "liver", "system": "organs", "source": "total"},
        {"key": "brain", "system": "brain", "source": "total"},
    ]
    case = {"tasks": ["total", "headneck_bones_vessels"], "systems": ["larynx", "brain"],
            "systemOverrides": {"hyoid": "larynx"}}
    out = select_structures(catalogue, case)
    assert [(s["key"], s["system"]) for s in out] == [("hyoid", "larynx"), ("brain", "brain")]
    assert catalogue[0]["system"] == "skull-face"  # catalogue not mutated
    assert [s["key"] for s in select_structures(catalogue, {**case, "exclude": ["brain"]})] == ["hyoid"]


def test_write_volume_is_deterministic(tmp_path):
    import time
    arr = np.arange(24, dtype=np.int16).reshape(2, 3, 4)
    write_volume(str(tmp_path / "a.bin.gz"), arr, "<i2")
    time.sleep(1.1)
    write_volume(str(tmp_path / "b.bin.gz"), arr, "<i2")
    assert (tmp_path / "a.bin.gz").read_bytes() == (tmp_path / "b.bin.gz").read_bytes()
