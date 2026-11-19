import { test } from "node:test";
import assert from "node:assert/strict";
import { colorTable, compositeOverlay, visibleIds } from "../site/js/overlay.js";

const structures = [
  { id: 1, key: "liver", system: "organs", color: "#ff0000", parent: null },
  { id: 2, key: "liver_segment_1", system: "segments", color: "#00ff00", parent: 1 },
];

test("segment pixel uses parent colour when only the parent's system is on", () => {
  const t = colorTable(structures, new Set(["organs"]), new Set());
  assert.deepEqual([...t.slice(8, 12)], [255, 0, 0, 255]);
});

test("segment pixel uses own colour when its system is on", () => {
  const t = colorTable(structures, new Set(["organs", "segments"]), new Set());
  assert.deepEqual([...t.slice(8, 12)], [0, 255, 0, 255]);
});

test("both systems off, hidden ids and background are transparent", () => {
  assert.equal(colorTable(structures, new Set(), new Set())[11], 0);
  assert.equal(colorTable(structures, new Set(["segments"]), new Set([2]))[11], 0);
  assert.equal(colorTable(structures, new Set(["organs"]), new Set([1]))[11], 0); // hidden parent
  assert.equal(colorTable(structures, new Set(["organs", "segments"]), new Set())[3], 0);
  assert.deepEqual([...visibleIds(colorTable(structures, new Set(["organs"]), new Set()))], [1, 2]);
});

test("outline mode paints only boundary pixels", () => {
  const w = 5, h = 5;
  const labels = new Uint8Array(25);
  for (let r = 1; r < 4; r++) for (let c = 1; c < 4; c++) labels[r * w + c] = 1;
  const rgba = new Uint8ClampedArray(100).fill(100);
  const t = colorTable(structures, new Set(["organs"]), new Set());
  compositeOverlay(rgba, labels, t, 1, "outline", w, h);
  assert.equal(rgba[(2 * w + 2) * 4], 100); // centre untouched
  assert.equal(rgba[(1 * w + 1) * 4], 255); // edge painted red
  assert.equal(rgba[0], 100); // background untouched
});

test("fill mode blends with opacity", () => {
  const rgba = new Uint8ClampedArray([0, 0, 0, 255]);
  compositeOverlay(rgba, new Uint8Array([1]), colorTable(structures, new Set(["organs"]), new Set()), 0.5, "fill", 1, 1);
  assert.ok(Math.abs(rgba[0] - 128) <= 1);
  assert.equal(rgba[1], 0);
});
