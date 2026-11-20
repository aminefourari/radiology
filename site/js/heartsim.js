// Cardiac activation simulator for the "How the ECG is made" page. DOM-free, deterministic.
// Graph: wall voxels of the idealised heart (RAS mm, from heartshape.js) + a Purkinje layer + conduction lines.

// Conduction velocity in mm/ms by tissue code.
export const TISSUE = { atrium: 0, avnode: 1, his: 2, purkinje: 3, ventricle: 4, accessory: 5, bachmann: 6 };
export const VELOCITY = [1.0, 0.05, 2.5, 1.5, 0.55, 1.0, 1.8];
export const CONDUCTION = 4; // chamber id of Purkinje and conduction-line nodes (0 RA, 1 LA, 2 RV, 3 LV)
const LINE_TISSUE = { his: TISSUE.his, lbb: TISSUE.purkinje, laf: TISSUE.purkinje, lpf: TISSUE.purkinje, rbb: TISSUE.purkinje };
const LINE_REGION = { lbb: 0, laf: 1, lpf: 2, rbb: 3 }; // Purkinje region each bundle feeds
const PMJ_MM = 2; // Purkinje–muscle junction: one-way, a short fixed delay
const RETRO_PMJ_MS = 10; // muscle → Purkinje (retrograde) at the junction: slower, used only for ventricular-origin beats

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
  // Explicit links across walls thicker than the radius (LV free wall, septum).
  for (const [a, b, t = TISSUE.ventricle] of json.links ?? []) edges.push([a, b, dist(json.pos, a, b), t, false]);

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

  // Retrograde junction edges (muscle → its Purkinje copy), kept apart: only beats that start in the ventricular
  // muscle (PVC, VT, escape) use them; conducted beats, incl. bundle branch block, don't.
  const retro = new Map();
  for (const [v, id] of purkNode) retro.set(v, id);

  return {
    n, nMesh, pos: Float32Array.from(pos), retro, area: Float32Array.from(area), chamber: Uint8Array.from(chamber),
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
export function activate(g, sources, { cut = new Set(), velocity = VELOCITY, allow = null, refractoryUntil = null, maxTime = Infinity, retrograde = false, slow = null, retroMs = RETRO_PMJ_MS } = {}) {
  const act = new Float64Array(g.n).fill(Infinity); // Float64: rounding would let zero-length edges re-relax forever
  const ok = (v, t) => !cut.has(v) && (!allow || allow[g.chamber[v]]) && (!refractoryUntil || t >= refractoryUntil[v]);
  const heap = new Heap();
  for (const { v, t } of sources) if (ok(v, t) && t < act[v]) { act[v] = t; heap.push(t, v); }
  while (heap.size) {
    const [t, u] = heap.pop();
    if (t > act[u] || t > maxTime) continue;
    for (let k = g.start[u]; k < g.start[u + 1]; k++) {
      const v = g.nbr[k];
      const tv = t + (g.len[k] / velocity[g.tissue[k]]) * (slow?.get(v) ?? 1);
      if (tv < act[v] && ok(v, tv)) { act[v] = tv; heap.push(tv, v); }
    }
    const p = retrograde ? g.retro.get(u) : undefined;
    if (p !== undefined) {
      const tp = t + retroMs;
      if (tp < act[p] && ok(p, tp)) { act[p] = tp; heap.push(tp, p); }
    }
  }
  return act;
}

// Repolarisation time = act + APD. APD is a property of the tissue: shorter where the *normal* (reference)
// sequence arrives later, so in sinus rhythm recovery runs roughly in reverse (slope > 1) and the T wave is
// upright and concordant. In an abnormal sequence (bundle branch block, PVC, VT) the late tissue still
// recovers late, which gives the discordant T. Without a reference, act is its own reference.
export function repolarise(g, act, { apd = 310, slope = 1.2, reference = act } = {}) {
  let min = Infinity;
  for (const t of reference) if (t < min) min = t;
  return act.map((t, v) => (Number.isFinite(t) ? t + apd - slope * ((Number.isFinite(reference[v]) ? reference[v] : min) - min) : Infinity));
}

export const LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
const FRONTAL = { I: 0, II: 60, III: 120, aVR: -150, aVL: -30, aVF: 90 };

// Unit lead axes in RAS (patient left is -x, inferior -z). Frontal leads are the hexaxial angles;
// precordial leads point from the heart centre to their electrode.
export function leadAxes(g) {
  const out = {};
  for (const l of LEADS) {
    if (l in FRONTAL) {
      const a = (FRONTAL[l] * Math.PI) / 180;
      out[l] = [-Math.cos(a), 0, -Math.sin(a)];
    } else {
      const d = g.electrodes[l].map((x, i) => x - g.centre[i]);
      const n = Math.hypot(...d);
      out[l] = d.map((x) => x / n);
    }
  }
  return out;
}

// Direction the front travelled through each mesh vertex: the least-squares gradient of the arrival times over its mesh
// neighbours. scaled = false: unit vectors. scaled = true: gradient × the muscle's own velocity, capped at 1 — a vertex the
// front crosses at muscle speed counts fully, one swept almost at once by the Purkinje network counts little (the front's
// dipole sweeps a volume in time ∝ 1/velocity, so its time integral is ∝ the gradient). Zero where nothing is defined.
function frontDirections(g, times, scaled = false) {
  const d = new Float32Array(g.nMesh * 3);
  for (let v = 0; v < g.nMesh; v++) {
    const tv = times[v];
    if (!Number.isFinite(tv)) continue;
    let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0, bx = 0, by = 0, bz = 0;
    for (let k = g.start[v]; k < g.start[v + 1]; k++) {
      const u = g.nbr[k];
      if (u >= g.nMesh || !Number.isFinite(times[u])) continue;
      const dx = g.pos[u * 3] - g.pos[v * 3], dy = g.pos[u * 3 + 1] - g.pos[v * 3 + 1], dz = g.pos[u * 3 + 2] - g.pos[v * 3 + 2], dt = times[u] - tv;
      xx += dx * dx; xy += dx * dy; xz += dx * dz; yy += dy * dy; yz += dy * dz; zz += dz * dz;
      bx += dx * dt; by += dy * dt; bz += dz * dt;
    }
    // Solve the 3×3 normal equations (Cramer); fall back to the plain weighted sum when they're singular (sheet-like).
    const det = xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz);
    let x, y, z;
    if (Math.abs(det) > 1e-6 * (xx + yy + zz) ** 3) {
      x = (bx * (yy * zz - yz * yz) - xy * (by * zz - yz * bz) + xz * (by * yz - yy * bz)) / det;
      y = (xx * (by * zz - yz * bz) - bx * (xy * zz - yz * xz) + xz * (xy * bz - by * xz)) / det;
      z = (xx * (yy * bz - by * yz) - xy * (xy * bz - by * xz) + bx * (xy * yz - yy * xz)) / det;
    } else { x = bx / (xx + yy + zz || 1); y = by / (xx + yy + zz || 1); z = bz / (xx + yy + zz || 1); }
    const n = Math.hypot(x, y, z);
    if (!n) continue;
    const s = scaled ? Math.min(1, n * VELOCITY[g.chamber[v] >= 2 ? TISSUE.ventricle : TISSUE.atrium]) / n : 1 / n;
    d[v * 3] = x * s; d[v * 3 + 1] = y * s; d[v * 3 + 2] = z * s;
  }
  return d;
}

