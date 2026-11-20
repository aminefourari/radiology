import { test } from "node:test";
import assert from "node:assert/strict";
import { axisDeg, netArea, peaks, qrsShape, upstrokeMs } from "../site/js/heartmeasure.js";

// Piecewise-linear signal through [index, value] knots, zero elsewhere.
function sig(knots, n = 100) {
  const s = new Float32Array(n);
  for (let k = 1; k < knots.length; k++) {
    const [i0, v0] = knots[k - 1], [i1, v1] = knots[k];
    for (let i = i0; i <= i1; i++) s[i] = v0 + (v1 - v0) * (i - i0) / (i1 - i0);
  }
  return s;
}

test("peaks: alternating extrema above the floor, in order", () => {
  const p = peaks(sig([[10, 0], [15, 0.2], [20, -1], [25, 0], [27, 0.02], [29, 0]]), 0, 100);
  assert.deepEqual(p.map((x) => x.i), [15, 20]);
  assert.ok(Math.abs(p[1].v + 1) < 1e-6);
});

test("qrsShape names the classic complexes", () => {
  assert.equal(qrsShape(sig([[10, 0], [15, 0.2], [20, -1], [25, 0]]), 0, 100), "rS");
  assert.equal(qrsShape(sig([[10, 0], [13, -0.1], [18, 1.2], [25, 0]]), 0, 100), "qR");
  assert.equal(qrsShape(sig([[10, 0], [14, 0.3], [18, -0.4], [24, 0.9], [30, 0]]), 0, 100), "rsR′");
  assert.equal(qrsShape(sig([[10, 0], [15, -0.8], [25, 0]]), 0, 100), "QS");
  assert.equal(qrsShape(sig([[10, 0], [18, 1.0], [25, 0]]), 0, 100), "R");
});

test("netArea is the signed area in mV·s", () => {
  assert.ok(Math.abs(netArea(sig([[0, 1], [99, 1]]), 0, 100, 500) - 0.2) < 1e-6);
});

test("a slurred upstroke takes longer than a sharp one", () => {
  const sharp = sig([[10, 0], [14, 1], [20, 0]]);
  const slurred = sig([[10, 0], [22, 0.3], [26, 1], [32, 0]]);
  assert.ok(upstrokeMs(slurred, 10, 40, 500) > upstrokeMs(sharp, 10, 40, 500));
  assert.equal(upstrokeMs(sharp, 10, 40, 500), Math.round(((13.2 - 10) / 500) * 1000));
});

test("axisDeg from leads I and aVF", () => {
  const one = sig([[10, 0], [15, 1], [20, 0]]);
  assert.equal(Math.round(axisDeg({ I: one, aVF: one }, 0, 100)), 45);
  assert.equal(Math.round(axisDeg({ I: one, aVF: one.map((x) => -x) }, 0, 100)), -45);
});
