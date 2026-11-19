import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeMeshes, meshVisibility } from "../site/js/meshdata.js";

const structures = [
  { id: 1, system: "organs", color: "#aa0000", parent: null },
  { id: 7, system: "segments", color: "#00aa00", parent: 1 },
  { id: 8, system: "segments", color: "#0000aa", parent: 1 },
  { id: 2, system: "organs", color: "#cccc00", parent: null },
];
const meshIds = new Set([1, 2, 7, 8]);
const none = new Set();
const vis = (sys, { hidden = none, faded = none, isolated = 0 } = {}) =>
  meshVisibility(structures, new Set(sys), hidden, faded, isolated, meshIds);
const keys = (m) => [...m.keys()].sort((a, b) => a - b);

test("parent shows as one union mesh when only its system is on", () => {
  const m = vis(["organs"]);
  assert.deepEqual(keys(m), [1, 2]);
  assert.deepEqual(m.get(1), { color: "#aa0000", opacity: 1 });
});

test("children replace the parent when their system is on", () => {
  assert.deepEqual(keys(vis(["organs", "segments"])), [2, 7, 8]);
  assert.deepEqual(keys(vis(["segments"])), [7, 8]);
  assert.equal(vis(["segments"]).get(7).color, "#00aa00");
});

test("nothing on shows nothing", () => {
  assert.equal(vis([]).size, 0);
});

test("hidden ids are omitted and faded ids are see-through", () => {
  assert.deepEqual(keys(vis(["organs"], { hidden: new Set([2]) })), [1]);
  assert.equal(vis(["organs"], { faded: new Set([1]) }).get(1).opacity, 0.15);
});

test("isolate keeps only that structure, and only if it is otherwise visible", () => {
  assert.deepEqual(keys(vis(["organs"], { isolated: 2 })), [2]);
  assert.equal(vis([], { isolated: 2 }).size, 0);
});

test("structures without a mesh are skipped", () => {
  const m = meshVisibility(structures, new Set(["organs"]), none, none, 0, new Set([2]));
  assert.deepEqual(keys(m), [2]);
});

test("decodeMeshes dequantises positions over the box", () => {
  const buf = new ArrayBuffer(2 * 6 + 3 * 2 + 2); // 2 verts, 3 indices, 2 bytes slack
  const u16 = new Uint16Array(buf, 0, 9);
  u16.set([0, 0, 0, 65535, 65535, 65535, 0, 1, 1]);
  const index = { box: [0, 0, 0, 10, 10, 10], meshes: [{ id: 5, offset: 0, vertexCount: 2, indexCount: 3, anchor: [1, 2, 3], size: 9 }] };
  const m = decodeMeshes(buf, index).get(5);
  assert.deepEqual([...m.positions], [0, 0, 0, 10, 10, 10]);
  assert.deepEqual([...m.indices], [0, 1, 1]);
  assert.deepEqual(m.anchor, [1, 2, 3]);
  assert.equal(m.size, 9);
});