// Relative muscle mass per unit mesh area, by chamber id (RA, LA, RV, LV). The RV wall is about a third as thick
// as the LV's, and its mesh is a two-surface shell (so its area counts the wall twice): 0.15.
export const CHAMBER_WEIGHT = [1, 1, 0.15, 1];

// Heart vector per ms over [0, duration). Depolarisation: each mesh vertex adds weight·area·(front direction)
// spread evenly over `front` ms after it activates. Recovery: it subtracts repolWeight·area·(recovery
// direction) spread over a smooth (Hann) window `repolFront` ms wide centred on its repolarisation time —
// phase 3 of the action potential takes ~100 ms, which is why the T wave is broad and rounded.
// Wavefronts: {act, repol, weight, repolWeight = weight}.
export function heartVectors(g, wavefronts, duration, { front = 12, repolFront = 160, repolGain = 1, chamberWeight = CHAMBER_WEIGHT, scaled = true } = {}) {
  const diff = new Float64Array((duration + 1) * 3), imp = new Float64Array(duration * 3);
  for (const { act, repol, weight, repolWeight = weight } of wavefronts) {
    const da = frontDirections(g, act, scaled), dr = frontDirections(g, repol);
    for (let v = 0; v < g.nMesh; v++) {
      const m = g.area[v] * chamberWeight[g.chamber[v]];
      const t0 = Math.floor(act[v]);
      if (t0 < duration && t0 + front > 0) {
        for (let q = 0; q < 3; q++) {
          const val = (weight * m * da[v * 3 + q]) / front;
          diff[Math.max(t0, 0) * 3 + q] += val;
          diff[Math.min(t0 + front, duration) * 3 + q] -= val;
        }
      }
      const tr = Math.floor(repol[v]);
      if (tr >= 0 && tr < duration) for (let q = 0; q < 3; q++) imp[tr * 3 + q] -= repolWeight * repolGain * m * dr[v * 3 + q];
    }
  }
  const half = Math.max(1, Math.round(repolFront / 2));
  const kern = Array.from({ length: 2 * half + 1 }, (_, k) => 1 - Math.cos((2 * Math.PI * (k + 0.5)) / (2 * half + 1)));
  const ksum = kern.reduce((a, x) => a + x, 0);
  const out = new Float32Array(duration * 3);
  const run = [0, 0, 0];
  for (let t = 0; t < duration; t++) for (let q = 0; q < 3; q++) out[t * 3 + q] = run[q] += diff[t * 3 + q];
  for (let t = 0; t < duration; t++) {
    for (let q = 0; q < 3; q++) {
      const x = imp[t * 3 + q];
      if (!x) continue;
      for (let k = 0; k < kern.length; k++) {
        const u = t + k - half;
        if (u >= 0 && u < duration) out[u * 3 + q] += (x * kern[k]) / ksum;
      }
    }
  }
  return out;
}

