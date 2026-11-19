"""Build smooth 3D meshes for built cases: make_meshes.py site/cases/<id> [...]

Reads meta.json + labels.bin.gz, writes mesh.bin.gz + meshes.json next to them.
"""
import gzip
import json
import os
import sys

import numpy as np

from meshlib import build_meshes, write_meshes


def main(argv=None):
    for case_dir in argv if argv is not None else sys.argv[1:]:
        with open(os.path.join(case_dir, "meta.json"), encoding="utf-8") as f:
            meta = json.load(f)
        X, Y, Z = meta["dims"]
        with gzip.open(os.path.join(case_dir, "labels.bin.gz")) as f:
            labels = np.frombuffer(f.read(), np.uint8).reshape(Z, Y, X).transpose(2, 1, 0)
        entries = build_meshes(labels, tuple(meta["spacing"]), meta["structures"])
        write_meshes(case_dir, entries)
        tris = sum(len(e["faces"]) for e in entries)
        size = os.path.getsize(os.path.join(case_dir, "mesh.bin.gz"))
        print(f"{case_dir}: {len(entries)} meshes, {tris} triangles, {size / 2**20:.2f} MB")


if __name__ == "__main__":
    main()
