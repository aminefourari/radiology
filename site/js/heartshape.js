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
    pos: ras.flat(), chamber, area: new Array(n).fill(VOXEL ** 3), purkinje, lines, links,
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
