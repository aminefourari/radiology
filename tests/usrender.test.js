import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { poseFrame } from "../site/js/usgeom.js";
import { FAN, depthTicks, fanRay, labelMeanHU, makeTissueLUT, renderFan, scanConvert, scanMap, speckle } from "../site/js/usrender.js";

const tissues = JSON.parse(readFileSync(new URL("../site/echo/tissues.json", import.meta.url)));
const structures = [{ id: 1, key: "liver" }, { id: 2, key: "rib_right_5" }, { id: 3, key: "kidney_right" }];
const { lut, parenchyma } = makeTissueLUT(tissues, structures);

// 201 × 121 × 81 mm box of liver (1 mm voxels); probe on the anterior face (y = 120) pointing down −y.
const dims = [201, 121, 81], spacing = [1, 1, 1];
function box(label = 1) {
  const n = dims[0] * dims[1] * dims[2];
  return { ct: new Int16Array(n).fill(40), labels: new Uint8Array(n).fill(label), fluid: new Uint8Array(n), dims, spacing };
}
function fill(arr, [x0, x1], [y0, y1], [z0, z1], v) {
  for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) arr[z * dims[0] * dims[1] + y * dims[0] + x] = v;
}
const frame = poseFrame({ p: [100, 120, 40], n: [0, -1, 0] }, { rock: 0, fan: 0, rot: 0 });
const opts = (o = {}) => ({ depthMm: 120, gainDb: 0, amounts: [0, 0, 0, 0, 0], lut, parenchyma, tissues, ...o });
const render = (vol, o) => renderFan(vol, frame, opts(o), new Uint8Array(FAN.lines * FAN.samples));
const CENTER = FAN.lines / 2, EDGE = 40;
function mean(out, line, d0, d1, depth = 120) {
  let s = 0, n = 0;
  for (let k = 0; k < FAN.samples; k++) {
    const d = ((k + 0.5) * depth) / FAN.samples;
    if (d >= d0 && d < d1) { s += out[line * FAN.samples + k]; n++; }
  }
  return s / n;
}
function peak(out, line, d0, d1, depth = 120) {
  let m = 0;
  for (let k = 0; k < FAN.samples; k++) {
    const d = ((k + 0.5) * depth) / FAN.samples;
    if (d >= d0 && d < d1) m = Math.max(m, out[line * FAN.samples + k]);
  }
  return m;
}

test("a bone block shadows everything below it", () => {
  const v = box();
  fill(v.ct, [0, 201], [80, 86], [30, 51], 700); // the fan spreads along z (marker = +z)
  fill(v.labels, [0, 201], [80, 86], [30, 51], 0);
  const out = render(v);
  assert.ok(mean(out, CENTER, 50, 80) < 0.1 * mean(out, EDGE, 50, 80));
  assert.ok(peak(out, CENTER, 33, 37) > 220, "bright bone surface");
});

test("a fluid block is near-black and the tissue behind it is brighter", () => {
  const v = box();
  fill(v.fluid, [0, 201], [60, 101], [30, 51], 1 * 4 + 1);
  const out = render(v, { amounts: [0, 1, 0, 0, 0] });
  assert.ok(mean(out, CENTER, 25, 55) < 40);
  assert.ok(mean(out, CENTER, 70, 90) > 1.3 * mean(out, EDGE, 70, 90));
});

test("fluid shows only when level <= amount for its site", () => {
  const v = box();
  fill(v.fluid, [0, 201], [60, 101], [30, 51], 1 * 4 + 2);
  assert.ok(mean(render(v, { amounts: [0, 1, 0, 0, 0] }), CENTER, 25, 55) > 100);
  assert.ok(mean(render(v, { amounts: [0, 2, 0, 0, 0] }), CENTER, 25, 55) < 40);
  assert.ok(mean(render(v, { amounts: [0, 0, 2, 0, 0] }), CENTER, 25, 55) > 100, "other site's amount doesn't apply");
});

test("TGC flattens tissue that attenuates like soft tissue; stiffer tissue still fades", () => {
  const a = render(box());
  assert.ok(Math.abs(mean(a, CENTER, 10, 30) - mean(a, CENTER, 80, 100)) < 20);
  const b = render(box(0)); // unlabelled soft tissue, a = 0.9
  assert.ok(mean(b, CENTER, 80, 100) < mean(b, CENTER, 10, 30) - 15);
});

test("a gas pocket gives a bright line, a shadow, then reverberation bands", () => {
  const v = box();
  fill(v.ct, [70, 131], [88, 90], [0, 81], -1000); // depth 30–32 mm
  const out = render(v);
  assert.ok(peak(out, CENTER, 29, 33) > 240, "bright gas surface");
  assert.ok(peak(out, CENTER, 59, 65) > mean(out, CENTER, 45, 55) + 60, "first reverberation");
  assert.ok(peak(out, CENTER, 89, 95) > mean(out, CENTER, 75, 85) + 40, "second reverberation");
});

