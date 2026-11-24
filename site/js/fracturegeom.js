// Fracture geometry on the atlas bones. DOM-free so Node can test it.
// A fragment is a convex region: the intersection of cuts. A cut { p, n } keeps the side its normal points to,
// n·(x − p) ≥ 0. Positions are world RAS mm. A vertex belongs to the first fragment containing it, else the intact bone.

const EPS = 1e-6;

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const lerp = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// { p, n } -> [nx, ny, nz, d] with the kept side at n·x + d ≥ 0.
export function plane(cut) {
  const n = unit(cut.n);
  return [...n, -dot(n, cut.p)];
}
const side = (pl, x) => pl[0] * x[0] + pl[1] * x[1] + pl[2] * x[2] + pl[3];

export function fragmentOf(x, fragments) {
  for (let f = 0; f < fragments.length; f++) if (fragments[f].cuts.every((c) => side(plane(c), x) >= 0)) return f;
  return -1;
}

// Sutherland–Hodgman against one plane. poly: [{ x, nrm }] (nrm optional). Returns [kept, rest].
export function clipPoly(poly, pl) {
  const keep = [], rest = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const sa = side(pl, a.x), sb = side(pl, b.x);
    (sa >= 0 ? keep : rest).push(a);
    if ((sa >= 0) !== (sb >= 0)) {
      const t = sa / (sa - sb);
      const m = { x: lerp(a.x, b.x, t) };
      if (a.nrm) m.nrm = unit(lerp(a.nrm, b.nrm, t));
      keep.push(m);
      rest.push(m);
    }
  }
  return [keep.length >= 3 ? keep : [], rest.length >= 3 ? rest : []];
}

// Smooth per-vertex normals of an indexed mesh.
export function vertexNormals(pos, idx) {
  const n = new Float64Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]].map((k) => [pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]]);
    const fn = cross(sub(b, a), sub(c, a)); // area-weighted
    for (const k of [idx[i], idx[i + 1], idx[i + 2]]) for (let d = 0; d < 3; d++) n[3 * k + d] += fn[d];
  }
  const out = [];
  for (let k = 0; k < pos.length; k += 3) out.push(unit([n[k], n[k + 1], n[k + 2]]));
  return out;
}

// Cuts an indexed mesh into the intact bone (piece 0) and one piece per fragment (piece f + 1), clipping
// triangles exactly at the cuts. Each piece: { pos: number[], nrm: number[] } as a triangle soup.
export function splitMesh(pos, idx, fragments) {
  const vn = vertexNormals(pos, idx);
  const pieces = Array.from({ length: fragments.length + 1 }, () => ({ pos: [], nrm: [] }));
  const planes = fragments.map((f) => f.cuts.map(plane));
  const emit = (piece, poly) => {
    for (let i = 1; i + 1 < poly.length; i++) for (const v of [poly[0], poly[i], poly[i + 1]]) {
      piece.pos.push(...v.x);
      piece.nrm.push(...v.nrm);
    }
  };
  for (let i = 0; i < idx.length; i += 3) {
    let rest = [[idx[i], idx[i + 1], idx[i + 2]].map((k) => ({ x: [pos[3 * k], pos[3 * k + 1], pos[3 * k + 2]], nrm: vn[k] }))];
    for (let f = 0; f < planes.length && rest.length; f++) {
      const next = [];
      for (const poly of rest) {
        let inside = poly;
        for (const pl of planes[f]) {
          const [k, r] = clipPoly(inside, pl);
          if (r.length) next.push(r);
          inside = k;
          if (!inside.length) break;
        }
        if (inside.length) emit(pieces[f + 1], inside);
      }
      rest = next;
    }
    for (const poly of rest) emit(pieces[0], poly);
  }
  return pieces;
}

// Closed loops where a plane [n, d] cuts an indexed mesh, as arrays of 3D points. Crossing points are keyed by
// mesh edge, so neighbouring triangles share them and the segments chain.
export function sectionLoops(pos, idx, pl) {
  const s = [];
  for (let k = 0; k < pos.length; k += 3) {
    const v = side(pl, [pos[k], pos[k + 1], pos[k + 2]]);
    s.push(Math.abs(v) < EPS ? EPS : v); // nudge vertices off the plane so every crossing is on an edge
  }
  const pts = new Map(), next = new Map();
  const point = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!pts.has(key)) {
      const t = s[a] / (s[a] - s[b]);
      pts.set(key, lerp([pos[3 * a], pos[3 * a + 1], pos[3 * a + 2]], [pos[3 * b], pos[3 * b + 1], pos[3 * b + 2]], t));
    }
    return key;
  };
  for (let i = 0; i < idx.length; i += 3) {
    const tri = [idx[i], idx[i + 1], idx[i + 2]];
    const cuts = [];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      if ((s[a] > 0) !== (s[b] > 0)) cuts.push({ key: point(a, b), up: s[a] > 0 });
    }
    if (cuts.length !== 2) continue;
    // Orient each segment the same way round the loop (leaving the positive side first).
    const [p, q] = cuts[0].up ? [cuts[0], cuts[1]] : [cuts[1], cuts[0]];
    next.set(p.key, q.key);
  }
  const loops = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    for (let k = start; k && !seen.has(k); k = next.get(k)) { seen.add(k); loop.push(pts.get(k)); }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

