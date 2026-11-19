import { test } from "node:test";
import assert from "node:assert/strict";
import { measure, panels, paperMm, tracePoints, ROW_MM } from "../site/js/ecgplot.js";

test("3x4 layout: 12 leads in 2.5 s columns plus a full lead II rhythm strip", () => {
  const p = panels(10, "3x4");
  assert.equal(p.length, 13);
  assert.deepEqual(p.find((x) => x.lead === "V4"), { lead: "V4", row: 0, t0: 7.5, t1: 10 });
  assert.deepEqual(p.at(-1), { lead: "II", row: 3, t0: 0, t1: 10 });
  assert.deepEqual(paperMm(10, 25, "3x4"), { w: 250, h: 4 * ROW_MM });
});

test("12x1 layout: one full-length row per lead", () => {
  const p = panels(10, "12x1");
  assert.equal(p.length, 12);
  assert.ok(p.every((x) => x.t0 === 0 && x.t1 === 10));
  assert.equal(paperMm(10, 50, "12x1").w, 500);
});

test("trace: 1 mV is 10 mm up at 10 mm/mV, 1 s is 25 mm at 25 mm/s", () => {
  const s = new Array(1001).fill(0);
  s[500] = 1000;
  const pts = tracePoints(s, 500, { row: 0, t0: 0, t1: 2 }, { speed: 25, gain: 10, ppm: 1 });
  const mid = ROW_MM / 2;
  assert.equal(pts[1000], 25);           // x of sample 500
  assert.equal(pts[1001], mid - 10);     // y of 1 mV
  assert.equal(pts[1], mid);
});

test("calipers: 25 mm at 25 mm/s is 1000 ms, 60 bpm; 10 mm at 10 mm/mV is 1 mV", () => {
  assert.deepEqual(measure(-50, 20, { speed: 25, gain: 10, ppm: 2 }), { ms: 1000, bpm: 60, mv: 1 });
  assert.equal(measure(0, 0, { speed: 25, gain: 10, ppm: 2 }).bpm, null);
});
