// Cardiac activation simulator for the "How the ECG is made" page. DOM-free, deterministic.
// Graph: heart mesh vertices (RAS mm) + a Purkinje layer + conduction lines, built from heart-graph.json.

// Conduction velocity in mm/ms by tissue code.
export const TISSUE = { atrium: 0, avnode: 1, his: 2, purkinje: 3, ventricle: 4, accessory: 5 };
export const VELOCITY = [1.3, 0.05, 2.5, 1.5, 0.5, 1.0];
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
  // Explicit links across walls thicker than the radius (LV free wall, septum).
  for (const [a, b] of json.links ?? []) edges.push([a, b, dist(json.pos, a, b), TISSUE.ventricle, false]);

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

// Repolarisation time = act + APD. APD is a property of the tissue: shorter where the *normal* (reference)
// sequence arrives later, so in sinus rhythm recovery runs roughly in reverse (slope > 1) and the T wave is
// upright and concordant. In an abnormal sequence (bundle branch block, PVC, VT) the late tissue still
// recovers late, which gives the discordant T. Without a reference, act is its own reference.
export function repolarise(g, act, { apd = 290, slope = 1.2, reference = act } = {}) {
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

// Unit direction the front travelled through each mesh vertex: the normalised gradient of the arrival times,
// least-squares over all mesh neighbours (symmetric, so a time field and its mirror give opposite directions).
// Zero where no neighbour has a finite time.
function frontDirections(g, times) {
  const d = new Float32Array(g.nMesh * 3);
  for (let v = 0; v < g.nMesh; v++) {
    const tv = times[v];
    if (!Number.isFinite(tv)) continue;
    let x = 0, y = 0, z = 0;
    for (let k = g.start[v]; k < g.start[v + 1]; k++) {
      const u = g.nbr[k];
      if (u >= g.nMesh || !Number.isFinite(times[u])) continue;
      const w = (times[u] - tv) / (g.len[k] * g.len[k] || 1);
      x += w * (g.pos[u * 3] - g.pos[v * 3]); y += w * (g.pos[u * 3 + 1] - g.pos[v * 3 + 1]); z += w * (g.pos[u * 3 + 2] - g.pos[v * 3 + 2]);
    }
    const n = Math.hypot(x, y, z);
    if (n) { d[v * 3] = x / n; d[v * 3 + 1] = y / n; d[v * 3 + 2] = z / n; }
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
export function heartVectors(g, wavefronts, duration, { front = 12, repolFront = 160, repolGain = 1, chamberWeight = CHAMBER_WEIGHT } = {}) {
  const diff = new Float64Array((duration + 1) * 3), imp = new Float64Array(duration * 3);
  for (const { act, repol, weight, repolWeight = weight } of wavefronts) {
    const da = frontDirections(g, act), dr = frontDirections(g, repol);
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
const ATRIAL_WEIGHT = 0.06, ATRIAL_REPOL_WEIGHT = 0.015; // thin atrial walls: small P, smaller Ta
const ATRIAL_APD = { apd: 200, slope: 0.3 };
const ATRIAL_REFRACTORY = 150, VENTRICULAR_GUARD = 30; // ms the atria / a just-recovered vertex stay inexcitable
const HIS_REFRACTORY = 380;
const RETRO_PATHWAY_MS = 35; // ventricular end → atrial end of the accessory pathway, retrograde (AVRT) // after a ventricular beat the His–Purkinje system won't conduct (concealed PVC → pause)

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

export function simulate(g, model) {
  const D = model.duration;
  const lm = g.landmarks;
  const rand = seeded(model.af?.seed ?? 1);
  const atrial = [], ventricular = [], events = [];
  const cut = new Set((model.cut ?? []).flatMap((c) => (c === "lbb" ? ["lbb", "laf", "lpf"] : [c])).flatMap((c) => g.lineNodes[c].slice(1)));
  if (model.reentry?.circuit === "vt") {
    // The scar blocks conduction; the exit (where the circuit leaves the scar) and its neighbours stay excitable.
    const exit = new Set([lm.vt_exit]);
    for (let k = g.start[lm.vt_exit]; k < g.start[lm.vt_exit + 1]; k++) exit.add(g.nbr[k]);
    for (const v of lm.vt_scar) if (!exit.has(v)) cut.add(v);
  }
  const ref = reference(g);
  const atrialRefractory = new Float64Array(g.n).fill(-Infinity);

  // 1. Atrial impulses, in time order.
  const atrialSources = []; // {sources, kind}
  if (model.sinus) for (let t = 20; t < D; t += model.sinus.cycle) atrialSources.push({ sources: [{ v: lm.sa, t }], kind: "sinus" });
  if (model.reentry?.circuit === "flutter") {
    for (let t = 0; t < D; t += model.reentry.cycle) atrialSources.push({ sources: lapSources(g, lm.tricuspid_ring, t, model.reentry.cycle, new Set(lm.cti)), kind: "flutter" });
  }
  if (model.af) {
    const atrialVerts = [];
    for (let v = 0; v < g.nMesh; v++) if (g.chamber[v] <= 1) atrialVerts.push(v);
    for (let t = 0; t < D; t += 40 + rand() * 60) atrialSources.push({ sources: [{ v: atrialVerts[Math.floor(rand() * atrialVerts.length)], t }], kind: "af", reach: 70 });
  }
  const retro = []; // retrograde atrial sources produced by re-entry, added below
  const runAtrial = (src) => {
    const t0 = Math.min(...src.sources.map((s) => s.t));
    const act = activate(g, src.sources, { allow: ATRIA, refractoryUntil: atrialRefractory, maxTime: src.reach ? t0 + src.reach : Infinity });
    if (src.reach) for (let v = 0; v < g.n; v++) if (act[v] > t0 + src.reach) act[v] = Infinity;
    const [lo, hi] = meshSpan(g, act, ATRIA);
    if (!Number.isFinite(lo)) return null;
    for (let v = 0; v < g.n; v++) if (Number.isFinite(act[v])) atrialRefractory[v] = act[v] + ATRIAL_REFRACTORY;
    const w = { act, repol: repolarise(g, act, ATRIAL_APD), weight: ATRIAL_WEIGHT, repolWeight: ATRIAL_REPOL_WEIGHT, kind: "atrial", beat: atrial.length, t0: lo, t1: hi };
    atrial.push(w);
    events.push({ type: "P", t0: lo, t1: hi, beat: w.beat });
    if (src.kind === "flutter") events.push({ type: "reentry", t0, t1: t0 + model.reentry.cycle, beat: w.beat, circuit: "flutter" });
    return w;
  };

  // 2. AV conduction and ventricular impulses.
  const ventricularStarts = []; // {sources, t, kind}
  let lastConducted = -Infinity, conductedCount = 0, arrivalCount = 0;
  const pattern = model.block?.pattern;
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
    if (model.reentry?.circuit === "flutter") conducts = k % model.reentry.conduct === 0;
    if (model.af) {
      conducts = ta >= lastConducted + model.af.avRefractory + rand() * 250;
      delay += rand() * 40;
    }
    if (ta + delay < lastVentricular() + HIS_REFRACTORY) { conducts = false; level = "his"; }
    if (conducts) {
      lastConducted = ta; conductedCount++;
      events.push({ type: "AV", t0: ta, t1: ta + delay, beat: w.beat });
      const sources = [{ v: g.lineNodes.his[0], t: ta + delay }];
      if (model.accessory) sources.push({ v: lm.accessory[1], t: w.act[lm.accessory[0]] + 10 });
      ventricularStarts.push({ sources, t: Math.min(...sources.map((s) => s.t)), kind: model.accessory ? "pre" : "conducted", p: w });
    } else {
      events.push({ type: "blocked", t0: ta, t1: ta + (level === "his" ? delay : 40), beat: w.beat, level });
    }
  }
  function lastVentricular() { return ventricularStarts.length ? ventricularStarts.at(-1).t : -Infinity; }

  // 3. Ventricular impulses not driven by the atria.
  if (model.escape) {
    const v = model.escape.site === "junction" ? g.lineNodes.his[0] : lm.apex;
    for (let t = 300; t < D; t += model.escape.cycle) ventricularStarts.push({ sources: [{ v, t }], t, kind: model.escape.site });
  }
  for (const e of model.ectopic ?? []) ventricularStarts.push({ sources: [{ v: lm[e.site], t: e.t }], t: e.t, kind: "ectopic" });
  if (model.reentry?.circuit === "vt") {
    for (let t = 100; t < D; t += model.reentry.cycle) ventricularStarts.push({ sources: [{ v: lm.vt_exit, t }], t, kind: "vt" });
  }
  if (model.reentry?.circuit === "avnrt" || model.reentry?.circuit === "avrt") {
    for (let t = 100; t < D; t += model.reentry.cycle) {
      ventricularStarts.push({ sources: [{ v: g.lineNodes.his[0], t }], t, kind: model.reentry.circuit });
      if (model.reentry.circuit === "avnrt") retro.push({ sources: [{ v: lm.avnode, t: t + 5 }], kind: "retro" });
    }
  }
  // Ectopic and escape beats conceal the next sinus impulse: drop conducted beats that land in refractoriness.
  ventricularStarts.sort((a, b) => a.t - b.t);
  const kept = [];
  for (const s of ventricularStarts) {
    if (kept.length && s.t < kept.at(-1).t + HIS_REFRACTORY && s.kind === "conducted") {
      const ev = events.find((e) => e.type === "AV" && e.beat === s.p.beat);
      Object.assign(ev, { type: "blocked", level: "his" });
      continue;
    }
    kept.push(s);
  }

  // 4. Spread each ventricular impulse; tissue is refractory until it has recovered from the previous beat.
  const refractory = new Float64Array(g.n).fill(-Infinity);
  for (const s of kept) {
    const act = activate(g, s.sources, { allow: VENTRICLES, cut, refractoryUntil: refractory });
    const [lo, hi] = meshSpan(g, act, VENTRICLES);
    if (!Number.isFinite(lo)) continue;
    const repol = repolarise(g, act, { reference: ref });
    for (let v = 0; v < g.n; v++) if (Number.isFinite(act[v])) refractory[v] = repol[v] + VENTRICULAR_GUARD;
    const beat = ventricular.length;
    ventricular.push({ act, repol, weight: 1, kind: "ventricular", beat, t0: lo, t1: hi });
    events.push({ type: "QRS", t0: lo, t1: hi, beat, origin: s.kind });
    if (s.kind === "pre") {
      const his = s.sources[0].t;
      events.push({ type: "pre", t0: lo, t1: Math.max(lo + 10, his + 15), beat });
    }
    if (s.kind === "conducted" || s.kind === "pre") events.push({ type: "PR", t0: s.p.t0, t1: lo, beat });
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
  const vectors = heartVectors(g, wavefronts, D);
  const leads = leadSignals(g, wavefronts, D, { vectors, gain: LEAD_GAIN });
  events.sort((a, b) => a.t0 - b.t0 || a.t1 - b.t1);
  return { duration: D, fs: 500, wavefronts, vectors, leads, events };
}

// mV per unit of heart vector: sets the NSR R wave in V5 to about 1.5 mV.
export const LEAD_GAIN = 0.0082;

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

// The innermost event covering t (shortest wins), for the caption.
export function eventAt(sim, t) {
  let best = null;
  for (const e of sim.events) if (e.t0 <= t && t < e.t1 && (!best || e.t1 - e.t0 < best.t1 - best.t0)) best = e;
  return best;
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
