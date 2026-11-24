import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSlice } from "../site/js/volume.js";
import { nearest, poseFrame, samplePlane, trilinear } from "../site/js/usgeom.js";

// dims [X=2, Y=3, Z=4]; value = x + 10*y + 100*z, stored [z][y][x]
const dims = [2, 3, 4];
const vol = new Int16Array(24);
for (let z = 0; z < 4; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) vol[z * 6 + y * 2 + x] = x + 10 * y + 100 * z;
const close = (a, b, eps = 1e-9) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} vs ${b}`));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test("samplePlane on an axial plane equals extractSlice", () => {
  for (let z = 0; z < 4; z++) {
    const out = samplePlane(vol, dims, [1, 1, 1], [1, 2, z], [-1, 0, 0], [0, -1, 0], 2, 3, 1, new Float32Array(6));
    assert.deepEqual([...out], [...extractSlice(vol, dims, "axial", z)]);
  }
});

test("trilinear works in mm and interpolates halfway; `outside` beyond the grid", () => {
  assert.equal(trilinear(vol, dims, [2, 2, 2], 1, 2, 2, -1), 0.5 + 10 + 100);
  assert.equal(trilinear(vol, dims, [1, 1, 1], 0.5, 0.5, 0.5, -1), 0.5 + 5 + 50);
  assert.equal(trilinear(vol, dims, [1, 1, 1], -0.01, 0, 0, -1), -1);
  assert.equal(trilinear(vol, dims, [1, 1, 1], 0, 0, 3.01, -7), -7);
});

test("nearest rounds to the closest voxel and is 0 outside", () => {
  assert.equal(nearest(vol, dims, [1, 1, 1], 0.6, 1.4, 2.2), 1 + 10 + 200);
  assert.equal(nearest(vol, dims, [1, 1, 1], 5, 0, 0), 0);
});

const anterior = { p: [10, 20, 30], n: [0, -1, 0] };

test("poseFrame with zero angles: b = n, m = +z, e = b × m", () => {
  const f = poseFrame(anterior, { rock: 0, fan: 0, rot: 0 });
  close(f.p, [10, 20, 30]);
  close(f.b, [0, -1, 0]);
  close(f.m, [0, 0, 1]);
  close(f.e, [-1, 0, 0]); // b × m: the patient's left
});

test("rot 90 turns the marker to the patient's right (+x in RAS) on an anterior probe", () => {
  const f = poseFrame(anterior, { rock: 0, fan: 0, rot: 90 });
  close(f.m, [1, 0, 0]);
  close(f.b, [0, -1, 0]);
});

test("m is +z projected off a tilted normal", () => {
  const n = [0, -Math.SQRT1_2, -Math.SQRT1_2];
  const f = poseFrame({ p: [0, 0, 0], n }, { rock: 0, fan: 0, rot: 0 });
  close(f.m, [0, -Math.SQRT1_2, Math.SQRT1_2]);
});

test("rock tilts b toward m; fan tilts b toward e; frame stays orthonormal", () => {
  const base = poseFrame(anterior, { rock: 0, fan: 0, rot: 0 });
  const r = poseFrame(anterior, { rock: 30, fan: 0, rot: 0 });
  assert.ok(dot(r.b, base.m) > 0.49);
  const f = poseFrame(anterior, { rock: 0, fan: 30, rot: 0 });
  assert.ok(dot(f.b, base.e) > 0.49);
  close(f.m, base.m);
  for (const g of [r, f, poseFrame(anterior, { rock: -20, fan: 50, rot: 137 })]) {
    for (const v of [g.b, g.m, g.e]) assert.ok(Math.abs(dot(v, v) - 1) < 1e-9);
    assert.ok(Math.abs(dot(g.b, g.m)) < 1e-9 && Math.abs(dot(g.b, g.e)) < 1e-9 && Math.abs(dot(g.m, g.e)) < 1e-9);
  }
});
