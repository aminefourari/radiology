"""Pure helpers for the heart conduction graph (see make_atlas.py heart). numpy only."""
import numpy as np


def vertex_area(verts, tris):
    """Per-vertex area: a third of each adjacent triangle's area."""
    v = np.asarray(verts, float)
    t = np.asarray(tris)
    a = np.linalg.norm(np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]]), axis=1) / 2
    out = np.zeros(len(v))
    for k in range(3):
        np.add.at(out, t[:, k], a / 3)
    return out


def radius_edges(pos, group, r):
    """[(a, b, length)] for a < b in the same group closer than r. Brute force: fine at ~10k points."""
    pos = np.asarray(pos, float)
    group = np.asarray(group)
    out = []
    for a in range(len(pos)):
        d = np.linalg.norm(pos[a + 1:] - pos[a], axis=1)
        for j in np.nonzero((d < r) & (group[a + 1:] == group[a]))[0]:
            out.append((a, a + 1 + int(j), float(d[j])))
    return out


def snap_landmarks(pos, landmarks, tol_mm=3.0):
    """name -> nearest vertex id (or list of ids for a polyline). ValueError naming any point > tol_mm away."""
    pos = np.asarray(pos, float)

    def snap(name, p):
        d = np.linalg.norm(pos - np.asarray(p, float), axis=1)
        i = int(d.argmin())
        if d[i] > tol_mm:
            raise ValueError(f"landmark {name} is {d[i]:.1f} mm from the mesh (limit {tol_mm} mm)")
        return i

    out = {}
    for name, p in landmarks.items():
        out[name] = [snap(name, q) for q in p] if np.ndim(p) == 2 else snap(name, p)
    return out


def boundary_loops(tris):
    """Ordered vertex loops along edges used by one triangle only, largest first."""
    from collections import Counter, defaultdict
    count = Counter(frozenset(e) for t in tris for e in ((t[0], t[1]), (t[1], t[2]), (t[2], t[0])))
    nbr = defaultdict(list)
    for e, c in count.items():
        if c == 1:
            a, b = tuple(e)
            nbr[int(a)].append(int(b))
            nbr[int(b)].append(int(a))
    seen, loops = set(), []
    for s in sorted(nbr):
        if s in seen:
            continue
        loop, prev, cur = [s], None, s
        seen.add(s)
        while True:
            nxt = [n for n in nbr[cur] if n != prev and n not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            loop.append(cur)
        loops.append(loop)
    return sorted(loops, key=len, reverse=True)


def components(n, tris):
    """Connected-component label per vertex (union-find over triangles)."""
    par = list(range(n))

    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]
            a = par[a]
        return a

    for t in tris:
        for v in t[1:]:
            par[find(int(v))] = find(int(t[0]))
    return np.array([find(i) for i in range(n)])


def nearest_links(src, dst, k=3, max_mm=14.0):
    """[(i, j)]: each src point i to its k nearest dst points j closer than max_mm."""
    src, dst = np.asarray(src, float), np.asarray(dst, float)
    out = []
    for i, p in enumerate(src):
        d = np.linalg.norm(dst - p, axis=1)
        out += [(i, int(j)) for j in np.argsort(d)[:k] if d[j] < max_mm]
    return out