const smooth = (s) => s.map((x, i) => (s[Math.max(i - 1, 0)] + x + s[Math.min(i + 1, s.length - 1)]) / 3);

// 12 leads at fs Hz from the heart vector: lead(t) = H(t) · axis · gain, lightly low-passed.
export function leadSignals(g, wavefronts, duration, { fs = 500, gain = 1, vectors = null, ...opts } = {}) {
  const h = vectors ?? heartVectors(g, wavefronts, duration, opts);
  const step = 1000 / fs, n = Math.floor(duration / step), axes = leadAxes(g), out = {};
  for (const l of LEADS) {
    const [ax, ay, az] = axes[l];
    let s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let t = Math.round(i * step); t < Math.round((i + 1) * step); t++) acc += h[t * 3] * ax + h[t * 3 + 1] * ay + h[t * 3 + 2] * az;
      s[i] = (acc / step) * gain;
    }
    out[l] = smooth(smooth(s));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Rhythm engine. A model (site/heart/rhythms.json) schedules impulses; each impulse spreads over the graph
// as one wavefront; the wavefronts give the leads, the heart colours and the events (caption, ladder).

const ATRIA = Uint8Array.from([1, 1, 0, 0, 0]);
const VENTRICLES = Uint8Array.from([0, 0, 1, 1, 1]);
const ATRIAL_WEIGHT = 0.15, ATRIAL_REPOL_WEIGHT = 0.02; // thin atrial walls: small P, smaller Ta
const ATRIAL_APD = { apd: 200, slope: 0.3 };
const ATRIAL_REFRACTORY = 150, VENTRICULAR_GUARD = 30; // ms the atria / a just-recovered vertex stay inexcitable
const HIS_REFRACTORY = 380; // after a ventricular beat the His–Purkinje system won't conduct (concealed PVC → pause)
const AV_REFRACTORY = 300; // the node conducts 1:1 up to ~200/min
const RETRO_PATHWAY_MS = 35; // ventricular end → atrial end of the accessory pathway, retrograde (AVRT)

const meshSpan = (g, act, allow) => {
  let lo = Infinity, hi = -Infinity;
  for (let v = 0; v < g.nMesh; v++) if (allow[g.chamber[v]] && Number.isFinite(act[v])) { lo = Math.min(lo, act[v]); hi = Math.max(hi, act[v]); }
  return [lo, hi];
};

// Normal-sinus ventricular activation (His at t = 0): the reference that fixes each vertex's APD.
function reference(g) {
  return (g._reference ??= activate(g, [{ v: g.lineNodes.his[0], t: 0 }], { allow: VENTRICLES }));
}

// Sources along a closed circuit (ordered vertex ids) for one lap starting at t0. slow: vertex ids where the
// circuit conducts `slowFactor` times slower (the cavotricuspid isthmus).
function lapSources(g, circuit, t0, cycle, slow = new Set(), slowFactor = 3) {
  const seg = circuit.map((v, i) => {
    const u = circuit[(i + 1) % circuit.length];
    return dist(g.pos, v, u) * (slow.has(v) || slow.has(u) ? slowFactor : 1);
  });
  const total = seg.reduce((a, x) => a + x, 0);
  let acc = 0;
  return circuit.map((v, i) => { const s = { v, t: t0 + (acc / total) * cycle }; acc += seg[i]; return s; });
}

const pat = (p, k) => (p ? p[k % p.length] === 1 : true);
const lineSet = (g, names) => new Set(names.flatMap((c) => (c === "lbb" ? ["lbb", "laf", "lpf"] : [c])).flatMap((c) => g.lineNodes[c].slice(1)));

// One beat's sinus-node schedule: fixed cycle, a repeating list of cycles, or a respiratory modulation; an arrest window
// silences the node; premature atrial beats reset it (the next sinus beat comes one cycle after them).
function sinusTimes(model, D, resets) {
  const sn = model.sinus, out = [];
  if (!sn) return out;
  let t = sn.start ?? 20, k = 0;
  while (t < D) {
    if (sn.arrest && t >= sn.arrest[0] && t < sn.arrest[1]) t = sn.arrest[1]; // an arrested node restarts afresh, off its old rhythm
    if (t >= D) break;
    out.push({ t, k });
    let c = sn.cycles ? sn.cycles[Math.min(k, sn.cycles.length - 1)] : sn.cycle;
    if (sn.modulate) c *= 1 + sn.modulate.depth * Math.sin((2 * Math.PI * t) / sn.modulate.period);
    let next = t + c;
    const r = resets.find((x) => x > t + 1 && x < next);
    if (r != null) next = r + c;
    t = next; k++;
  }
  return out;
}

