import { test } from "node:test";
import assert from "node:assert/strict";
import { activate, loadGraph, repolarise } from "../site/js/heartsim.js";

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
