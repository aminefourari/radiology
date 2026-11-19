import numpy as np

import struct

from make_ecg import pair_waves, read_annotations, read_record, remove_baseline


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
