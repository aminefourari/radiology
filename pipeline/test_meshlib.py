import gzip
import json

import numpy as np

from meshlib import build_meshes, structure_mesh, write_meshes


def ball(n=20, r=5):
    g = np.indices((n, n, n)) - n / 2
    return (g ** 2).sum(0) <= r * r


def test_sphere_mesh_lies_in_mm_box():
    v, f = structure_mesh(ball(), (1.5, 1.5, 1.5), 2000)
    assert 0 < len(f) <= 2000
    assert v.min() >= (10 - 5) * 1.5 - 2 and v.max() <= (10 + 5) * 1.5 + 2


def test_tiny_mask_still_meshes():
    m = np.zeros((10, 10, 10), bool)
    m[4:6, 4:6, 4:6] = True
    assert structure_mesh(m, (1.5, 1.5, 1.5), 200) is not None


def test_empty_mask_has_no_mesh():
    assert structure_mesh(np.zeros((6, 6, 6), bool), (1, 1, 1), 200) is None


STRUCTS = [
    {"id": 1, "key": "liver", "parent": None},
    {"id": 2, "key": "seg_a", "parent": 1},
    {"id": 3, "key": "seg_b", "parent": 1},
    {"id": 4, "key": "absent", "parent": None},
]


def two_halves():
    lab = np.zeros((20, 20, 20), np.uint8)
    b = ball()
    lab[b & (np.indices(b.shape)[0] < 10)] = 2
    lab[b & (np.indices(b.shape)[0] >= 10)] = 3
    return lab


def test_parent_gets_union_mesh_and_children_own():
    entries = build_meshes(two_halves(), (1, 1, 1), STRUCTS, total_tris=3000)
    ids = sorted(e["id"] for e in entries)
    assert ids == [1, 2, 3]
    union = next(e for e in entries if e["id"] == 1)
    assert union["size"] == int(ball().sum())


def test_write_round_trip(tmp_path):
    entries = build_meshes(two_halves(), (1.5, 1.5, 1.5), STRUCTS, total_tris=3000)
    write_meshes(tmp_path, entries)
    idx = json.load(open(tmp_path / "meshes.json"))
    raw = gzip.open(tmp_path / "mesh.bin.gz").read()
    assert len(raw) == sum(m["vertexCount"] * 6 + m["indexCount"] * 2 for m in idx["meshes"])
    box = np.array(idx["box"])
    for m, e in zip(idx["meshes"], entries):
        q = np.frombuffer(raw, np.uint16, m["vertexCount"] * 3, m["offset"]).reshape(-1, 3)
        pos = box[:3] + q / 65535 * (box[3:] - box[:3])
        assert np.abs(pos - e["verts"]).max() < 0.01
        ind = np.frombuffer(raw, np.uint16, m["indexCount"], m["offset"] + m["vertexCount"] * 6)
        assert ind.max() < m["vertexCount"]
        assert len(m["anchor"]) == 3
