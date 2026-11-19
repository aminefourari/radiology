import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import {
  decodeMaybeGzip, extractSlice, pixelAspect, planeSize, sliceCount, windowToGray,
} from "../site/js/volume.js";

// dims [X=2, Y=3, Z=4]; value = x + 10*y + 100*z, stored [z][y][x]
const dims = [2, 3, 4];
const vol = new Int16Array(24);
for (let z = 0; z < 4; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) vol[z * 6 + y * 2 + x] = x + 10 * y + 100 * z;

test("axial: patient right on viewer left, anterior on top", () => {
  assert.deepEqual(planeSize(dims, "axial"), [2, 3]);
  const s = extractSlice(vol, dims, "axial", 1);
  assert.equal(s.length, 6);
  assert.equal(s[0], 1 + 20 + 100); // x=1 (right-most), y=2 (anterior)
  assert.equal(s[5], 0 + 0 + 100); // last row/col: x=0, y=0
});

test("coronal: superior on top", () => {
  assert.deepEqual(planeSize(dims, "coronal"), [2, 4]);
  assert.equal(extractSlice(vol, dims, "coronal", 0)[0], 301);
});

test("sagittal: anterior on viewer left, superior on top", () => {
  assert.deepEqual(planeSize(dims, "sagittal"), [3, 4]);
  assert.equal(extractSlice(vol, dims, "sagittal", 0)[0], 320);
});

test("sliceCount per plane", () => {
  assert.equal(sliceCount(dims, "axial"), 4);
  assert.equal(sliceCount(dims, "coronal"), 3);
  assert.equal(sliceCount(dims, "sagittal"), 2);
});

test("pixelAspect uses in-plane spacing", () => {
  assert.deepEqual(pixelAspect([0.8, 0.8, 2], "coronal"), [0.8, 2]);
  assert.deepEqual(pixelAspect([0.7, 0.9, 2], "sagittal"), [0.9, 2]);
});

test("windowToGray maps window linearly and clamps", () => {
  const out = new Uint8ClampedArray(4 * 4);
  windowToGray(new Int16Array([-160, 40, 240, -1000]), 40, 400, out);
  assert.equal(out[0], 0);
  assert.ok(Math.abs(out[4] - 128) <= 1);
  assert.equal(out[8], 255);
  assert.equal(out[12], 0);
  assert.equal(out[3], 255);
});

test("decodeMaybeGzip inflates gzip and passes plain bytes through", async () => {
  const plain = new Uint8Array([1, 2, 3, 250]);
  const gz = gzipSync(plain);
  const inflated = new Uint8Array(await decodeMaybeGzip(gz.buffer.slice(gz.byteOffset, gz.byteOffset + gz.length)));
  assert.deepEqual([...inflated], [...plain]);
  const passed = new Uint8Array(await decodeMaybeGzip(plain.buffer.slice(0)));
  assert.deepEqual([...passed], [...plain]);
});
