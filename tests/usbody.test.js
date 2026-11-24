import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyOutline, frontSilhouette, skinPoint } from "../site/js/usbody.js";

// Elliptical cylinder, semi-axes 150 mm (x) by 100 mm (y), centred at (170, 120) mm; slices 1–4 only.
const dims = [171, 121, 6], spacing = [2, 2, 5];
const ct = new Int16Array(dims[0] * dims[1] * dims[2]).fill(-1000);
for (let z = 1; z <= 4; z++) for (let y = 0; y < dims[1]; y++) for (let x = 0; x < dims[0]; x++) {
  const u = (x * 2 - 170) / 150, v = (y * 2 - 120) / 100;
  if (u * u + v * v <= 1) ct[z * dims[0] * dims[1] + y * dims[0] + x] = 40;
}
const outline = bodyOutline(ct, dims, spacing);

test("z range covers only slices with a body", () => {
  assert.equal(outline.zMin, 5);
  assert.equal(outline.zMax, 20);
});

test("radius matches the ellipse within one voxel at θ = 0, ±90, 180", () => {
  for (const [theta, r] of [[0, 100], [90, 150], [-90, 150], [180, 100]]) {
    const { p } = skinPoint(outline, 10, theta);
    const got = Math.hypot(p[0] - 170, p[1] - 120);
    assert.ok(Math.abs(got - r) <= 2.5, `θ ${theta}: ${got} vs ${r}`);
  }
});

test("theta +90 is the patient's left (larger x), 0 is anterior (larger y)", () => {
  assert.ok(skinPoint(outline, 10, 90).p[0] > 300);
  assert.ok(skinPoint(outline, 10, -90).p[0] < 40);
  assert.ok(skinPoint(outline, 10, 0).p[1] > 210);
});

test("inward normal at the anterior midline is [0,-1,0]; at the left flank [-1,0,0]", () => {
  const a = skinPoint(outline, 10, 0).n, l = skinPoint(outline, 10, 90).n;
  assert.ok(a[1] < -0.99 && Math.abs(a[2]) < 0.05, `${a}`);
  assert.ok(l[0] < -0.99, `${l}`);
  assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-9);
});

test("skinPoint clamps a zMm above or below the body and never returns NaN", () => {
  for (const z of [-100, 0, 1000, NaN]) {
    const s = skinPoint(outline, z, 45);
    assert.ok(s.zMm >= 5 && s.zMm <= 20, `${s.zMm}`);
    assert.ok([...s.p, ...s.n].every(Number.isFinite));
  }
});

test("front silhouette gives the body's x extent per slice", () => {
  const f = frontSilhouette(outline);
  assert.ok(Math.abs(f.left[2] - 320) <= 2.5 && Math.abs(f.right[2] - 20) <= 2.5, `${f.left[2]} ${f.right[2]}`);
  assert.equal(f.left[0], 0);
});
