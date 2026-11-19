"""Turn the PTB-XL records (plus PTB-XL+ wave boundaries) listed in pipeline/ecgs.json into site/ecg/<id>.json + site/ecg/index.json.

Usage: make_ecg.py [--data data/ptbxl] [--out site]
Downloads only the metadata CSVs and the listed 500 Hz records from PhysioNet (cached under --data).
"""
import argparse
import ast
import csv
import json
import os
import struct
import urllib.request

import numpy as np
from scipy.signal import medfilt

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://physionet.org/files/ptb-xl/1.0.3/"
PLUS = "https://physionet.org/files/ptb-xl-plus/1.0.1/"
SOURCE = {"name": "PTB-XL (Wagner et al., PhysioNet)", "license": "CC BY 4.0",
          "url": "https://doi.org/10.13026/kfzx-aw45"}
WAVES_SOURCE = {"name": "PTB-XL+ (Strodthoff et al., PhysioNet), ECGDeli", "license": "CC BY 4.0",
                "url": "https://doi.org/10.13026/g6h6-7g88"}
# Rhythms where ECGDeli's one-P-per-beat output would mislead (no P waves, or P not tied to QRS).
NO_P_CODES = {"AFIB", "AFLT", "PSVT", "SVTAC", "2AVB", "3AVB"}
WAVE_KINDS = {"p-wave": "P", "QRS": "QRS", "t-wave": "T"}
MEASURES_SOURCE = {"name": "PTB-XL+ 12SL features (GE Marquette 12SL)", "license": "CC BY 4.0",
                   "url": "https://doi.org/10.13026/g6h6-7g88"}
MEASURE_COLS = {"hr": "HR__Global", "pr": "PR_Int_Global", "qrs": "QRS_Dur_Global", "qt": "QT_Int_Global",
                "qtc": "QT_IntBazett_Global", "axis": "R_AxisFrontal_Global"}
# Not every QRS has its own preceding P wave.
NOT_ONE_P_PER_QRS = {"AFIB", "AFLT", "PSVT", "SVTAC", "2AVB", "3AVB", "PACE", "BIGU", "PVC", "PAC"}
LEAD_NAMES = {"AVR": "aVR", "AVL": "aVL", "AVF": "aVF"}


def fetch(rel, data, base=BASE):
    path = os.path.join(data, rel)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(base + rel, path)
    return path


def read_annotations(b):
    """WFDB/MIT annotation bytes → [(sample, aux text)] for annotations carrying an aux string."""
    out, t, i = [], 0, 0
    while i + 2 <= len(b):
        (w,) = struct.unpack_from("<H", b, i)
        i += 2
        code, n = w >> 10, w & 0x3FF
        if code == 0 and n == 0:
            break
        if code == 59:  # SKIP: signed 32-bit, high word first
            hi, lo = struct.unpack_from("<HH", b, i)
            i += 4
            t += struct.unpack("<i", struct.pack("<I", (hi << 16) | lo))[0]
        elif code == 63:  # AUX string attached to the previous annotation
            out[-1] = (out[-1][0], b[i:i + n].decode("latin-1"))
            i += n + (n & 1)
        elif code < 59:
            t += n
            out.append((t, None))
    return [(s, a) for s, a in out if a]


def pair_waves(points):
    """ECGDeli '<wave> onset' / '<wave> offset' notes → [{"k": P|QRS|T, "on": s, "off": s}]."""
    waves, open_ = [], {}
    for s, text in points:
        for prefix, k in WAVE_KINDS.items():
            if text == f"{prefix} onset":
                open_[k] = s
            elif text == f"{prefix} offset" and k in open_:
                on = open_.pop(k)
                if s > on:
                    waves.append({"k": k, "on": on, "off": s})
    return sorted(waves, key=lambda w: w["on"])


def read_12sl(path, ids):
    """PTB-XL+ 12SL feature CSV → {ecg_id: {hr, pr, qrs, qt, qtc, axis, pFound}} for the given ids; blanks → None."""
    num = lambda v: float(v) if v not in ("", None) else None
    out = {}
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            i = int(r["ecg_id"])
            if i in ids:
                out[i] = {k: num(r[c]) for k, c in MEASURE_COLS.items()}
                out[i]["pFound"] = r["P_Found_Global"] == "1"
    return out


def derive_answers(m, codes, sex, st, override):
    """Measurements + SCP codes → answers for each reading step; overrides win and carry notes."""
    hr, axis, pr, qtc = m.get("hr"), m.get("axis"), m.get("pr"), m.get("qtc")
    rhythm = "no" if codes & NOT_ONE_P_PER_QRS else "yes"
    a = {
        "rate": "slow" if hr is not None and hr < 60 else "fast" if hr is not None and hr > 100 else "normal",
        "rhythm": rhythm,
        "axis": "left" if axis is not None and axis < -30 else "right" if axis is not None and axis > 90 else "normal",
        "pr": "none" if pr is None or rhythm == "no" else "short" if pr < 120 else "long" if pr > 200 else "normal",
        "qrs": "wide" if (m.get("qrs") or 0) >= 120 else "narrow",
        "qt": "long" if qtc is not None and qtc > (460 if sex == "F" else 450) else "normal",
        "st": st,
    }
    notes = {}
    for step, o in override.items():
        a[step] = o["answer"]
        if o.get("note"):
            notes[step] = o["note"]
    return a, notes


