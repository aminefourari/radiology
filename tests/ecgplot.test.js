import { test } from "node:test";
import assert from "node:assert/strict";
import { measure, panels, paperMm, pathData, stSegments, tracePoints, waveBands, ROW_MM } from "../site/js/ecgplot.js";

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

test("pathData: move then lines, two decimals", () => {
  assert.equal(pathData(new Float32Array([0, 1, 2.5, 3.125])), "M0.00 1.00L2.50 3.13");
});

test("waveBands: clip each wave to its panel's time window and row", () => {
  const waves = [{ k: "P", on: 100, off: 150 }, { k: "QRS", on: 1240, off: 1260 }, { k: "T", on: 2000, off: 2100 }];
  const bands = waveBands(waves, 500, { row: 1, t0: 2.5, t1: 5 }, 25); // panel covers samples 1250..2500
  assert.deepEqual(bands.map((b) => ({ ...b, w: +b.w.toFixed(6) })), [{ k: "QRS", x: 62.5, w: 0.5, y: ROW_MM, h: ROW_MM }, { k: "T", x: 100, w: 5, y: ROW_MM, h: ROW_MM }]);
});

test("stSegments: each QRS offset to the next T onset", () => {
  const w = [{ k: "P", on: 0, off: 5 }, { k: "QRS", on: 10, off: 20 }, { k: "T", on: 40, off: 60 }, { k: "QRS", on: 100, off: 110 }];
  assert.deepEqual(stSegments(w), [{ k: "ST", on: 20, off: 40 }]);
});
