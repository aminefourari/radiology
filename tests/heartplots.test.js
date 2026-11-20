import { test } from "node:test";
import assert from "node:assert/strict";
import { membrane, vectorLoop } from "../site/js/heartplots.js";
import { buildHeart } from "../site/js/heartshape.js";
import { loadGraph, simulate } from "../site/js/heartsim.js";
import { axisDeg } from "../site/js/heartmeasure.js";

test("membrane: rest before activation, overshoot just after, plateau, back to rest after recovery", () => {
  const a = [100], r = [400];
  assert.equal(membrane(a, r, 50, {}), -90);
  assert.ok(membrane(a, r, 102, {}) > 0);
  assert.ok(membrane(a, r, 200, {}) > -20 && membrane(a, r, 200, {}) < 10);
  assert.ok(membrane(a, r, 390, {}) < membrane(a, r, 300, {}));
  assert.equal(membrane(a, r, 401, {}), -90);
  assert.ok(membrane([100, 900], [400, 1200], 905, {}) > 0, "the next beat");
});

test("vector loop: the frontal QRS loop's mean direction matches the QRS axis", () => {
  const g = loadGraph(buildHeart().json, { radius: 3.5 });
  const s = simulate(g, { duration: 1700, sinus: { cycle: 800 }, avDelay: 90 });
  const q = s.events.filter((e) => e.type === "QRS")[1];
  const { loop } = vectorLoop(s, q.t1, "frontal");
  const sum = loop.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
  const loopDeg = (Math.atan2(-sum[1], sum[0]) * 180) / Math.PI; // screen up = superior, axis angles positive inferior
  const ax = axisDeg(s.leads, Math.round(q.t0 / 2) - 4, Math.round(q.t1 / 2) + 4);
  assert.ok(Math.abs(loopDeg - ax) < 20, `loop ${loopDeg} vs axis ${ax}`);
});