// A section loop clipped to a fragment's region (all cuts of the fragment). Points only.
export function clipLoop(loop, cuts) {
  let poly = loop.map((x) => ({ x }));
  for (const c of cuts) { poly = clipPoly(poly, plane(c))[0]; if (!poly.length) break; }
  return poly.map((v) => v.x);
}

// Cap polygons of one fragment: on each of its cut planes, the bone's section inside the fragment's other cuts.
export function fragmentCaps(pos, idx, fragment) {
  const caps = [];
  fragment.cuts.forEach((c, i) => {
    const others = fragment.cuts.filter((_, j) => j !== i);
    for (const loop of sectionLoops(pos, idx, plane(c))) {
      const poly = clipLoop(loop, others);
      if (poly.length >= 3) caps.push({ n: unit(c.n), poly });
    }
  });
  return caps;
}

// Displacement of a fragment as a column-major 4x4 (three.js Matrix4.fromArray order), scaled by t in [0, 1]:
// rotate by deg about axis through pivot, then translate by t (mm).
export function moveMatrix(move, t = 1) {
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (!move) return m;
  const tr = (move.t ?? [0, 0, 0]).map((v) => v * t);
  const ang = ((move.deg ?? 0) * t * Math.PI) / 180;
  const [x, y, z] = unit(move.axis ?? [0, 0, 1]);
  const c = Math.cos(ang), s = Math.sin(ang), k = 1 - c;
  const r = [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ];
  const pv = move.pivot ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) m[j * 4 + i] = r[i][j];
    m[12 + i] = pv[i] - dot(r[i], pv) + tr[i];
  }
  return m;
}

export function applyMatrix(m, x) {
  return [0, 1, 2].map((i) => m[i] * x[0] + m[4 + i] * x[1] + m[8 + i] * x[2] + m[12 + i]);
}

// 2D frame of a section plane: { p, n, up } -> project(x) = [u, v] in mm, u to the viewer's right, v up.
export function planeFrame({ p, n, up }) {
  const nn = unit(n);
  const v = unit(sub(up, nn.map((c) => c * dot(up, nn))));
  const u = cross(v, nn); // viewer looks along -n
  return { project: (x) => [dot(sub(x, p), u), dot(sub(x, p), v)], plane: plane({ p, n: nn }) };
}

// What the section view draws for one bone: the intact section and each fragment's section, displaced by its
// move at amount t, projected to 2D. Returns [{ frag: -1 | f, poly: [[u, v], ...] }].
export function sectionShapes(pos, idx, fragments, view, t = 1) {
  const fr = planeFrame(view);
  const out = [];
  const planes = fragments.map((f) => f.cuts.map(plane));
  for (const loop of sectionLoops(pos, idx, fr.plane)) {
    let rest = [loop.map((x) => ({ x }))];
    planes.forEach((pls, f) => {
      const m = moveMatrix(fragments[f].move, t), next = [];
      for (const poly of rest) {
        let inside = poly;
        for (const pl of pls) {
          const [k, r] = clipPoly(inside, pl);
          if (r.length) next.push(r);
          inside = k;
          if (!inside.length) break;
        }
        if (inside.length) out.push({ frag: f, poly: inside.map((v) => fr.project(applyMatrix(m, v.x))) });
      }
      rest = next;
    });
    for (const poly of rest) out.unshift({ frag: -1, poly: poly.map((v) => fr.project(v.x)) });
  }
  return out;
}

// shapes.json: a fracture's named cuts and per-type fragments, where a fragment lists cut names ("A", or "-A" for
// the other side). Returns the type's fragments with the cuts filled in.
export function typeFragments(shape, code) {
  const named = (ref) => {
    const flip = ref.startsWith("-"), c = shape.cuts[flip ? ref.slice(1) : ref];
    if (!c) throw new Error(`unknown cut ${ref}`);
    return flip ? { p: c.p, n: c.n.map((v) => -v) } : c;
  };
  return (shape.types[code]?.fragments ?? []).map((f) => ({ ...f, cuts: f.cuts.map(named) }));
}
