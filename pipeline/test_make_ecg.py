import numpy as np

from make_ecg import read_record, remove_baseline


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