def read_record(hea_text, dat_bytes):
    """WFDB format-16 record → (fs, lead names, int µV array [leads][samples]), baseline-centred."""
    lines = [l for l in hea_text.splitlines() if l.strip() and not l.startswith("#")]
    _, n_sig, fs, n = lines[0].split()[:4]
    n_sig, fs, n = int(n_sig), int(float(fs)), int(n)
    leads, gains, zeros = [], [], []
    for l in lines[1:1 + n_sig]:
        f = l.split()
        if f[1] != "16":
            raise ValueError(f"unsupported WFDB format {f[1]}")
        gains.append(float(f[2].split("(")[0].split("/")[0]))
        zeros.append(int(f[4]))
        leads.append(LEAD_NAMES.get(f[-1], f[-1]))
    raw = np.frombuffer(dat_bytes, dtype="<i2", count=n * n_sig).reshape(n, n_sig).T.astype(np.float64)
    uv = (raw - np.array(zeros)[:, None]) / np.array(gains)[:, None] * 1000.0
    return fs, leads, np.rint(remove_baseline(uv, fs)).astype(int)


def remove_baseline(uv, fs):
    """Two-pass median filter (200 ms, then 600 ms) estimates baseline wander; subtract it per lead."""
    odd = lambda s: int(s * fs) // 2 * 2 + 1
    base = np.stack([medfilt(medfilt(x, odd(0.2)), odd(0.6)) for x in uv])
    return uv - base


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("--data", default=os.path.join("data", "ptbxl"))
    p.add_argument("--plus", default=os.path.join("data", "ptbxl-plus"))
    p.add_argument("--out", default="site")
    p.add_argument("--allow-missing-content", action="store_true", help="default st to normal while content is written")
    a = p.parse_args(argv)

    picks = json.load(open(os.path.join(HERE, "ecgs.json"), encoding="utf-8"))
    db = {r["ecg_id"]: r for r in csv.DictReader(open(fetch("ptbxl_database.csv", a.data), encoding="utf-8"))}
    scp = {r[""]: r["description"] for r in csv.DictReader(open(fetch("scp_statements.csv", a.data), encoding="utf-8"))}
    measures = read_12sl(fetch("features/12sl_features.csv", a.plus, PLUS), {e["id"] for e in picks})
    out = os.path.join(a.out, "ecg")
    os.makedirs(out, exist_ok=True)

    index = []
    for pick in picks:
        r = db[str(pick["id"])]
        stem = r["filename_hr"]
        hea = open(fetch(stem + ".hea", a.data), encoding="utf-8").read()
        dat = open(fetch(stem + ".dat", a.data), "rb").read()
        fs, leads, uv = read_record(hea, dat)
        n = pick["id"]
        ann = open(fetch(f"fiducial_points/ecgdeli/{n // 1000 * 1000:05d}/{n:05d}_points_global.atr",
                         a.plus, PLUS), "rb").read()
        points = read_annotations(ann)
        if points and points[0][1].startswith("## time resolution") and int(points[0][1].split(":")[1]) != fs:
            raise ValueError(f"{n}: fiducial resolution differs from {fs} Hz")
        codes = ast.literal_eval(r["scp_codes"])
        if "st" not in pick and not a.allow_missing_content:
            raise ValueError(f"{n}: ecgs.json entry has no 'st' answer")
        sex = {"0": "M", "1": "F"}.get(r["sex"])
        answers, notes = derive_answers(measures[n], set(codes), sex, pick.get("st", "normal"), pick.get("override", {}))
        rec = {
            "id": pick["id"], "title": pick["title"], "fs": fs, "units": "uV",
            "age": None if r["age"] in ("", "300") else int(float(r["age"])),  # PTB-XL codes age >89 as 300
            "sex": sex,
            "axis": r["heart_axis"] or None,
            "statements": [{"code": c, "text": scp.get(c, c), "likelihood": v} for c, v in codes.items()],
            "group": pick["group"],
            "waves": [w for w in pair_waves(points) if not (w["k"] == "P" and NO_P_CODES & codes.keys())],
            "wavesSource": WAVES_SOURCE,
            "measures": measures[n], "measuresSource": MEASURES_SOURCE,
            "answers": answers, "notes": notes, "clues": pick.get("clues", []),
            "leads": {name: uv[i].tolist() for i, name in enumerate(leads)},
            "source": SOURCE,
        }
        with open(os.path.join(out, f"{pick['id']}.json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, separators=(",", ":"))
        index.append({"id": pick["id"], "group": pick["group"], "title": pick["title"]})
        print(pick["id"], pick["title"]["en"], fs, "Hz", len(leads), "leads")
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
