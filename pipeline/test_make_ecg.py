import numpy as np

import struct

from make_ecg import derive_answers, pair_waves, read_12sl, read_annotations, read_record, remove_baseline


def test_read_record_scales_to_microvolts_and_renames_leads():
    hea = "r 2 500 4\nr.dat 16 1000.0(0)/mV 16 0 0 0 0 I\nr.dat 16 200/mV 16 5 0 0 0 AVR\n"
    # samples interleaved [s0 lead0, s0 lead1, s1 lead0, ...]
    raw = np.array([0, 5, 1000, 205, 0, 5, 0, 5], dtype="<i2").tobytes()
    fs, leads, uv = read_record(hea, raw)  # 4 samples: shorter than the filters, baseline stays 0
    assert fs == 500
    assert leads == ["I", "aVR"]
    assert uv[0].tolist() == [0, 1000, 0, 0]  # 1000 adu at 1000/mV = 1 mV
    assert uv[1].tolist() == [0, 1000, 0, 0]  # (205-5) adu at 200/mV = 1 mV


def test_remove_baseline_flattens_drift_but_keeps_spikes():
    fs = 500
    t = np.arange(5 * fs) / fs
    drift = 500 * np.sin(2 * np.pi * 0.2 * t)
    beat = np.zeros_like(t)
    beat[::fs] = 1000  # one narrow 1 mV spike per second
    out = remove_baseline(np.stack([drift + beat]), fs)[0]
    assert np.abs(out[beat == 0][fs:-fs]).max() < 30
    assert out[2 * fs] > 900


def _note(delta, text):
    b = text.encode()
    return struct.pack("<H", (22 << 10) | delta) + struct.pack("<H", (63 << 10) | len(b)) + b + b"\0" * (len(b) & 1)


def test_read_annotations_handles_negative_skip_and_aux():
    skip = struct.pack("<H", 59 << 10) + struct.pack("<HH", 0xFFFF, 0xFFFF)  # -1, as ECGDeli writes
    data = _note(0, "## time resolution: 500") + skip + _note(1, "p-wave onset") + _note(1000 - 0, "p-wave offset") + b"\0\0"
    assert read_annotations(data) == [(0, "## time resolution: 500"), (0, "p-wave onset"), (1000, "p-wave offset")]


def test_pair_waves_matches_onset_to_offset_per_kind():
    pts = [(10, "p-wave onset"), (40, "QRS onset"), (45, "p-wave offset"), (50, "R peak"), (60, "QRS offset"),
           (90, "t-wave onset"), (150, "t-wave offset"), (200, "QRS offset")]  # stray offset ignored
    assert pair_waves(pts) == [{"k": "P", "on": 10, "off": 45}, {"k": "QRS", "on": 40, "off": 60}, {"k": "T", "on": 90, "off": 150}]


NORMAL_M = {"hr": 75, "pr": 160, "qrs": 90, "qt": 380, "qtc": 420, "axis": 30, "pFound": True}


def _a(sex="M", codes=("SR",), st="normal", override=None, **m):
    return derive_answers({**NORMAL_M, **m}, set(codes), sex, st, override or {})[0]


def test_derive_thresholds():
    assert [_a(hr=v)["rate"] for v in (59, 60, 100, 101)] == ["slow", "normal", "normal", "fast"]
    assert [_a(axis=v)["axis"] for v in (-30, -31, 90, 91)] == ["normal", "left", "normal", "right"]
    assert [_a(pr=v)["pr"] for v in (119, 120, 200, 201)] == ["short", "normal", "normal", "long"]
    assert [_a(qrs=v)["qrs"] for v in (119, 120)] == ["narrow", "wide"]
    assert _a(qtc=451)["qt"] == "long"
    assert _a(sex="F", qtc=451)["qt"] == "normal"
    assert _a(sex="F", qtc=461)["qt"] == "long"
    assert _a(sex=None, qtc=451)["qt"] == "long"
    assert _a(qtc=450)["qt"] == "normal"


def test_derive_missing_values():
    a = _a(pr=None, axis=None, qtc=None, hr=None)
    assert (a["pr"], a["axis"], a["qt"], a["rate"]) == ("none", "normal", "normal", "normal")


def test_derive_rhythm_codes():
    a = _a(codes=("AFIB",), pr=180)
    assert (a["rhythm"], a["pr"]) == ("no", "none")
    assert _a(codes=("SR", "NORM"))["rhythm"] == "yes"
    assert _a(codes=("NORM", "PVC", "SR"))["rhythm"] == "no"


def test_override_wins_and_returns_note():
    answers, notes = derive_answers(NORMAL_M, {"SR"}, "M", "elevated", {"axis": {"answer": "left", "note": {"en": "x"}}})
    assert answers["axis"] == "left"
    assert answers["st"] == "elevated"
    assert notes == {"axis": {"en": "x"}}


def test_read_12sl(tmp_path):
    p = tmp_path / "f.csv"
    p.write_text("ecg_id,HR__Global,PR_Int_Global,QRS_Dur_Global,QT_Int_Global,QT_IntBazett_Global,R_AxisFrontal_Global,P_Found_Global\n"
                 "7,66.0,,118.0,426.0,440.0,-29.0,0\n8,1,1,1,1,1,1,1\n")
    assert read_12sl(str(p), {7}) == {7: {"hr": 66.0, "pr": None, "qrs": 118.0, "qt": 426.0, "qtc": 440.0, "axis": -29.0, "pFound": False}}


def test_pr_stays_measurable_with_ectopic_beats():
    a = _a(codes=("NORM", "PVC", "SR"), pr=164)
    assert (a["rhythm"], a["pr"]) == ("no", "normal")  # PVCs have no P, but sinus beats have a normal PR
    assert _a(codes=("NORM", "PAC", "SR"))["rhythm"] == "yes"  # a PAC has its own (early) P wave
    assert _a(codes=("2AVB",), pr=180)["pr"] == "none"


def test_pair_waves_drops_waves_cut_off_by_the_record_end():
    pts = [(10, "QRS onset"), (20, "QRS offset"), (4998, "t-wave onset"), (5000, "t-wave offset")]
    assert pair_waves(pts, n=5000) == [{"k": "QRS", "on": 10, "off": 20}]
