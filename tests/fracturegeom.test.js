import test from "node:test";
import assert from "node:assert/strict";
import { applyMatrix, fragmentCaps, fragmentOf, moveMatrix, sectionLoops, sectionShapes, splitMesh } from "../site/js/fracturegeom.js";

// Unit cube [0,1]^3, outward-facing triangles.
const pos = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1];
const idx = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
const half = { cuts: [{ p: [0.25, 0, 0], n: [1, 0, 0] }] };

const area = (soup) => {
  let a = 0;
  for (let i = 0; i < soup.length; i += 9) {
    const u = [soup[i + 3] - soup[i], soup[i + 4] - soup[i + 1], soup[i + 5] - soup[i + 2]];
    const v = [soup[i + 6] - soup[i], soup[i + 7] - soup[i + 1], soup[i + 8] - soup[i + 2]];
    a += Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
  }
  return a;
};
const area2 = (poly) => Math.abs(poly.reduce((s, p, i) => { const q = poly[(i + 1) % poly.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≈ ${b}`);

test("fragmentOf picks the first containing fragment, else the intact bone", () => {
  assert.equal(fragmentOf([0.5, 0.5, 0.5], [half]), 0);
  assert.equal(fragmentOf([0.1, 0.5, 0.5], [half]), -1);
});

test("splitMesh clips triangles exactly at the cut and keeps all the surface", () => {
  const [rest, frag] = splitMesh(pos, idx, [half]);
  near(area(rest.pos) + area(frag.pos), 6);
  near(area(rest.pos), 1 + 4 * 0.25); // x = 0 face + the four side strips 0.25 wide
  for (let i = 0; i < frag.pos.length; i += 3) assert.ok(frag.pos[i] >= 0.25 - 1e-9);
});

test("sectionLoops returns the square outline of a mid-height cut", () => {
  const loops = sectionLoops(pos, idx, [0, 0, 1, -0.5]);
  assert.equal(loops.length, 1);
  for (const p of loops[0]) near(p[2], 0.5);
  near(area2(loops[0].map((p) => [p[0], p[1]])), 1);
});

test("fragmentCaps fills the cut face", () => {
  const caps = fragmentCaps(pos, idx, half);
  assert.equal(caps.length, 1);
  near(area2(caps[0].poly.map((p) => [p[1], p[2]])), 1);
});

test("moveMatrix rotates about the pivot, then translates, scaled by t", () => {
  const m = moveMatrix({ axis: [0, 0, 1], deg: 90, pivot: [1, 0, 0], t: [0, 0, 2] });
  applyMatrix(m, [2, 0, 0]).forEach((v, i) => near(v, [1, 1, 2][i]));
  applyMatrix(moveMatrix({ t: [4, 0, 0] }, 0.5), [0, 0, 0]).forEach((v, i) => near(v, [2, 0, 0][i]));
});

test("sectionShapes splits the section between intact bone and the displaced fragment", () => {
  const view = { p: [0, 0, 0.5], n: [0, 0, 1], up: [0, 1, 0] };
  const moved = [{ ...half, move: { t: [1, 0, 0] } }];
  const shapes = sectionShapes(pos, idx, moved, view, 1);
  const rest = shapes.filter((s) => s.frag === -1), frag = shapes.filter((s) => s.frag === 0);
  near(rest.reduce((a, s) => a + area2(s.poly), 0), 0.25);
  near(frag.reduce((a, s) => a + area2(s.poly), 0), 0.75);
  assert.ok(Math.min(...frag[0].poly.map((p) => Math.abs(p[0]))) >= 0.25 + 1 - 1e-9 || Math.max(...frag[0].poly.map((p) => p[0])) <= -1.25 + 1e-9);
});

test("typeFragments resolves named cuts and flips '-' ones", async () => {
  const { typeFragments } = await import("../site/js/fracturegeom.js");
  const shape = { cuts: { A: { p: [0, 0, 0], n: [1, 0, 0] } }, types: { X: { fragments: [{ cuts: ["-A"], name: "m" }] } } };
  assert.equal(typeFragments(shape, "X")[0].cuts[0].n[0], -1);
  assert.deepEqual(typeFragments(shape, "none"), []);
});
