// Cardiac activation simulator for the "How the ECG is made" page. DOM-free, deterministic.
// Graph: heart mesh vertices (RAS mm) + a Purkinje layer + conduction lines, built from heart-graph.json.

// Conduction velocity in mm/ms by tissue code.
export const TISSUE = { atrium: 0, avnode: 1, his: 2, purkinje: 3, ventricle: 4, accessory: 5 };
export const VELOCITY = [1.0, 0.05, 2.5, 3.0, 0.5, 1.0];
export const CONDUCTION = 4; // chamber id of Purkinje and conduction-line nodes (0 RA, 1 LA, 2 RV, 3 LV)
const LINE_TISSUE = { his: TISSUE.his, lbb: TISSUE.purkinje, laf: TISSUE.purkinje, lpf: TISSUE.purkinje, rbb: TISSUE.purkinje };
const LINE_REGION = { lbb: 0, laf: 1, lpf: 2, rbb: 3 }; // Purkinje region each bundle feeds
const PMJ_MM = 2; // Purkinje–muscle junction: one-way, a short fixed delay

const groupOf = (c) => (c <= 1 ? 0 : 1); // atria / ventricles: no muscle edge crosses the AV ring

// Pairs (a, b) closer than r, via a uniform grid hash.
function neighbourPairs(pos, n, r, keep) {
  const key = (x, y, z) => `${x},${y},${z}`;
  const cell = new Map();
  const c = (i, k) => Math.floor(pos[i * 3 + k] / r);
  for (let i = 0; i < n; i++) {
    const k = key(c(i, 0), c(i, 1), c(i, 2));
    if (!cell.has(k)) cell.set(k, []);
    cell.get(k).push(i);
  }
  const out = [];
  for (let a = 0; a < n; a++) {
    const [x, y, z] = [c(a, 0), c(a, 1), c(a, 2)];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const b of cell.get(key(x + dx, y + dy, z + dz)) ?? []) {
        if (b <= a || !keep(a, b)) continue;
        const d = dist(pos, a, b);
        if (d < r) out.push([a, b, d]);
      }
    }
  }
  return out;
}

const dist = (pos, a, b) => Math.hypot(pos[a * 3] - pos[b * 3], pos[a * 3 + 1] - pos[b * 3 + 1], pos[a * 3 + 2] - pos[b * 3 + 2]);

// Builds the simulation graph. radius: muscle neighbourhood (mm); purkinjeRadius: Purkinje-layer links.
export function loadGraph(json, { radius = 5, purkinjeRadius = 6, lineStep = 2 } = {}) {
  const nMesh = json.chamber.length;
  const pos = [...json.pos], chamber = [...json.chamber], area = [...json.area];
  const edges = []; // [a, b, len, tissue, oneway]

  for (const [a, b, d] of neighbourPairs(json.pos, nMesh, radius, (a, b) => groupOf(chamber[a]) === groupOf(chamber[b]))) {
    edges.push([a, b, d, groupOf(chamber[a]) ? TISSUE.ventricle : TISSUE.atrium, false]);
  }

  // Purkinje layer: one node per Purkinje-region vertex, linked within its region, one-way into the muscle.
  const purkNode = new Map(), purkRegion = [];
  json.purkinje.forEach((region, v) => {
    if (region < 0) return;
    const id = pos.length / 3;
    pos.push(json.pos[v * 3], json.pos[v * 3 + 1], json.pos[v * 3 + 2]);
    chamber.push(CONDUCTION);
    area.push(0);
    purkNode.set(v, id);
    purkRegion.push([id, region]);
    edges.push([id, v, PMJ_MM, TISSUE.purkinje, true]);
  });
  const regionOf = new Map(purkRegion);
  const purkIds = purkRegion.map(([id]) => id);
  if (purkIds.length) {
    const sub = purkIds.flatMap((id) => [pos[id * 3], pos[id * 3 + 1], pos[id * 3 + 2]]);
    for (const [a, b, d] of neighbourPairs(sub, purkIds.length, purkinjeRadius, (a, b) => regionOf.get(purkIds[a]) === regionOf.get(purkIds[b]))) {
      edges.push([purkIds[a], purkIds[b], d, TISSUE.purkinje, false]);
    }
  }

  // Conduction lines: polylines through mesh vertices, resampled every lineStep mm. Insulated from the
  // muscle; each bundle's distal part feeds its Purkinje region.
  const lineNodes = {};
  const nodeAt = new Map(); // shared polyline endpoints (by mesh vertex) become one node
  for (const [name, verts] of Object.entries(json.lines ?? {})) {
    const ids = [];
    const tissue = LINE_TISSUE[name] ?? TISSUE.purkinje;
    for (let s = 0; s < verts.length - 1; s++) {
      const [a, b] = [verts[s], verts[s + 1]];
      const len = dist(json.pos, a, b);
      const steps = Math.max(1, Math.round(len / lineStep));
      for (let k = s === 0 ? 0 : 1; k <= steps; k++) {
        const endpoint = k === 0 ? a : k === steps ? b : null;
        if (endpoint != null && nodeAt.has(endpoint)) { ids.push(nodeAt.get(endpoint)); continue; }
        const id = pos.length / 3;
        for (let q = 0; q < 3; q++) pos.push(json.pos[a * 3 + q] + (json.pos[b * 3 + q] - json.pos[a * 3 + q]) * k / steps);
        chamber.push(CONDUCTION);
        area.push(0);
        if (endpoint != null) nodeAt.set(endpoint, id);
        ids.push(id);
      }
    }
    for (let k = 1; k < ids.length; k++) edges.push([ids[k - 1], ids[k], dist(pos, ids[k - 1], ids[k]), tissue, false]);
    lineNodes[name] = ids;
    const region = LINE_REGION[name];
    if (region == null) continue;
    const distal = ids.slice(name === "rbb" ? Math.floor(ids.length * 0.7) : Math.floor(ids.length * 0.3));
    const targets = purkIds.filter((id) => regionOf.get(id) === region);
    for (const l of distal) {
      let linked = false;
      for (const p of targets) {
        const d = dist(pos, l, p);
        if (d < purkinjeRadius + 2) { edges.push([l, p, d, TISSUE.purkinje, true]); linked = true; }
      }
      if (!linked && l === ids.at(-1) && targets.length) {
        const p = targets.reduce((best, q) => (dist(pos, l, q) < dist(pos, l, best) ? q : best));
        edges.push([l, p, dist(pos, l, p), TISSUE.purkinje, true]);
      }
    }
  }

  // CSR adjacency (directed; two-way edges appear twice).
  const n = pos.length / 3;
  const deg = new Int32Array(n + 1);
  for (const [a, b, , , oneway] of edges) { deg[a + 1]++; if (!oneway) deg[b + 1]++; }
  for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
  const start = deg, fill = start.slice(0, n);
  const m = start[n];
  const nbr = new Int32Array(m), len = new Float32Array(m), tissue = new Uint8Array(m);
  const put = (a, b, d, t) => { const k = fill[a]++; nbr[k] = b; len[k] = d; tissue[k] = t; };
  for (const [a, b, d, t, oneway] of edges) { put(a, b, d, t); if (!oneway) put(b, a, d, t); }

  return {
    n, nMesh, pos: Float32Array.from(pos), area: Float32Array.from(area), chamber: Uint8Array.from(chamber),
    start, nbr, len, tissue, lineNodes, purkinje: purkNode,
    landmarks: json.landmarks, electrodes: json.electrodes, centre: json.centre,
  };
}

