import json
import os

import nibabel as nib
import pytest
import numpy as np

from caselib import validate_case
from make_case import main


def fake_dataset(d):
    os.makedirs(d / "segmentations")
    ct = np.full((20, 20, 20), -1000, np.int16)
    ct[4:16, 4:16, 2:18] = 40
    nib.save(nib.Nifti1Image(ct, np.eye(4)), str(d / "ct.nii.gz"))
    for key, sl in {"liver": np.s_[5:9, 5:9, 5:9], "aorta": np.s_[10:12, 10:12, 3:17]}.items():
        m = np.zeros(ct.shape, np.uint8)
        m[sl] = 1
        nib.save(nib.Nifti1Image(m, np.eye(4)), str(d / "segmentations" / f"{key}.nii.gz"))


def test_make_case_end_to_end(tmp_path):
    src = tmp_path / "src"
    fake_dataset(src)
    site = tmp_path / "site"
    case_file = tmp_path / "t1.json"
    case_file.write_text(json.dumps({
        "region": "abdomen-pelvis", "title": {"en": "T"}, "tasks": ["total"],
        "systems": ["organs", "arteries"], "defaultSystems": ["organs", "veins"],
        "windows": ["soft", "bone"], "keyLevels": []}))
    args = [str(src), "t1", "--case-file", str(case_file), "--out", str(site)]
    main(args)
    main(args)  # idempotent re-run
    case = site / "cases" / "t1"
    validate_case(str(case))
    meta = json.loads((case / "meta.json").read_text(encoding="utf-8"))
    assert [s["key"] for s in meta["structures"]] == ["liver", "aorta"]
    for s in meta["structures"]:
        assert set(s["best"]) == {"axial", "coronal", "sagittal"}
        assert s["names"]["en"]
    assert meta["source"]["license"] == "CC BY 4.0"
    assert [s["key"] for s in meta["systems"]] == ["organs", "arteries"]
    assert all(s["names"]["en"] for s in meta["systems"])
    assert meta["defaultSystems"] == ["organs"]
    assert meta["windows"] == ["soft", "bone"]
    assert meta["region"] == "abdomen-pelvis"
    assert meta["source"]["tasks"] == ["total"]
    index = json.loads((site / "cases" / "index.json").read_text(encoding="utf-8"))
    assert [(c["id"], c["region"]) for c in index] == [("t1", "abdomen-pelvis")]


def test_case_file_z_range_crops(tmp_path):
    src = tmp_path / "src"
    fake_dataset(src)
    case_file = tmp_path / "t2.json"
    case_file.write_text(json.dumps({
        "region": "chest", "title": {"en": "T"}, "tasks": ["total"], "zRange": "5:12", "yRange": "0:8",
        "systems": ["organs", "arteries"], "defaultSystems": ["organs"], "windows": ["soft"], "keyLevels": []}))
    main([str(src), "t2", "--case-file", str(case_file), "--out", str(tmp_path / "site")])
    meta = json.loads((tmp_path / "site" / "cases" / "t2" / "meta.json").read_text(encoding="utf-8"))
    assert meta["dims"][2] == 7
    assert meta["dims"][1] <= 8


def test_trunk_region_and_case_budget(tmp_path):
    src = tmp_path / "src"
    fake_dataset(src)
    case_file = tmp_path / "t3.json"
    base = {"region": "trunk", "title": {"en": "T"}, "tasks": ["total"], "systems": ["organs"],
            "defaultSystems": ["organs"], "windows": ["soft"], "keyLevels": []}
    case_file.write_text(json.dumps(base))
    main([str(src), "t3", "--case-file", str(case_file), "--out", str(tmp_path / "site")])
    meta = json.loads((tmp_path / "site" / "cases" / "t3" / "meta.json").read_text(encoding="utf-8"))
    assert meta["region"] == "trunk"
    case_file.write_text(json.dumps({**base, "budgetMB": 0.000001}))
    with pytest.raises(AssertionError, match="over budget"):
        main([str(src), "t3", "--case-file", str(case_file), "--out", str(tmp_path / "site")])
