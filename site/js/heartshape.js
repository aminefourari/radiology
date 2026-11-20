// The idealised heart: smooth shells in textbook orientation, voxelised for the simulation. DOM-free.
// One shape feeds everything: the simulation graph (heartsim.loadGraph), the schematic slices and the 3D surface.
//
// Local frame (mm): u points to the right heart (RV side), v anterior, w from apex to base. The AV plane is w = 0:
// ventricles below, atria above a 3 mm fibrous gap. Chamber ids: 0 RA, 1 LA, 2 RV, 3 LV.

export const VOXEL = 2;
export const SHAPE = {
  lv: { c: [0, 0, 0], endo: [24, 24, 68], epi: [34, 34, 80] },
  rv: { c: [24, 6, 0], endo: [40, 24, 62], wall: 5 },
  ra: { c: [50, 0, 20], endo: [20, 18, 26], wall: 3.5 },
  la: { c: [4, -4, 20], endo: [24, 20, 24], wall: 3.5 },
  avGap: 3,
  // Orientation: long axis (base → apex) at `frontal`° on the hexaxial circle (0 = patient left, 90 = inferior),
  // tilted `tilt`° forward, then turned `roll`° about itself; the right heart faces right and forward.
  frontal: 41, tilt: 23, roll: 2, septum: [0.8, 0.5, -0.3],
  // Purkinje territories in the LV cross-section, by angle from the septum (local +u) towards anterior (+v): the left
  // septal fibres within ±septalDeg of the septum; the anterior fascicle's where cos(angle − split) > lafBias; the
  // posterior fascicle's the rest.
  septalDeg: 0, split: 91, lafBias: -0.13, rvSeptalTop: -39, rvSeptalMaxV: 99, rvPurkinjeTop: -12,
};

const add = (a, b) => a.map((x, i) => x + b[i]);
const q = (p, c, s) => Math.hypot((p[0] - c[0]) / s[0], (p[1] - c[1]) / s[1], (p[2] - c[2]) / s[2]);
const grow = (s, d) => s.map((x) => x + d);

// What is at a local point: { wall: chamber id or -1, cavity: chamber id or -1 }.
export function tissueAt(p, S = SHAPE) {
  const [, , w] = p;
  if (w <= 0) {
    const lvEndo = q(p, S.lv.c, S.lv.endo), lvEpi = q(p, S.lv.c, S.lv.epi);
    if (lvEndo < 1) return { wall: -1, cavity: 3 };
    if (lvEpi < 1) return { wall: 3, cavity: -1 };
    if (q(p, S.rv.c, S.rv.endo) < 1) return { wall: -1, cavity: 2 };
    if (q(p, S.rv.c, grow(S.rv.endo, S.rv.wall)) < 1) return { wall: 2, cavity: -1 };
    return { wall: -1, cavity: -1 };
  }
  if (w < S.avGap) return { wall: -1, cavity: -1 };
  const ra = q(p, S.ra.c, S.ra.endo), la = q(p, S.la.c, S.la.endo);
  if (ra < 1) return { wall: -1, cavity: 0 };
  if (la < 1) return { wall: -1, cavity: 1 };
  const inRa = q(p, S.ra.c, grow(S.ra.endo, S.ra.wall)) < 1, inLa = q(p, S.la.c, grow(S.la.endo, S.la.wall)) < 1;
  if (inRa && inLa) return { wall: ra < la ? 0 : 1, cavity: -1 }; // interatrial septum: the nearer cavity's side
  if (inRa) return { wall: 0, cavity: -1 };
  if (inLa) return { wall: 1, cavity: -1 };
  return { wall: -1, cavity: -1 };
}

