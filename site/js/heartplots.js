// Side plots for heart.html: action potentials at chosen sites and the heart-vector loops. DOM-free.

// Membrane potential (mV) of one voxel at time t, from every activation (act) and recovery (repol) time it has.
// A teaching shape: rest −90, upstroke to +20 in 2 ms, a notch to +5, a plateau sagging to −10, then phase 3 falling
// to −90 over the last `phase3` ms before recovery. Atrial cells have a short, triangular plateau.
export function membrane(acts, repols, t, { phase3 = 100, atrial = false } = {}) {
  let k = -1;
  for (let i = 0; i < acts.length; i++) if (acts[i] <= t && (k < 0 || acts[i] > acts[k])) k = i;
  if (k < 0) return -90;
  const a = acts[k], r = repols[k], dt = t - a;
  if (t >= r) return -90;
  if (dt < 2) return -90 + (110 * dt) / 2;
  if (dt < 10) return 20 - (15 * (dt - 2)) / 8;
  const p3 = Math.min(phase3, (r - a) * 0.6), start = r - p3;
  const plateauEnd = atrial ? -30 : -10;
  if (t < start) return 5 + ((plateauEnd - 5) * (t - a - 10)) / Math.max(1, start - a - 10);
  const f = (t - start) / p3;
  return plateauEnd + (-90 - plateauEnd) * (1 - (1 - f) ** 2);
}

// [ms, mV] points of one voxel's action potential over [t0, t1).
export function apCurve(sim, v, t0, t1, step = 2) {
  const acts = [], repols = [];
  let atrial = false;
  for (const w of sim.wavefronts) if (Number.isFinite(w.act[v])) { acts.push(w.act[v]); repols.push(w.repol[v]); atrial = w.kind === "atrial"; }
  const out = [];
  for (let t = t0; t < t1; t += step) out.push([t, membrane(acts, repols, t, { atrial })]);
  return out;
}

// The heart vector projected on a plane: frontal (patient left → right, up → up) or horizontal (left → right,
// anterior → down, seen from below as in the textbook V1–V6 diagram). Units: mV (lead gain).
const project = (sim, i, plane) => (plane === "frontal" ? [-sim.vectors[i * 3], sim.vectors[i * 3 + 2]] : [-sim.vectors[i * 3], -sim.vectors[i * 3 + 1]]);

// Where the current beat's vector loop starts at ms ti: the latest QRS (for 600 ms after it), else the latest P.
export function beatStart(sim, ti) {
  let start = 0;
  for (const e of sim.events) if ((e.type === "QRS" || e.type === "P") && e.t0 <= ti && e.t0 > start) start = e.type === "QRS" ? e.t0 : Math.max(start, e.t0);
  const qrs = sim.events.filter((e) => e.type === "QRS" && e.t0 <= ti).at(-1);
  if (qrs && ti - qrs.t0 < 600) start = qrs.t0;
  return start;
}
// The loop traced since the start of the current beat, up to t.
export function vectorLoop(sim, t, plane, gain = 1) {
  const n = sim.duration;
  const ti = Math.max(0, Math.min(n - 1, Math.floor(t)));
  const start = beatStart(sim, ti);
  const loop = [];
  for (let i = Math.floor(start); i <= ti; i += 2) loop.push(project(sim, i, plane).map((x) => x * gain));
  return { loop, now: project(sim, ti, plane).map((x) => x * gain) };
}

// Hexaxial reference lines (angle in degrees, 0 = patient left, positive = inferior) and the precordial axes.
export const HEXAXIAL = { I: 0, II: 60, III: 120, aVR: -150, aVL: -30, aVF: 90 };
export function precordialAxes(axes) {
  return Object.fromEntries(["V1", "V2", "V3", "V4", "V5", "V6"].map((l) => [l, [-axes[l][0], -axes[l][1]]]));
}
