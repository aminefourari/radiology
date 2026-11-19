import { test } from "node:test";
import assert from "node:assert/strict";
import { castRays, labelBounds } from "../site/js/render3d.js";

// 8³ volume: label 1 at patient right (x high), label 2 at patient left (x low), both mid-height.
const dims = [8, 8, 8], X = 8, Y = 8;
const labels = new Uint8Array(512);
for (let z = 2; z < 6; z++) for (let y = 2; y < 6; y++) {
  labels[(z * Y + y) * X + 6] = 1;
  labels[(z * Y + y) * X + 1] = 2;
}
const visible = new Uint8Array(256).fill(1);

function cast(yaw, pitch, vis = visible) {
  const box = labelBounds(labels, dims);
  const ids = new Uint8Array(16), depth = new Float32Array(16);
  castRays(labels, dims, [1, 1, 1], vis, box, { yaw, pitch, mmPerPx: 1.5 }, 4, 4, ids, depth);
  return { ids, depth };
}

test("labelBounds is the half-open box around labelled voxels, null when empty", () => {
  assert.deepEqual(labelBounds(labels, dims), [1, 2, 2, 7, 6, 6]);
  assert.equal(labelBounds(new Uint8Array(512), dims), null);
});

test("anterior view is radiological: patient right on screen left", () => {
  const { ids } = cast(0, 0);
  assert.equal(ids[4], 1); // row 1, left column
  assert.equal(ids[7], 2); // row 1, right column
});

test("lateral view from the left sees the left-sided label in front", () => {
  const { ids } = cast(Math.PI / 2, 0); // viewer moves to the patient's left
  assert.ok(ids.includes(2));
  assert.ok(!ids.includes(1));
});

test("hidden labels are seen through", () => {
  const vis = new Uint8Array(256).fill(1);
  vis[2] = 0;
  const { ids } = cast(Math.PI / 2, 0, vis);
  assert.ok(ids.includes(1));
  assert.ok(!ids.includes(2));
});