const norm = (a) => { const n = Math.hypot(...a); return a.map((x) => x / n); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const perp = (a, n) => norm(a.map((x, i) => x - dot(a, n) * n[i]));

// Local axes as RAS unit vectors (RAS: +x patient right, +y anterior, +z superior).
export function axes(S = SHAPE) {
  const th = (S.frontal * Math.PI) / 180, ph = (S.tilt * Math.PI) / 180;
  const apex = [-Math.cos(th) * Math.cos(ph), Math.sin(ph), -Math.sin(th) * Math.cos(ph)];
  const W = apex.map((x) => -x);
  const U0 = perp(S.septum, W);
  let V0 = cross(W, U0);
  if (V0[1] < 0) V0 = V0.map((x) => -x);
  const r = (S.roll * Math.PI) / 180;
  const U = U0.map((x, i) => x * Math.cos(r) + V0[i] * Math.sin(r));
  const V = V0.map((x, i) => x * Math.cos(r) - U0[i] * Math.sin(r));
  return { U, V, W };
}
export const toRas = (ax, p) => [0, 1, 2].map((i) => p[0] * ax.U[i] + p[1] * ax.V[i] + p[2] * ax.W[i]);
export const toLocal = (ax, r) => [dot(r, ax.U), dot(r, ax.V), dot(r, ax.W)];

const BOUNDS = { lo: [-36, -36, -82], hi: [78, 36, 50] };

// Voxelises the walls. Returns { json, grid } where json is the heartsim graph format and grid indexes voxels.
export function buildHeart(S = SHAPE) {
  const ax = axes(S);
  const dims = BOUNDS.lo.map((lo, i) => Math.floor((BOUNDS.hi[i] - lo) / VOXEL) + 1);
  const index = new Int32Array(dims[0] * dims[1] * dims[2]).fill(-1);
  const local = [], chamber = [];
  for (let k = 0; k < dims[2]; k++) for (let j = 0; j < dims[1]; j++) for (let i = 0; i < dims[0]; i++) {
    const p = [BOUNDS.lo[0] + i * VOXEL, BOUNDS.lo[1] + j * VOXEL, BOUNDS.lo[2] + k * VOXEL];
    const { wall } = tissueAt(p, S);
    if (wall < 0) continue;
    index[i + dims[0] * (j + dims[1] * k)] = chamber.length;
    chamber.push(wall);
    local.push(p);
  }
  const n = chamber.length;
  const grid = { lo: BOUNDS.lo, dims, step: VOXEL, index, local, ax };

  // Nearest wall voxel to a local point, among chambers `ok`.
  const nearest = (p, ok) => {
    let best = -1, bd = Infinity;
    for (let v = 0; v < n; v++) {
      if (!ok.includes(chamber[v])) continue;
      const d = (local[v][0] - p[0]) ** 2 + (local[v][1] - p[1]) ** 2 + (local[v][2] - p[2]) ** 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  };
  // A polyline through wall voxels along waypoints, sampled every 2 mm, without repeats.
  const path = (pts, ok) => {
    const out = [];
    for (let s = 0; s < pts.length - 1; s++) {
      const steps = Math.max(1, Math.round(Math.hypot(...pts[s + 1].map((x, i) => x - pts[s][i])) / 2));
      for (let k = s ? 1 : 0; k <= steps; k++) {
        const v = nearest(pts[s].map((x, i) => x + ((pts[s + 1][i] - x) * k) / steps), ok);
        if (out.at(-1) !== v) out.push(v);
      }
    }
    return out;
  };

  // Directions in the LV cross-section (u, v): superior-anterior (where the anterior fascicle goes) and lateral.
  const supUV = [Math.cos((S.split * Math.PI) / 180), Math.sin((S.split * Math.PI) / 180)];
  const onEndo = (dir, w, out = 1.5) => {
    const r = S.lv.endo[0] * Math.sqrt(Math.max(0, 1 - ((w - S.lv.c[2]) / S.lv.endo[2]) ** 2)) + out;
    return [dir[0] * r, dir[1] * r, w];
  };
  const rot = (d, deg) => { const a = (deg * Math.PI) / 180; return [d[0] * Math.cos(a) - d[1] * Math.sin(a), d[0] * Math.sin(a) + d[1] * Math.cos(a)]; };
  // Anterior fascicle: from the septum towards the anterolateral wall (superior); posterior: the inferolateral wall.
  const lat = [-1, 0];
  const antDir = norm(add(supUV, lat)), postDir = norm(add(supUV.map((x) => -x), lat));
  const rvSeptum = S.lv.epi[0] - 1;

  const L = {
    sa: nearest([62, 6, 42], [0]),
    avnode: nearest([30, -2, 5], [0]),
    his: nearest([29, 0, -6], [3]),
    apex: nearest([0, 0, -80], [3]),
    lbb_end: nearest(onEndo([0.98, 0.2], -20), [3]),
  };
  const lines = {
    his: [L.avnode, L.his],
    lbb: path([[29, 0, -6], onEndo([0.98, 0.2], -12), onEndo([0.98, 0.2], -20)], [3]),
    laf: path([onEndo([0.98, 0.2], -20), onEndo(norm(add([0.98, 0.2], antDir)), -30), onEndo(antDir, -42)], [3]),
    lpf: path([onEndo([0.98, 0.2], -20), onEndo(norm(add([0.98, 0.2], postDir)), -32), onEndo(postDir, -46)], [3]),
    rbb: path([[29, 0, -6], [rvSeptum, 2, -20], [rvSeptum, 4, -38], [46, 10, -42], [57, 8, -36]], [2, 3]),
  };
  lines.lbb[0] = L.his; lines.rbb[0] = L.his; lines.laf[0] = lines.lbb.at(-1); lines.lpf[0] = lines.lbb.at(-1);

  // Purkinje regions: 0 left septal (LBB), 1 anterosuperior LV (LAF), 2 posteroinferior LV (LPF), 3 RV incl. the right septal
  // surface (RBB). Endocardial layer only, sparing the base.
  const purkinje = new Array(n).fill(-1);
  for (let v = 0; v < n; v++) {
    const p = local[v];
    if (chamber[v] === 3 && p[2] < -8 && q(p, S.lv.c, grow(S.lv.endo, 3)) < 1) {
      const d = norm([p[0], p[1]]);
      purkinje[v] = d[0] > Math.cos((S.septalDeg * Math.PI) / 180) && p[2] > -50 ? 0 : d[0] * supUV[0] + d[1] * supUV[1] > S.lafBias ? 1 : 2;
    } else if (p[2] < S.rvPurkinjeTop && ((chamber[v] === 2 && q(p, S.rv.c, grow(S.rv.endo, 2.5)) < 1) || (chamber[v] === 3 && p[2] < S.rvSeptalTop && p[1] < S.rvSeptalMaxV && q(p, S.rv.c, grow(S.rv.endo, 2.5)) < 1))) {
      purkinje[v] = 3;
    }
  }

  // Flutter circuit in the RA: up the septum, over the roof, down the lateral wall, back along the posterior floor
  // (the cavotricuspid isthmus, conducting slowly).
  const ring = path([[31, 0, 6], [33, 0, 36], [50, 0, 46], [68, 0, 36], [69, 0, 7], [62, -13, 5], [50, -16, 5], [38, -12, 5], [31, 0, 6]], [0]);
  ring.pop();
  const cti = path([[62, -13, 5], [50, -16, 5], [38, -12, 5]], [0]);

  // VT scar: an inferolateral LV patch; the circuit exits at its septal edge.
  const scarAt = [...onEndo(postDir, -40, 5)];
  const scar = [];
  for (let v = 0; v < n; v++) if (chamber[v] === 3 && Math.hypot(...local[v].map((x, i) => x - scarAt[i])) < 12) scar.push(v);

  Object.assign(L, {
    tricuspid_ring: ring, cti,
    vt_scar: scar, vt_exit: nearest(add(scarAt, [10 * Math.sign(-postDir[0]) || 10, 0, 10]), [3]),
    // Ectopic foci and pathways.
    pvc: nearest([-34, 0, -40], [3]),
    rvot: nearest([30, 24, -6], [2]),
    rv_apex: nearest([46, 10, -48], [2]), // RV apical free wall (pacing lead tip)
    lv_lateral: nearest([-34, -6, -30], [3]),
    fascicular: nearest(onEndo(postDir, -44), [3]),
    lra: nearest([34, -10, 6], [0]),
    hra: nearest([62, 6, 42], [0]),
    lateral_ra: nearest([70, 0, 22], [0]),
    la_focus: nearest([-26, -4, 20], [1]), // lateral LA wall
    accessory: [nearest([-22, 0, 5], [1]), nearest([-30, 0, -3], [3])],
    accessory_ps: [nearest([34, -14, 5], [0]), nearest([26, -20, -3], [2, 3])],
    // Numbered sites for the action-potential plots: RA, mid septum, LV lateral wall (all in the four-chamber plane).
    site_ra: nearest([66, 0, 24], [0]),
    site_septum: nearest([29, 0, -30], [3]),
    site_lv: nearest([-29, 0, -30], [3]),
  });

  // Bachmann's bundle: a fast band across the atrial roof from the SA node into the LA.
  const bachmann = path([[56, 4, 42], [30, 4, 45], [10, 0, 43], [-8, -2, 40]], [0, 1]);
  const links = bachmann.slice(1).map((v, i) => [bachmann[i], v, 6]); // tissue 6: heartsim TISSUE.bachmann

  const ras = local.map((p) => toRas(ax, p));
  // Heart centre: the ventricular centroid.
  const centre = [0, 0, 0];
  let nv = 0;
  for (let v = 0; v < n; v++) if (chamber[v] >= 2) { for (let i = 0; i < 3; i++) centre[i] += ras[v][i]; nv++; }
  for (let i = 0; i < 3; i++) centre[i] /= nv;

  const json = {
    pos: ras.flat(), chamber, area: new Array(n).fill(VOXEL ** 3), purkinje, lines, links, bachmannIds: bachmann,
    landmarks: L, electrodes: electrodes(centre).precordial, limbs: electrodes(centre).limbs, centre,
  };
  return { json, grid, bachmann };
}

// Torso: an elliptic cylinder; the heart sits left of the midline and forward. Precordial positions follow the
// standard landmarks (V1/V2 4th intercostal space beside the sternum, V4 mid-clavicular 5th, V5 anterior axillary,
// V6 mid-axillary).
export const TORSO = { dx: 15, dy: -50, halfWidth: 160, halfDepth: 110 };
export function electrodes(c, T = TORSO) {
  const cx = c[0] + T.dx, cy = c[1] + T.dy;
  const on = (x, z) => [x, cy + T.halfDepth * Math.sqrt(Math.max(0, 1 - ((x - cx) / T.halfWidth) ** 2)), z];
  const v2 = on(cx - 25, c[2] + 25), v4 = on(cx - 70, c[2] - 15);
  const precordial = {
    V1: on(cx + 25, c[2] + 25), V2: v2, V3: on((v2[0] + v4[0]) / 2, (v2[2] + v4[2]) / 2), V4: v4,
    V5: on(cx - 120, c[2] - 15), V6: on(cx - T.halfWidth + 1, c[2] - 15),
  };
  const limbs = { RA: [cx + 190, cy, c[2] + 180], LA: [cx - 190, cy, c[2] + 180], RL: [cx + 90, cy, c[2] - 420], LL: [cx - 90, cy, c[2] - 420] };
  return { precordial, limbs };
}

// ---------------------------------------------------------------------------------------------------------
// Views of the shape: schematic slices (pixel → voxel maps) and a smooth surface for 3D.

const voxelAt = (grid, p) => {
  const ijk = [0, 1, 2].map((k) => Math.round((p[k] - grid.lo[k]) / grid.step));
  if (ijk.some((x, k) => x < 0 || x >= grid.dims[k])) return -1;
  return grid.index[ijk[0] + grid.dims[0] * (ijk[1] + grid.dims[1] * ijk[2])];
};
// The wall voxel under a point, or the nearest one within one voxel (slices cut between lattice planes).
function nearestVoxel(grid, p) {
  const v = voxelAt(grid, p);
  if (v >= 0) return v;
  let best = -1, bd = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
    const q = [p[0] + dx * grid.step, p[1] + dy * grid.step, p[2] + dz * grid.step];
    const u = voxelAt(grid, q);
    if (u < 0) continue;
    const d = Math.hypot(...grid.local[u].map((x, k) => x - p[k]));
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

// Section planes in the local frame. A screen point (x right, y down, mm from the centre) is origin + x·ex + y·ey.
// Four-chamber: the plane through the long axis and both ventricles (v = 0), right heart on the viewer's left and
// the apex down and to the right, as textbooks draw it. Short axis: across the ventricles at `level` (0 apex … 1 base),
// seen from the apex, RV on the left, anterior up.
const TILT_4CH = (35 * Math.PI) / 180;
export function sectionPlane(section, level = 0.5) {
  if (section === "sax") {
    const w = -72 + 66 * level;
    return { section, level, origin: [12, 0, w], ex: [-1, 0, 0], ey: [0, -1, 0], half: 52 };
  }
  const c = Math.cos(TILT_4CH), s = Math.sin(TILT_4CH);
  return { section: "4ch", level, origin: [20, 0, -14], ex: [-c, 0, -s], ey: [s, 0, -c], half: 82 };
}
export const planePoint = (pl, x, y) => [0, 1, 2].map((k) => pl.origin[k] + x * pl.ex[k] + y * pl.ey[k]);
// Local point → screen mm (the out-of-plane part is dropped: a projection).
export const planeProject = (pl, p) => { const d = p.map((x, k) => x - pl.origin[k]); return [dot(d, pl.ex), dot(d, pl.ey)]; };

// Pixel maps for one slice drawn at size × size px: wall voxel per pixel (-1 none), wall coverage (anti-aliasing),
// cavity chamber + 1 (0 none) and outline strength, from 2×2 subsamples of the analytic shape.
export function slicePlane(grid, pl, size, S = SHAPE) {
  const n = size * size, mmPerPx = (2 * pl.half) / size;
  const node = new Int32Array(n).fill(-1), alpha = new Float32Array(n), cavity = new Uint8Array(n), edge = new Float32Array(n);
  const sub = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const i = py * size + px;
    const x = (px + 0.5) * mmPerPx - pl.half, y = (py + 0.5) * mmPerPx - pl.half;
    let wall = 0, cav = 0, cavId = 0;
    const kinds = new Set();
    for (const [sx, sy] of sub) {
      const t = tissueAt(planePoint(pl, x + sx * mmPerPx, y + sy * mmPerPx), S);
      if (t.wall >= 0) { wall++; kinds.add("w"); } else if (t.cavity >= 0) { cav++; cavId = t.cavity + 1; kinds.add(`c${t.cavity}`); } else kinds.add("o");
    }
    alpha[i] = wall / 4;
    if (cav) cavity[i] = cavId;
    if (kinds.size > 1) edge[i] = 1;
    if (wall) node[i] = nearestVoxel(grid, planePoint(pl, x, y));
  }
  return { size, mmPerPx, node, alpha, cavity, edge };
}

// Surface for 3D: naive surface nets on the wall occupancy (box-blurred), vertices in RAS, each with its nearest voxel.
export function surface(grid) {
  const [X, Y, Z] = grid.dims, at = (i, j, k) => i + X * (j + Y * k);
  const occ = new Float32Array(X * Y * Z);
  for (let i = 0; i < occ.length; i++) occ[i] = grid.index[i] >= 0 ? 1 : 0;
  const f = new Float32Array(occ.length);
  for (let k = 0; k < Z; k++) for (let j = 0; j < Y; j++) for (let i = 0; i < X; i++) {
    let s = 0, c = 0;
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const a = i + di, b = j + dj, d = k + dk;
      if (a < 0 || b < 0 || d < 0 || a >= X || b >= Y || d >= Z) { c++; continue; }
      s += occ[at(a, b, d)]; c++;
    }
    f[at(i, j, k)] = s / c;
  }
  const ISO = 0.35, vid = new Int32Array(X * Y * Z).fill(-1), pos = [], vertexNode = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (let k = 0; k < Z - 1; k++) for (let j = 0; j < Y - 1; j++) for (let i = 0; i < X - 1; i++) {
    const v = corners.map(([a, b, d]) => f[at(i + a, j + b, k + d)]);
    if (v.every((x) => x > ISO) || v.every((x) => x <= ISO)) continue;
    const p = [0, 0, 0];
    let m = 0;
    for (const [a, b] of edges) {
      if ((v[a] > ISO) === (v[b] > ISO)) continue;
      const t = (ISO - v[a]) / (v[b] - v[a]);
      for (let q = 0; q < 3; q++) p[q] += corners[a][q] + t * (corners[b][q] - corners[a][q]);
      m++;
    }
    const local = p.map((x, q) => grid.lo[q] + ([i, j, k][q] + x / m) * grid.step);
    vid[at(i, j, k)] = pos.length / 3;
    pos.push(...toRas(grid.ax, local));
    vertexNode.push(nearestVoxel(grid, local));
  }
  const idx = [];
  // One quad per lattice edge that crosses the surface, joining the four cells around it.
  for (let k = 1; k < Z - 1; k++) for (let j = 1; j < Y - 1; j++) for (let i = 1; i < X - 1; i++) {
    const inside = f[at(i, j, k)] > ISO;
    for (const [dir, c] of [[0, [[0, -1, -1], [0, 0, -1], [0, 0, 0], [0, -1, 0]]], [1, [[-1, 0, -1], [0, 0, -1], [0, 0, 0], [-1, 0, 0]]], [2, [[-1, -1, 0], [0, -1, 0], [0, 0, 0], [-1, 0, 0]]]]) {
      const n = [i + (dir === 0), j + (dir === 1), k + (dir === 2)];
      if (n[0] >= X || n[1] >= Y || n[2] >= Z || (f[at(...n)] > ISO) === inside) continue;
      const q = c.map(([a, b, d]) => vid[at(i + a, j + b, k + d)]);
      if (q.some((x) => x < 0)) continue;
      // Winding so normals point out of the wall (towards the outside value). Flipped for dir 1 (odd permutation).
      const flip = (inside !== (dir === 1));
      if (flip) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]); else idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
    }
  }
  return { positions: Float32Array.from(pos), indices: Uint32Array.from(idx), vertexNode: Int32Array.from(vertexNode) };
}