test("a thin layer of air at the skin is treated as gel, not gas", () => {
  const v = box();
  fill(v.ct, [0, 201], [119, 121], [0, 81], -1000);
  assert.ok(mean(render(v), CENTER, 20, 60) > 100);
});

test("outside the volume is black, not gas", () => {
  const out = render(box(), { depthMm: 240 });
  assert.equal(mean(out, CENTER, 130, 230, 240), 0);
});

test("speckle is fixed to the body: same value inside a 0.4 mm cell, Rayleigh mean", () => {
  assert.equal(speckle(1.01, 2, 3), speckle(1.05, 2, 3));
  let s = 0, diff = 0;
  for (let i = 0; i < 20000; i++) {
    const v = speckle(i * 0.4 + 0.1, 7.3, 2.2);
    s += v;
    if (v !== speckle((i + 1) * 0.4 + 0.1, 7.3, 2.2)) diff++;
  }
  assert.ok(Math.abs(s / 20000 - Math.sqrt(Math.PI / 2)) < 0.05, `${s / 20000}`);
  assert.ok(diff > 19000);
});

test("line 0 is on the marker side and maps to the image left", () => {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  assert.ok(dot(fanRay(frame, 0).dir, frame.m) > 0.4);
  assert.ok(dot(fanRay(frame, FAN.lines - 1).dir, frame.m) < -0.4);
  const W = 200, H = 160, map = scanMap(120, W, H);
  const at = (x, y) => map.line[y * W + x];
  assert.ok(at(60, 100) >= 0 && at(60, 100) < FAN.lines / 2);
  assert.ok(at(140, 100) > FAN.lines / 2);
  assert.equal(at(0, 0), -1, "corner outside the fan");
  const rgba = new Uint8ClampedArray(W * H * 4);
  scanConvert(new Uint8Array(FAN.lines * FAN.samples).fill(200), map, rgba);
  assert.equal(rgba[(100 * W + 100) * 4], 200);
  assert.equal(rgba[3], 255);
});

test("labelsOut receives the structure at each sample, 0 outside the volume", () => {
  const labs = new Uint8Array(FAN.lines * FAN.samples);
  renderFan(box(), frame, opts({ depthMm: 240 }), new Uint8Array(FAN.lines * FAN.samples), labs);
  assert.equal(labs[CENTER * FAN.samples + 10], 1);
  assert.equal(labs[CENTER * FAN.samples + FAN.samples - 1], 0);
});

test("lateral resolution: speckle correlates between neighbouring lines, not distant ones", () => {
  const out = render(box());
  const corr = (a, b) => {
    const xs = [], ys = [];
    for (let k = 40; k < 300; k++) { xs.push(out[a * FAN.samples + k]); ys.push(out[b * FAN.samples + k]); }
    const m = (v) => v.reduce((s, x) => s + x, 0) / v.length, mx = m(xs), my = m(ys);
    let sxy = 0, sxx = 0, syy = 0;
    xs.forEach((x, i) => { sxy += (x - mx) * (ys[i] - my); sxx += (x - mx) ** 2; syy += (ys[i] - my) ** 2; });
    return sxy / Math.sqrt(sxx * syy);
  };
  assert.ok(corr(CENTER, CENTER + 1) > 0.4, `${corr(CENTER, CENTER + 1)}`);
  assert.ok(Math.abs(corr(CENTER, CENTER + 12)) < 0.2, `${corr(CENTER, CENTER + 12)}`);
});

test("air between the curved probe face and the skin is gel: edge lines still image the tissue", () => {
  // Same tissue box, but with 20 mm of air above the skin inside the grid (as on a real body).
  const D = [201, 141, 81], n = D[0] * D[1] * D[2];
  const v = { ct: new Int16Array(n).fill(40), labels: new Uint8Array(n).fill(1), fluid: new Uint8Array(n), dims: D, spacing };
  for (let z = 0; z < D[2]; z++) for (let y = 121; y < D[1]; y++) for (let x = 0; x < D[0]; x++) v.ct[z * D[0] * D[1] + y * D[0] + x] = -1000;
  const out = renderFan(v, frame, opts(), new Uint8Array(FAN.lines * FAN.samples));
  // line 0 leans 30° toward +z, so it leaves the 81 mm box past ~30 mm: look at 12–25 mm
  assert.ok(mean(out, 0, 12, 25) > 100, `edge line ${mean(out, 0, 12, 25)}`);
  assert.ok(mean(out, 0, 12, 25) > 0.7 * mean(out, CENTER, 12, 25));
});