// Binary min-heap of [time, vertex].
class Heap {
  constructor() { this.t = []; this.v = []; }
  get size() { return this.t.length; }
  push(t, v) {
    const { t: T, v: V } = this;
    let i = T.length;
    T.push(t); V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (T[p] <= T[i]) break;
      [T[p], T[i]] = [T[i], T[p]]; [V[p], V[i]] = [V[i], V[p]];
      i = p;
    }
  }
  pop() {
    const { t: T, v: V } = this;
    const out = [T[0], V[0]];
    const lt = T.pop(), lv = V.pop();
    if (T.length) {
      T[0] = lt; V[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < T.length && T[l] < T[s]) s = l;
        if (r < T.length && T[r] < T[s]) s = r;
        if (s === i) break;
        [T[s], T[i]] = [T[i], T[s]]; [V[s], V[i]] = [V[i], V[s]];
        i = s;
      }
    }
    return out;
  }
}

// Earliest activation time per vertex from timed sources (Dijkstra). cut: vertices that don't conduct;
// allow: optional Uint8Array indexed by chamber id, 1 = the impulse may enter; refractoryUntil: optional
// Float32Array, a vertex can't activate before it.
export function activate(g, sources, { cut = new Set(), velocity = VELOCITY, allow = null, refractoryUntil = null, maxTime = Infinity } = {}) {
  const act = new Float64Array(g.n).fill(Infinity); // Float64: rounding would let zero-length edges re-relax forever
  const ok = (v, t) => !cut.has(v) && (!allow || allow[g.chamber[v]]) && (!refractoryUntil || t >= refractoryUntil[v]);
  const heap = new Heap();
  for (const { v, t } of sources) if (ok(v, t) && t < act[v]) { act[v] = t; heap.push(t, v); }
  while (heap.size) {
    const [t, u] = heap.pop();
    if (t > act[u] || t > maxTime) continue;
    for (let k = g.start[u]; k < g.start[u + 1]; k++) {
      const v = g.nbr[k];
      const tv = t + g.len[k] / velocity[g.tissue[k]];
      if (tv < act[v] && ok(v, tv)) { act[v] = tv; heap.push(tv, v); }
    }
  }
  return act;
}

// Repolarisation time: act + APD, with APD shorter where activation came later (slope > 1 makes
// repolarisation run roughly in reverse, which gives the normal heart its upright, concordant T wave).
export function repolarise(g, act, { apd = 260, slope = 1.2 } = {}) {
  let min = Infinity;
  for (const t of act) if (t < min) min = t;
  return act.map((t) => (Number.isFinite(t) ? t + apd - slope * (t - min) : Infinity));
}