export function simulate(g, model) {
  const D = model.duration;
  const lm = g.landmarks;
  const rand = seeded(model.af?.seed ?? model.vf?.seed ?? 1);
  const atrial = [], ventricular = [], events = [];
  const fire = (t, origin) => events.push({ type: "fire", t0: t, t1: t, origin });
  const cut = lineSet(g, model.cut ?? []);
  const vtExit = model.reentry?.circuit === "vt" ? lm[model.reentry.exit ?? "vt_exit"] : null;
  if (model.reentry?.circuit === "vt" && !model.reentry.exit) {
    // The scar blocks conduction; the exit (where the circuit leaves the scar) and its neighbours stay excitable.
    const exit = new Set([vtExit]);
    for (let k = g.start[vtExit]; k < g.start[vtExit + 1]; k++) exit.add(g.nbr[k]);
    for (const v of lm.vt_scar) {
      if (!exit.has(v)) cut.add(v);
      if (g.retro.has(v)) cut.add(g.retro.get(v)); // the scar's Purkinje fibres are dead too
    }
  }
  const slow = model.slow ? new Map(Object.entries(model.slow).flatMap(([name, f]) => g.lineNodes[name].slice(1).map((v) => [v, f]))) : null;
  const ref = reference(g);
  const atrialRefractory = new Float64Array(g.n).fill(-Infinity);
  const pace = model.pacing;

  // 1. Atrial impulses, in time order.
  const atrialSources = []; // {sources, kind, ...flags}
  const prem = (model.atrial ?? []).map((a) => ({ ...a }));
  const sites = model.sinus?.sites;
  for (const { t, k } of sinusTimes(model, D, prem.map((a) => a.t))) {
    fire(t, "sinus");
    if (!pat(model.sinus.exitBlock, k)) { events.push({ type: "sablock", t0: t, t1: t + 40 }); continue; }
    const site = sites ? sites[k % sites.length] : "sa";
    atrialSources.push({ sources: [{ v: lm[site], t }], kind: site === "sa" ? "sinus" : "atrial" });
  }
  for (const a of prem) { fire(a.t, "atrial"); atrialSources.push({ sources: [{ v: lm[a.site], t: a.t }], kind: "atrial", blocked: a.blocked, aberrant: a.aberrant }); }
  if (model.focus) {
    const f = model.focus;
    for (let t = f.start ?? 20, k = 0; t < D; t += f.cycles ? f.cycles[k % f.cycles.length] : f.cycle, k++) {
      fire(t, "atrial");
      atrialSources.push({ sources: [{ v: lm[f.sites ? f.sites[k % f.sites.length] : f.site], t }], kind: "atrial" });
    }
  }
  if (pace && ["aai", "ddd", "biv"].includes(pace.mode)) {
    for (let t = 20; t < D; t += 60000 / pace.rate) { fire(t, "pacing"); events.push({ type: "spike", t0: t, t1: t, chamber: "A" }); atrialSources.push({ sources: [{ v: lm.hra, t }], kind: "paced" }); }
  }
  if (model.reentry?.circuit === "flutter") {
    const ring = model.reentry.reverse ? [...lm.tricuspid_ring].reverse() : lm.tricuspid_ring;
    for (let t = 0; t < D; t += model.reentry.cycle) { fire(t, "atrial"); atrialSources.push({ sources: lapSources(g, ring, t, model.reentry.cycle, new Set(lm.cti)), kind: "flutter" }); }
  }
  if (model.af) {
    const atrialVerts = [];
    for (let v = 0; v < g.nMesh; v++) if (g.chamber[v] <= 1) atrialVerts.push(v);
    for (let t = 0; t < D; t += 40 + rand() * 60) atrialSources.push({ sources: [{ v: atrialVerts[Math.floor(rand() * atrialVerts.length)], t }], kind: "af", reach: 70 });
  }
  const retro = []; // retrograde atrial sources produced by junctional and re-entrant beats, added below
  const runAtrial = (src) => {
    const t0 = Math.min(...src.sources.map((s) => s.t));
    // Retrograde P waves are run after the anterograde ones, so their refractoriness comes from the beats before them.
    let refr = atrialRefractory;
    if (src.kind === "retro") {
      refr = new Float64Array(g.n).fill(-Infinity);
      for (const a of atrial) if (a.t0 < t0) for (let v = 0; v < g.n; v++) if (a.act[v] < t0) refr[v] = Math.max(refr[v], a.act[v] + ATRIAL_REFRACTORY);
    }
    const act = activate(g, src.sources, { allow: ATRIA, refractoryUntil: refr, maxTime: src.reach ? t0 + src.reach : Infinity });
    if (src.reach) for (let v = 0; v < g.n; v++) if (act[v] > t0 + src.reach) act[v] = Infinity;
    const [lo, hi] = meshSpan(g, act, ATRIA);
    if (!Number.isFinite(lo)) return null;
    if (src.kind !== "retro") for (let v = 0; v < g.n; v++) if (Number.isFinite(act[v])) atrialRefractory[v] = act[v] + ATRIAL_REFRACTORY;
    const w = { act, repol: repolarise(g, act, ATRIAL_APD), weight: ATRIAL_WEIGHT, repolWeight: ATRIAL_REPOL_WEIGHT, kind: "atrial", beat: atrial.length, t0: lo, t1: hi };
    atrial.push(w);
    events.push({ type: "P", t0: lo, t1: hi, beat: w.beat, origin: src.kind });
    if (src.kind === "flutter") events.push({ type: "reentry", t0, t1: t0 + model.reentry.cycle, beat: w.beat, circuit: "flutter" });
    return w;
  };

  // 2. AV conduction (node, and an accessory pathway if present).
  const ventricularStarts = []; // {sources, t, kind, p?, cut?}
  let lastConducted = -Infinity, lastAp = -Infinity, arrivalCount = 0;
  const pattern = model.block?.pattern;
  const ap = model.accessory ? (model.accessory === "ps" ? lm.accessory_ps : lm.accessory) : null;
  const lastVentricular = () => (ventricularStarts.length ? Math.max(...ventricularStarts.map((s) => s.t)) : -Infinity);
  for (const src of atrialSources.sort((a, b) => a.sources[0].t - b.sources[0].t)) {
    const w = runAtrial(src);
    if (!w) continue;
    const ta = w.act[lm.avnode];
    if (!Number.isFinite(ta)) continue;
    const k = arrivalCount++;
    let conducts = true, delay = model.avDelay ?? 90, level = model.block?.level ?? "node";
    if (pattern) conducts = pattern[k % pattern.length] === 1;
    if (model.wenckebach) {
      const j = k % model.wenckebach.every;
      conducts = j < model.wenckebach.every - 1;
      delay += model.wenckebach.inc * j * (1 - j * 0.15);
    }
    if (model.reentry?.circuit === "flutter") conducts = model.reentry.conducts ? pat(model.reentry.conducts, k) : k % model.reentry.conduct === 0;
    if (model.focus?.conduct) conducts = k % model.focus.conduct === 0;
    if (model.af) {
      conducts = ta >= lastConducted + model.af.avRefractory + rand() * 250;
      delay += rand() * 40;
    }
    if (src.blocked) { conducts = false; level = "node"; }
    if (pace?.mode === "ddd" || pace?.mode === "vvi" || pace?.mode === "biv") conducts = false; // paced ventricles (AV node ablated)
    // Over the accessory pathway: conducts whenever the pathway has recovered (pre-excited AF), or every beat.
    let apStart = null;
    if (ap && pat(model.accessoryBeats, k)) {
      const tap = w.act[ap[0]];
      if (Number.isFinite(tap) && tap >= lastAp + (model.accessoryRefractory ?? 0) && tap + 10 >= lastVentricular() + (model.accessoryRefractory ? model.accessoryRefractory : 0)) apStart = tap + 10;
    }
    if (ta + delay < lastVentricular() + AV_REFRACTORY) { if (conducts && !apStart) level = "his"; conducts = false; }
    if (conducts || apStart != null) {
      if (conducts) { lastConducted = ta; events.push({ type: "AV", t0: ta, t1: ta + delay, beat: w.beat }); }
      const sources = conducts ? [{ v: g.lineNodes.his[0], t: ta + delay }] : [];
      if (apStart != null) { sources.push({ v: ap[1], t: apStart }); lastAp = apStart - 10; }
      ventricularStarts.push({ sources, t: Math.min(...sources.map((s) => s.t)), kind: apStart != null ? "pre" : "conducted", p: w, cut: src.aberrant, his: conducts ? ta + delay : null });
    } else {
      events.push({ type: "blocked", t0: ta, t1: ta + (level === "his" ? delay : 40), beat: w.beat, level });
    }
  }

  // 3. Ventricular impulses not driven by the atria.
  const junction = g.lineNodes.his[0];
  const retroDelay = model.retroDelay ?? 30;
  const site = (name) => (name === "junction" ? junction : name === "ventricle" ? lm.apex : lm[name]);
  const escapeAt = (e, t) => {
    fire(t, e.site === "junction" ? "junction" : "ventricle");
    if (e.site === "junction" && e.retro !== false) retro.push({ sources: [{ v: lm.avnode, t: t + retroDelay }], kind: "retro" });
    return { sources: [{ v: site(e.site), t }], t, kind: e.site === "junction" ? "junction" : "ventricle" };
  };
  // An escape pacemaker on its own clock (AV dissociation). One that waits for a pause is scheduled below, once every
  // other beat is known.
  if (model.escape && !model.escape.onlyIfPause) for (let t = model.escape.start ?? 300; t < D; t += model.escape.cycle) ventricularStarts.push(escapeAt(model.escape, t));
  for (const j of model.junctional ?? []) {
    fire(j.t, "junction");
    ventricularStarts.push({ sources: [{ v: junction, t: j.t }], t: j.t, kind: "junction" });
    retro.push({ sources: [{ v: lm.avnode, t: j.t + retroDelay }], kind: "retro" });
  }
  for (const e of model.ectopic ?? []) { fire(e.t, "ventricle"); ventricularStarts.push({ sources: [{ v: lm[e.site], t: e.t }], t: e.t, kind: "ectopic" }); }
  if (model.run) {
    const r = model.run;
    for (let i = 0; i < r.n; i++) { const t = r.t + i * r.cycle; fire(t, "ventricle"); ventricularStarts.push({ sources: [{ v: lm[r.site], t }], t, kind: "vt" }); }
  }
  for (const f of model.fusion ?? []) {
    // A ventricular focus firing just as the conducted impulse arrives: both fronts make one QRS.
    const s = ventricularStarts.filter((x) => x.kind === "conducted").reduce((b, x) => (!b || Math.abs(x.t - f.t) < Math.abs(b.t - f.t) ? x : b), null);
    if (s) { s.sources.push({ v: lm[f.site], t: f.t }); s.kind = "fusion"; s.t = Math.min(s.t, f.t); fire(f.t, "ventricle"); }
  }
  if (model.reentry?.circuit === "vt") {
    for (let t = model.reentry.start ?? 100; t < D; t += model.reentry.cycle) { fire(t, "ventricle"); ventricularStarts.push({ sources: [{ v: vtExit, t }], t, kind: "vt", scar: !model.reentry.exit }); }
  }
  if (model.polymorphic) {
    const p = model.polymorphic;
    for (let t = p.start, i = 0; t < (p.end ?? D); t += p.cycle, i++) {
      fire(t, "ventricle");
      ventricularStarts.push({ sources: [{ v: lm[p.sites[i % p.sites.length]], t }], t, kind: "vt" });
    }
  }
  if (model.reentry?.circuit === "avnrt" || model.reentry?.circuit === "avrt") {
    for (let t = 100; t < D; t += model.reentry.cycle) {
      fire(t, "junction");
      ventricularStarts.push({ sources: [{ v: junction, t }], t, kind: model.reentry.circuit });
      if (model.reentry.circuit === "avnrt") retro.push({ sources: [{ v: lm.avnode, t: t + (model.reentry.retro ?? 5) }], kind: "retro" });
    }
  }
  if (model.reentry?.circuit === "antidromic") {
    // Down the accessory pathway, up the AV node: fully pre-excited QRS, retrograde P late.
    const p = model.accessory === "ps" ? lm.accessory_ps : lm.accessory;
    for (let t = 100; t < D; t += model.reentry.cycle) {
      fire(t, "atrial");
      ventricularStarts.push({ sources: [{ v: p[1], t }], t, kind: "antidromic" });
      retro.push({ sources: [{ v: lm.avnode, t: t + model.reentry.retro }], kind: "retro" });
    }
  }
  if (pace && pace.mode !== "aai") {
    const fail = pace.fail;
    const atrialPaced = pace.mode === "ddd" || pace.mode === "biv";
    for (let t = atrialPaced ? 20 + pace.av : 100, k = 0; t < D; t += 60000 / pace.rate, k++) {
      fire(t, "pacing");
      events.push({ type: "spike", t0: t, t1: t, chamber: "V" });
      if (!pat(fail, k)) continue;
      const sources = [{ v: lm.rv_apex, t }];
      if (pace.mode === "biv") sources.push({ v: lm.lv_lateral, t });
      ventricularStarts.push({ sources, t, kind: "paced", scar: true }); // captured muscle reaches the Purkinje network late
    }
  }
  if (model.vf) {
    // Ventricular fibrillation: short-lived wavelets at random sites, each blocked where the muscle is still refractory.
    const vv = [];
    for (let v = 0; v < g.nMesh; v++) if (g.chamber[v] >= 2) vv.push(v);
    for (let t = model.vf.start ?? 0; t < D; t += 8 + rand() * 14) ventricularStarts.push({ sources: [{ v: vv[Math.floor(rand() * vv.length)], t }], t, kind: "vf", reach: 90 });
  }

  // Ectopic and escape beats conceal the next sinus impulse: drop conducted beats that land in refractoriness.
  ventricularStarts.sort((a, b) => a.t - b.t);
  const kept = [];
  for (const s of ventricularStarts) {
    const prev = kept.filter((x) => x.kind !== "vf").at(-1);
    const concealing = prev && !["conducted", "pre", "fusion"].includes(prev.kind); // an ectopic/escape beat went up into the His
    if (s.kind !== "vf" && concealing && s.t < prev.t + HIS_REFRACTORY && (s.kind === "conducted" || (s.kind === "pre" && s.his != null))) {
      const ev = events.find((e) => e.type === "AV" && e.beat === s.p.beat);
      if (ev) Object.assign(ev, { type: "blocked", level: "his" });
      continue;
    }
    kept.push(s);
  }

  // Pause-triggered escape: fires one escape cycle after the last beat that reached the ventricles, if nothing else has.
  // A demand (VVI) pacemaker senses it and restarts its own timer, so its next spike is inhibited.
  if (model.escape?.onlyIfPause) {
    const e = model.escape, ts = kept.filter((x) => x.kind !== "vf").map((x) => x.t);
    const add = [];
    for (let i = 0; i <= ts.length; i++) for (let t = (ts[i - 1] ?? 0) + e.cycle; t < Math.min(ts[i] ?? D, D) - 150; t += e.cycle) add.push(escapeAt(e, t));
    if (add.length && pace && pace.mode !== "aai") {
      const interval = 60000 / pace.rate;
      for (const x of add) {
        for (let i = events.length - 1; i >= 0; i--) {
          const ev = events[i];
          if (ev.type === "spike" && ev.chamber === "V" && ev.t0 > x.t && ev.t0 < x.t + interval) {
            events.splice(i, 1);
            const f = events.findIndex((y) => y.type === "fire" && y.origin === "pacing" && y.t0 === ev.t0);
            if (f >= 0) events.splice(f, 1);
            const k = kept.findIndex((y) => y.kind === "paced" && y.t === ev.t0);
            if (k >= 0) kept.splice(k, 1);
          }
        }
      }
    }
    kept.push(...add);
    kept.sort((a, b) => a.t - b.t);
  }

  // 4. Spread each ventricular impulse; tissue is refractory until it has recovered from the previous beat.
  const refractory = new Float64Array(g.n).fill(-Infinity);
  const apd = model.apd ? { apd: model.apd.apd, slope: model.apd.slope ?? 1.2 } : {};
  let prevT = -Infinity, beatNo = 0, lastRr = -Infinity;
  for (const s of kept) {
    let beatCut = cut;
    const extra = [...(s.cut ?? [])];
    for (const cb of model.cutBeats ?? []) {
      const hit = cb.beats === "odd" ? beatNo % 2 === 1 : cb.beats === "even" ? beatNo % 2 === 0 : cb.beats.includes(beatNo);
      if (hit && s.kind === "conducted") extra.push(...cb.cut);
    }
    if (model.rateCut && s.kind === "conducted" && s.t - prevT < model.rateCut.rrBelow) extra.push(...model.rateCut.cut);
    if (extra.length) beatCut = new Set([...cut, ...lineSet(g, extra)]);
    if (s.kind !== "vf") { prevT = s.t; beatNo++; }
    // Muscle → Purkinje entry for beats that start in the ventricular muscle. Scar VT leaves the scar through diseased
    // muscle, so it reaches the Purkinje network later (SCAR_RETRO_MS) and the QRS is wider than a PVC's.
    const retroEntry = ["ectopic", "ventricle", "vt", "paced", "antidromic", "pre", "fusion", "vf"].includes(s.kind);
    const t0 = s.t;
    const act = activate(g, s.sources, { allow: VENTRICLES, cut: beatCut, refractoryUntil: refractory, retrograde: retroEntry, retroMs: s.scar ? SCAR_RETRO_MS : RETRO_PMJ_MS, slow, maxTime: s.reach ? t0 + s.reach : Infinity });
    if (s.reach) for (let v = 0; v < g.n; v++) if (act[v] > t0 + s.reach) act[v] = Infinity;
    const [lo, hi] = meshSpan(g, act, VENTRICLES);
    if (!Number.isFinite(lo)) continue;
    // Restitution: action potentials shorten at fast rates (APD ∝ √RR, as in Bazett's QT correction), else a 330 ms
    // tachycardia would find the ventricles still refractory.
    const rr = Number.isFinite(lastRr) ? s.t - lastRr : Math.min(800, (kept.find((x) => x.t > s.t && x.kind !== "vf")?.t ?? Infinity) - s.t); // first beat: its own cycle
    lastRr = s.kind === "vf" ? lastRr : s.t;
    const scale = s.kind === "vf" ? 0.55 : Math.min(1.15, Math.max(0.6, Math.sqrt(rr / 800))); // fibrillating muscle runs at its shortest APD
    const repol = repolarise(g, act, { reference: ref, ...apd, apd: (apd.apd ?? 310) * scale });
    for (let v = 0; v < g.n; v++) if (Number.isFinite(act[v])) refractory[v] = repol[v] + VENTRICULAR_GUARD;
    const beat = ventricular.length;
    ventricular.push({ act, repol, weight: 1, kind: "ventricular", beat, t0: lo, t1: hi });
    if (s.kind === "vf") continue; // no QRS/T events: VF has no discrete complexes
    events.push({ type: "QRS", t0: lo, t1: hi, beat, origin: s.kind, cut: extra.length ? extra : undefined });
    if (s.kind === "pre" && s.his != null) events.push({ type: "pre", t0: lo, t1: Math.max(lo + 10, s.his + 15), beat });
    if ((s.kind === "conducted" || s.kind === "pre" || s.kind === "fusion") && s.p) events.push({ type: "PR", t0: s.p.t0, t1: lo, beat });
    const [r0, r1] = meshSpan(g, repol, VENTRICLES);
    events.push({ type: "ST", t0: hi, t1: Math.max(hi, r0 - 80), beat });
    events.push({ type: "T", t0: Math.max(hi, r0 - 80), t1: r1 + 60, beat });
    if (model.reentry?.circuit === "avrt") {
      const tv = act[lm.accessory[1]];
      if (Number.isFinite(tv)) retro.push({ sources: [{ v: lm.accessory[0], t: tv + RETRO_PATHWAY_MS }], kind: "retro" });
    }
    if (model.reentry && model.reentry.circuit !== "flutter") events.push({ type: "reentry", t0: s.t, t1: s.t + model.reentry.cycle, beat, circuit: model.reentry.circuit });
  }
  for (const src of retro.sort((a, b) => a.sources[0].t - b.sources[0].t)) runAtrial(src);

  const wavefronts = [...atrial, ...ventricular];
  // phase3: how long each cell takes to repolarise (ms); shorter (e.g. high potassium) narrows and peaks the T wave.
  const vectors = heartVectors(g, wavefronts, D, { repolFront: model.apd?.phase3 ?? 160 });
  const gl = model.electrodeShift ? { ...g, electrodes: Object.fromEntries(Object.entries(g.electrodes).map(([k, e]) => [k, e.map((x, i) => x + (model.electrodeShift[k]?.[i] ?? 0))])) } : g;
  const leads = leadSignals(gl, wavefronts, D, { vectors, gain: LEAD_GAIN });
  if (model.leads === "lareversal") {
    // Swapping the LA and RA electrodes, by Einthoven's lead algebra: I inverts, II↔III, aVR↔aVL, aVF unchanged.
    const { I, II, III, aVR, aVL } = leads;
    Object.assign(leads, { I: I.map((x) => -x), II: III, III: II, aVR: aVL, aVL: aVR });
  }
  // Pacing spikes: a device artefact, not heart activity — drawn as a 2 ms pulse in every lead.
  for (const e of events) if (e.type === "spike") for (const l of LEADS) { const i = Math.round((e.t0 * 500) / 1000); if (i < leads[l].length) leads[l][i] += SPIKE_MV; }
  events.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  return { duration: D, fs: 500, wavefronts, vectors, leads, events, af: !!model.af, vf: !!model.vf };
}

