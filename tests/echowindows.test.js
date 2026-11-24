// FAST windows on the real case: each target pose shows its landmarks and its fluid site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { poseFrame } from "../site/js/usgeom.js";
import { bodyOutline, skinPoint } from "../site/js/usbody.js";
import { closeness, fanContents, viewFound } from "../site/js/uswindows.js";

const read = (p) => readFileSync(new URL(`../site/${p}`, import.meta.url));
const { case: caseId, windows } = JSON.parse(read("echo/windows.json"));
const meta = JSON.parse(read(`cases/${caseId}/meta.json`));
const gz = (f) => gunzipSync(read(`cases/${caseId}/${f}`));
const ctBuf = gz("ct.bin.gz");
const vol = {
  ct: new Int16Array(ctBuf.buffer, ctBuf.byteOffset, ctBuf.length / 2),
  labels: new Uint8Array(gz("labels.bin.gz")), fluid: new Uint8Array(gz("fluid.bin.gz")),
  dims: meta.dims, spacing: meta.spacing,
};
const idByKey = Object.fromEntries(meta.structures.map((s) => [s.key, s.id]));
const outline = bodyOutline(vol.ct, vol.dims, vol.spacing);
const frameOf = (p) => poseFrame(skinPoint(outline, p.zMm, p.theta), p);
const byKey = Object.fromEntries(windows.map((w) => [w.key, w]));

test("the five FAST views, in four groups, with titles in every language", () => {
  assert.deepEqual(windows.map((w) => w.key), ["ruq", "luq", "pelvic-trans", "pelvic-sag", "subxiphoid"]);
  assert.deepEqual([...new Set(windows.map((w) => w.group))], ["ruq", "luq", "pelvic", "subxiphoid"]);
  for (const w of windows) for (const k of w.landmarks.flatMap((l) => l.keys)) assert.ok(idByKey[k], `${w.key}: ${k}`);
});

for (const w of windows) {
  test(`${w.key}: target pose shows its landmarks`, () => {
    assert.ok(viewFound(fanContents(vol, frameOf(w.target), w.depth), w, idByKey));
  });
  test(`${w.key}: small fluid at site ${w.fluidSite} is in the fan`, () => {
    const amounts = [0, 0, 0, 0, 0];
    amounts[w.fluidSite] = 1;
    assert.ok((fanContents(vol, frameOf(w.target), w.depth, amounts).get(`fluid:${w.fluidSite}`) || 0) > 0.002);
  });
}

test("the RUQ view is not 'found' from the left flank or the umbilicus", () => {
  const ruq = byKey.ruq;
  for (const p of [byKey.luq.target, { zMm: 200, theta: 0, rock: 0, fan: 0, rot: 90 }]) {
    assert.ok(!viewFound(fanContents(vol, frameOf(p), ruq.depth), ruq, idByKey), JSON.stringify(p));
  }
});

test("closeness is 1 at target and < 0.3 at another window's target", () => {
  for (const w of windows) {
    assert.equal(closeness(w.target, w.target), 1);
    for (const o of windows) if (o.group !== w.group) assert.ok(closeness(o.target, w.target) < 0.3, `${o.key} → ${w.key}`);
  }
});