test("depthTicks places each cm tick at its depth for any depth setting", () => {
  for (const depth of [80, 160, 240]) {
    const map = scanMap(depth, 640, 440), ticks = depthTicks(depth, 640, 440);
    assert.equal(ticks.length, Math.floor(depth / 20));
    for (const { cm, frac } of ticks) {
      assert.ok(Math.abs(frac * 440 - (FAN.radiusMm + cm * 10 - map.topMm) / map.mmPerPx) < 1e-6);
      assert.ok(frac > 0 && frac <= 1.0001, `${depth}: ${cm} cm at ${frac}`);
    }
  }
});


// ---- realism: scatterer speckle, beam point-spread, vessels and fat inside organs from the CT ----

const huRef = (v) => labelMeanHU(v.ct, v.labels);

test("labelMeanHU is the mean HU of each label", () => {
  const v = box();
  fill(v.labels, [0, 201], [0, 60], [0, 81], 3);
  fill(v.ct, [0, 201], [0, 60], [0, 81], 100);
  const m = labelMeanHU(v.ct, v.labels);
  assert.equal(m[1], 40);
  assert.equal(m[3], 100);
});

test("a contrast-filled vessel inside an organ renders black", () => {
  const v = box();
  fill(v.ct, [0, 201], [70, 80], [36, 45], 170); // 10 mm tube running along x, under the centre line
  const out = render(v, { huRef: huRef(v) });
  assert.ok(mean(out, CENTER, 42, 48) < 0.35 * mean(out, CENTER, 20, 35), `${mean(out, CENTER, 42, 48)} vs ${mean(out, CENTER, 20, 35)}`);
});

test("fat inside an organ (renal sinus) renders brighter than the organ", () => {
  const v = box(3);
  fill(v.ct, [0, 201], [70, 80], [30, 51], -90);
  const out = render(v, { huRef: huRef(v) });
  assert.ok(mean(out, CENTER, 42, 48) > mean(out, CENTER, 20, 35) + 15);
});

function stats(out, lines, d0, d1) {
  const v = [];
  for (const i of lines) for (let k = 0; k < FAN.samples; k++) {
    const d = ((k + 0.5) * 120) / FAN.samples;
    if (d >= d0 && d < d1) v.push(out[i * FAN.samples + k]);
  }
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return { m, sd: Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) };
}

test("speckle has a real scanner's spread: below raw Rayleigh (5.6 dB) after speckle reduction, but not smoothed flat", () => {
  const out = render(box());
  const { sd } = stats(out, [80, 90, 100, 110], 30, 60);
  const sdDb = (sd / 255) * 60; // DR = 60 dB
  assert.ok(sdDb > 2.5 && sdDb < 5.6, `${sdDb.toFixed(2)} dB`);
});

test("speckle grains are wider across the beam than along it", () => {
  const out = render(box());
  const corr = (di, dk) => {
    let sxy = 0, sxx = 0, syy = 0;
    const { m } = stats(out, [80, 90, 100], 40, 70);
    for (let i = 80; i < 110; i++) for (let k = 130; k < 220; k++) {
      const a = out[i * FAN.samples + k] - m, b = out[(i + di) * FAN.samples + k + dk] - m;
      sxy += a * b; sxx += a * a; syy += b * b;
    }
    return sxy / Math.sqrt(sxx * syy);
  };
  // at ~55 mm one line is ~0.6 mm apart and one sample 0.31 mm: compare equal distances (~0.6 mm)
  assert.ok(corr(1, 0) > corr(0, 2) + 0.1, `lateral ${corr(1, 0).toFixed(2)} axial ${corr(0, 2).toFixed(2)}`);
});

test("fat deep in the body is brighter than fat just under the skin", () => {
  const v = box(0);
  fill(v.ct, [0, 201], [0, 121], [0, 81], -90);
  const out = render(v);
  assert.ok(mean(out, CENTER, 50, 70) > mean(out, CENTER, 8, 20) + 10, `${mean(out, CENTER, 50, 70)} vs ${mean(out, CENTER, 8, 20)}`);
});

test("deep gas: reverberations and dirty shadow stay dimmer than the gas line", () => {
  const v = box();
  fill(v.ct, [70, 131], [28, 30], [0, 81], -1000); // gas at ~91 mm
  fill(v.labels, [70, 131], [28, 30], [0, 81], 0);
  const out = render(v);
  assert.ok(peak(out, CENTER, 89, 94) > 200, "gas line");
  assert.ok(mean(out, CENTER, 96, 118) < 0.6 * peak(out, CENTER, 89, 94), `${mean(out, CENTER, 96, 118)}`);
});