const SPIKE_MV = 1.2;
const SCAR_RETRO_MS = 40;

// mV per unit of heart vector: sets the NSR R wave in V5 to about 1.5 mV.
export const LEAD_GAIN = 0.0019;

export const wrapTime = (sim, t) => ((t % sim.duration) + sim.duration) % sim.duration;

// Per mesh vertex at time t: 0 resting, 1 activation front (first 12 ms), 2 depolarised, 3 repolarising
// (within 60 ms before its recovery time). Uses the latest wavefront that has reached the vertex by t.
export function vertexState(sim, t, out) {
  const n = out.length;
  out.fill(0);
  for (const w of sim.wavefronts) {
    if (w.t0 > t + 1) continue;
    const { act, repol } = w;
    for (let v = 0; v < n; v++) {
      const a = act[v];
      if (!(a <= t)) continue;
      const r = repol[v];
      out[v] = t - a < 12 ? 1 : t < r - 60 ? 2 : t < r ? 3 : 0;
    }
  }
  return out;
}

// The event to caption at time t: what is visible wins (pre-excitation, QRS, P, T, a re-entry circuit), then the
// quieter phases (blocked impulse, AV delay, ST); among equals the shortest. In atrial fibrillation the baseline is
// never quiet, so fibrillation is the caption whenever nothing ventricular is happening.
const CAPTION_ORDER = ["pre", "QRS", "P", "T", "reentry", "blocked", "sablock", "AV", "ST", "PR"];
export function eventAt(sim, t) {
  if (sim.vf) return VF_EVENT;
  let best = null, rank = Infinity;
  for (const e of sim.events) {
    if (!(e.t0 <= t && t < e.t1)) continue;
    const r = CAPTION_ORDER.indexOf(e.type);
    if (r < rank || (r === rank && e.t1 - e.t0 < best.t1 - best.t0)) { best = e; rank = r; }
  }
  if (sim.af && (!best || rank > CAPTION_ORDER.indexOf("T"))) return AF_EVENT;
  return best;
}
const AF_EVENT = Object.freeze({ type: "P", origin: "af", t0: 0, t1: 0 });
const VF_EVENT = Object.freeze({ type: "vf", t0: 0, t1: 0 });

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
