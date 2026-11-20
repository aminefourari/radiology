import { test } from "node:test";
import assert from "node:assert/strict";
import { activate, heartVectors, LEADS, leadAxes, leadSignals, loadGraph, repolarise } from "../site/js/heartsim.js";

// A flat nx × ny grid in the x/y plane, every vertex the same chamber; no conduction system.
export function gridGraph(nx, ny, mm = 1, chamber = 3) {
  const pos = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) pos.push(i * mm, j * mm, 0);
  const n = nx * ny;
  return { pos, chamber: Array(n).fill(chamber), area: Array(n).fill(mm * mm), purkinje: Array(n).fill(-1),
    lines: {}, landmarks: {}, electrodes: {}, centre: [0, 0, 0] };
}

const line = () => loadGraph(gridGraph(21, 1), { radius: 1.5 });

test("activation spreads at the tissue velocity", () => {
  const act = activate(line(), [{ v: 0, t: 0 }]);
  assert.equal(act[0], 0);
  assert.ok(Math.abs(act[20] - 40) <= 1, `vertex 20 at ${act[20]} ms, expected ~40 (20 mm at 0.5 mm/ms)`);
});

test("a cut vertex blocks conduction beyond it", () => {
  const act = activate(line(), [{ v: 0, t: 0 }], { cut: new Set([10]) });
  assert.ok(Number.isFinite(act[9]));
  for (let i = 10; i <= 20; i++) assert.equal(act[i], Infinity);
});

test("two sources meet in the middle", () => {
  const act = activate(line(), [{ v: 0, t: 0 }, { v: 20, t: 0 }]);
  assert.ok(Math.abs(act[10] - 20) <= 1);
  assert.ok(act[5] < act[10] && act[15] < act[10]);
});

test("an impulse does not enter chambers it is not allowed into", () => {
  const json = gridGraph(21, 1);
  for (let i = 11; i < 21; i++) json.chamber[i] = 2;
  const g = loadGraph(json, { radius: 1.5 });
  const allow = new Uint8Array(5); allow[3] = 1;
  const act = activate(g, [{ v: 0, t: 0 }], { allow });
  assert.ok(Number.isFinite(act[10]));
  assert.equal(act[11], Infinity);
});

test("atria and ventricles are electrically insulated in the muscle graph", () => {
  const json = gridGraph(21, 1);
  for (let i = 11; i < 21; i++) json.chamber[i] = 0; // atrium next to ventricle
  const act = activate(loadGraph(json, { radius: 1.5 }), [{ v: 0, t: 0 }]);
  assert.equal(act[11], Infinity);
});

test("later-activated tissue repolarises sooner after its activation", () => {
  const g = line();
  const act = activate(g, [{ v: 0, t: 0 }]);
  const rep = repolarise(g, act);
  const apd = (i) => rep[i] - act[i];
  assert.ok(apd(20) < apd(0));
  assert.ok(rep[20] > act[20]);
  assert.ok(rep[20] < rep[0], "repolarisation runs in reverse: last activated recovers first");
});

test("unreached vertices never repolarise", () => {
  const g = line();
  const act = activate(g, [{ v: 0, t: 0 }], { cut: new Set([10]) });
  assert.equal(repolarise(g, act)[15], Infinity);
});

test("duplicate vertices (zero-length edges) don't stall activation", () => {
  const json = gridGraph(3, 1, 0.7);
  json.pos.push(0.7 * 3 + 0.1, 0, 0, 0.7 * 3 + 0.1, 0, 0, 0.7 * 3 + 0.1 + 1 / 3, 0, 0); // two identical points, then one more
  json.chamber.push(3, 3, 3); json.area.push(1, 1, 1); json.purkinje.push(-1, -1, -1);
  const act = activate(loadGraph(json, { radius: 1.5 }), [{ v: 0, t: 0.1 }]);
  assert.ok([...act].every(Number.isFinite));
  assert.equal(act[3], act[4]);
});

const close = (a, b, eps = 1e-6) => a.every((x, i) => Math.abs(x - b[i]) < eps);

test("lead axes: hexaxial frontal leads in RAS, precordial towards the electrodes", () => {
  const json = gridGraph(2, 1);
  json.electrodes = { V1: [0, 10, 0], V2: [0, 10, 0], V3: [0, 10, 0], V4: [0, 10, 0], V5: [0, 10, 0], V6: [-10, 0, 0] };
  const ax = leadAxes(loadGraph(json));
  assert.deepEqual(Object.keys(ax), LEADS);
  assert.ok(close(ax.I, [-1, 0, 0]));
  assert.ok(close(ax.aVF, [0, 0, -1]));
  assert.ok(close(ax.II, [-0.5, 0, -Math.sqrt(3) / 2]));
  assert.ok(close(ax.V1, [0, 1, 0]));
  assert.ok(close(ax.V6, [-1, 0, 0]));
});

