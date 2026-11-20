import numpy as np
import pytest

from heartlib import components, radius_edges, snap_landmarks, vertex_area

SQUARE = np.array([[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], float)
TWO_TRIS = np.array([[0, 1, 2], [0, 2, 3]])


def test_vertex_area_sums_to_mesh_area():
    a = vertex_area(SQUARE * 2, TWO_TRIS)
    assert a.shape == (4,)
    assert a.sum() == pytest.approx(4.0)


def test_radius_edges_join_close_points_of_the_same_group_only():
    pos = np.array([[0, 0, 0], [3, 0, 0], [0, 4, 0], [0, 0, 9]], float)
    group = np.array([0, 0, 1, 0])
    e = {(a, b) for a, b, _ in radius_edges(pos, group, 5.0)}
    assert e == {(0, 1)}  # (0,2) is close but crosses groups, (0,3) is too far
    (a, b, d), = radius_edges(pos, group, 5.0)
    assert d == pytest.approx(3.0)


def test_snap_landmarks_returns_nearest_vertex_and_rejects_far_points():
    pos = SQUARE * 10
    assert snap_landmarks(pos, {"sa": [9.5, 0, 0], "ring": [[0, 0, 0.5], [0, 10, 0]]}) == {"sa": 1, "ring": [0, 3]}
    with pytest.raises(ValueError, match="sa"):
        snap_landmarks(pos, {"sa": [5, 5, 5]})


def test_boundary_loops_are_ordered_rings_largest_first():
    from heartlib import boundary_loops
    # A 3x3 grid of quads (as triangles) with the centre quad removed: outer ring of 12, inner of 4.
    idx = lambda i, j: i * 4 + j
    tris = []
    for i in range(3):
        for j in range(3):
            if (i, j) != (1, 1):
                tris += [[idx(i, j), idx(i + 1, j), idx(i + 1, j + 1)], [idx(i, j), idx(i + 1, j + 1), idx(i, j + 1)]]
    loops = boundary_loops(np.array(tris))
    assert [len(l) for l in loops] == [12, 4]
    edges = {frozenset(e) for t in tris for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0]))}
    for l in loops:
        assert all(frozenset((l[k], l[(k + 1) % len(l)])) in edges for k in range(len(l)))



def test_components_labels_each_connected_piece():
    lab = components(5, np.array([[0, 1, 2], [3, 4, 3]]))
    assert lab[0] == lab[1] == lab[2] and lab[3] == lab[4] and lab[0] != lab[3]
