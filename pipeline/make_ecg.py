"""Turn the PTB-XL records listed in pipeline/ecgs.json into site/ecg/<id>.json + site/ecg/index.json.

Usage: make_ecg.py [--data data/ptbxl] [--out site]
Downloads only the metadata CSVs and the listed 500 Hz records from PhysioNet (cached under --data).
"""
import argparse
import ast
import csv
import json
import os
import urllib.request

import numpy as np
from scipy.signal import medfilt

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "https://physionet.org/files/ptb-xl/1.0.3/"
SOURCE = {"name": "PTB-XL (Wagner et al., PhysioNet)", "license": "CC BY 4.0",
          "url": "https://doi.org/10.13026/kfzx-aw45"}
LEAD_NAMES = {"AVR": "aVR", "AVL": "aVL", "AVF": "aVF"}


def fetch(rel, data):
    path = os.path.join(data, rel)
    if not os.path.exists(path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        urllib.request.urlretrieve(BASE + rel, path)
    return path


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
    p.add_argument("--out", default="site")
    a = p.parse_args(argv)

    picks = json.load(open(os.path.join(HERE, "ecgs.json"), encoding="utf-8"))
    db = {r["ecg_id"]: r for r in csv.DictReader(open(fetch("ptbxl_database.csv", a.data), encoding="utf-8"))}
    scp = {r[""]: r["description"] for r in csv.DictReader(open(fetch("scp_statements.csv", a.data), encoding="utf-8"))}
    out = os.path.join(a.out, "ecg")
    os.makedirs(out, exist_ok=True)

    index = []
    for pick in picks:
        r = db[str(pick["id"])]
        stem = r["filename_hr"]
        hea = open(fetch(stem + ".hea", a.data), encoding="utf-8").read()
        dat = open(fetch(stem + ".dat", a.data), "rb").read()
        fs, leads, uv = read_record(hea, dat)
        codes = ast.literal_eval(r["scp_codes"])
        rec = {
            "id": pick["id"], "title": pick["title"], "fs": fs, "units": "uV",
            "age": None if r["age"] in ("", "300") else int(float(r["age"])),  # PTB-XL codes age >89 as 300
            "sex": {"0": "M", "1": "F"}.get(r["sex"]),
            "axis": r["heart_axis"] or None,
            "statements": [{"code": c, "text": scp.get(c, c), "likelihood": v} for c, v in codes.items()],
            "leads": {name: uv[i].tolist() for i, name in enumerate(leads)},
            "source": SOURCE,
        }
        with open(os.path.join(out, f"{pick['id']}.json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, ensure_ascii=False, separators=(",", ":"))
        index.append({"id": pick["id"], "title": pick["title"]})
        print(pick["id"], pick["title"]["en"], fs, "Hz", len(leads), "leads")
    with open(os.path.join(out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