// 41 vertices along x; activation from the +x end moves towards patient left (-x).
function leftward(fromEnd = 40) {
  const json = gridGraph(41, 1);
  json.electrodes = Object.fromEntries(LEADS.slice(6).map((l) => [l, [0, 10, 0]]));
  const g = loadGraph(json, { radius: 1.5 });
  const act = activate(g, [{ v: fromEnd, t: 0 }]);
  return { g, wf: [{ act, repol: repolarise(g, act), weight: 1 }] };
}

test("a leftward front gives a leftward heart vector", () => {
  const { g, wf } = leftward();
  const h = heartVectors(g, wf, 400);
  assert.ok(h[3 * 40] < 0, "x component negative mid-activation");
  assert.ok(Math.abs(h[3 * 40 + 1]) < 1e-6 && Math.abs(h[3 * 40 + 2]) < 1e-6);
});

test("lead I is positive and aVR negative for a leftward front; reversing the front flips them", () => {
  const peakOf = (s) => s.reduce((m, x) => (Math.abs(x) > Math.abs(m) ? x : m), 0);
  const a = leftward(40), b = leftward(0);
  const la = leadSignals(a.g, a.wf, 400), lb = leadSignals(b.g, b.wf, 400);
  assert.equal(la.I.length, 200); // 400 ms at 500 Hz
  assert.ok(peakOf(la.I.slice(0, 50)) > 0 && peakOf(la.aVR.slice(0, 50)) < 0);
  assert.ok(peakOf(lb.I.slice(0, 50)) < 0 && peakOf(lb.aVR.slice(0, 50)) > 0);
});

test("repolarising in reverse order gives a T wave with the same sign as the QRS", () => {
  const { g, wf } = leftward();
  const I = leadSignals(g, wf, 400).I;
  const qrs = I.slice(0, 50).reduce((a, x) => a + x, 0), t = I.slice(60).reduce((a, x) => a + x, 0);
  assert.ok(qrs > 0 && t > 0, `QRS area ${qrs}, T area ${t}`);
});

test("explicit links join distant vertices as ventricular muscle", () => {
  const json = gridGraph(2, 1, 10); // 10 mm apart: beyond the radius
  json.links = [[0, 1]];
  const act = activate(loadGraph(json, { radius: 5 }), [{ v: 0, t: 0 }]);
  assert.ok(Math.abs(act[1] - 20) < 1e-9);
});

test("chamber weights scale each chamber's share of the heart vector", () => {
  const { g, wf } = leftward();
  const full = heartVectors(g, wf, 100, { chamberWeight: [1, 1, 1, 1] });
  const third = heartVectors(g, wf, 100, { chamberWeight: [1, 1, 1, 1 / 3] }); // grid is chamber 3 (LV)
  assert.ok(Math.abs(third[3 * 40] - full[3 * 40] / 3) < 1e-3);
});

test("recovery directions mirror activation when recovery runs in exact reverse", () => {
  // A 2D grid with a corner source: the front is curved, so one-sided estimates would disagree.
  const json = gridGraph(15, 15);
  const g = loadGraph(json, { radius: 1.5 });
  const act = activate(g, [{ v: 0, t: 0 }]);
  const repol = act.map((t) => 500 - t);
  const a = heartVectors(g, [{ act, repol: act.map(() => Infinity), weight: 1 }], 600);
  const r = heartVectors(g, [{ act: act.map(() => Infinity), repol, weight: 1 }], 600, { repolFront: 12 });
  const sum = (h, t0, t1) => [0, 1].map((q) => { let s = 0; for (let t = t0; t < t1; t++) s += h[t * 3 + q]; return s; });
  const [qa, ra] = [sum(a, 0, 100), sum(r, 400, 520)];
  assert.ok(Math.abs(qa[0] - ra[0]) < 1e-3 * Math.abs(qa[0]) && Math.abs(qa[1] - ra[1]) < 1e-3 * Math.abs(qa[1]), `${qa} vs ${ra}`);
});

test("the T wave is a smooth hump, not a step", () => {
  const { g, wf } = leftward();
  const I = leadSignals(g, wf, 600).I;
  const t = I.slice(60);
  const peak = Math.max(...t.map(Math.abs));
  const jump = Math.max(...t.slice(1).map((x, i) => Math.abs(x - t[i])));
  assert.ok(jump < 0.08 * peak, `largest step ${jump} vs peak ${peak}`);
});

test("APD comes from the reference (normal) activation: an abnormal sequence gives a discordant T", () => {
  const g = line();
  const normal = activate(g, [{ v: 0, t: 0 }]);
  const abnormal = activate(g, [{ v: 20, t: 0 }]); // the reverse sequence
  const rep = repolarise(g, abnormal, { reference: normal });
  assert.ok(rep[0] > rep[20], "the last-activated end recovers last");
  assert.ok(Math.abs(rep[0] - abnormal[0] - 290) < 1e-9, "vertex 0 activates first normally: full APD");
  assert.ok(Math.abs(rep[20] - abnormal[20] - (290 - 1.2 * normal[20])) < 1e-9, "vertex 20 keeps its normal (shorter) APD");
  const repNormal = repolarise(g, normal);
  assert.ok(Math.abs(repNormal[0] - rep[0] + (abnormal[0] - normal[0])) < 1e-9);
});
