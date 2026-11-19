import { test } from "node:test";
import assert from "node:assert/strict";
import { anchors, layoutLabels } from "../site/js/labels.js";

test("anchor of an L-shape lies on the structure", () => {
  const w = 10, h = 10, lab = new Uint8Array(100);
  for (let i = 0; i < 10; i++) { lab[i * w] = 3; lab[9 * w + i] = 3; } // left column + bottom row
  const a = anchors(lab, w, h, new Set([3])).get(3);
  assert.equal(lab[a.y * w + a.x], 3);
  assert.equal(a.area, 19);
});

test("1-pixel structure gets an anchor; absent id is omitted", () => {
  const lab = new Uint8Array(16);
  lab[5] = 7;
  const m = anchors(lab, 4, 4, new Set([7, 9]));
  assert.deepEqual(m.get(7), { x: 1, y: 1, area: 1 });
  assert.equal(m.has(9), false);
});

test("labels on one side are spaced by lineHeight and stay in bounds", () => {
  const m = new Map([[1, { x: 1, y: 50, area: 1 }], [2, { x: 2, y: 50, area: 1 }], [3, { x: 3, y: 50, area: 1 }]]);
  const out = layoutLabels(m, 100, 100, 10);
  const ys = out.map((l) => l.y).sort((a, b) => a - b);
  assert.ok(out.every((l) => l.side === "left"));
  assert.ok(ys[1] - ys[0] >= 10 && ys[2] - ys[1] >= 10);
  assert.ok(out.every((l) => l.y >= 0 && l.y <= 100));
});

test("side follows image position, overflow near the bottom shifts up", () => {
  const m = new Map([[1, { x: 90, y: 99, area: 1 }], [2, { x: 91, y: 99, area: 1 }]]);
  const out = layoutLabels(m, 100, 100, 10);
  assert.ok(out.every((l) => l.side === "right"));
  assert.ok(out.every((l) => l.y >= 0 && l.y <= 100));
});

test("too many labels for the height returns null", () => {
  const m = new Map();
  for (let i = 1; i <= 16; i++) m.set(i, { x: 1, y: i, area: 1 });
  assert.equal(layoutLabels(m, 100, 100, 10), null);
});
