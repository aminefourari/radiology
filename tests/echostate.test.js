import { test } from "node:test";
import assert from "node:assert/strict";
import { ECHO_DEFAULTS, clampEchoState, formatEchoHash, parseEchoHash } from "../site/js/echostate.js";

const windows = [
  { key: "ruq", target: { zMm: 300, theta: -95, rock: 0, fan: 0, rot: 0 } },
  { key: "pelvic-trans", target: { zMm: 40, theta: 0, rock: 0, fan: -20, rot: 90 } },
];
const ctx = { windows, outline: { zMin: 10, zMax: 500 }, langs: ["en", "ar"] };

test("round trip of a full state", () => {
  const s = { win: "pelvic-trans", pose: { zMm: 41.5, theta: 12, rock: -5, fan: 20, rot: 90 }, depth: 180, gain: -3,
    fluid: [0, 1, 0, 2], labels: false, lang: "ar" };
  const h = formatEchoHash(s);
  assert.match(h, /^#/);
  assert.deepEqual(clampEchoState(parseEchoHash(h), ctx), s);
});

test("defaults: no hash gives the first window at its target pose", () => {
  const s = clampEchoState(parseEchoHash(""), ctx);
  assert.equal(s.win, "ruq");
  assert.deepEqual(s.pose, windows[0].target);
  assert.equal(s.depth, ECHO_DEFAULTS.depth);
  assert.deepEqual(s.fluid, [0, 0, 0, 0]);
  assert.equal(s.labels, true);
  assert.equal(s.lang, null);
});

test("missing pose falls back to the chosen window's target", () => {
  assert.deepEqual(clampEchoState(parseEchoHash("#w=pelvic-trans"), ctx).pose, windows[1].target);
});

test("garbage hash clamps without throwing", () => {
  const s = clampEchoState(parseEchoHash("#w=nope&p=a,b,,9e99&d=-5&g=99&f=9x&l=maybe&lang=xx"), ctx);
  assert.equal(s.win, "ruq");
  assert.ok(Object.values(s.pose).every(Number.isFinite));
  assert.equal(s.depth, 80);
  assert.equal(s.gain, 20);
  assert.deepEqual(s.fluid, [2, 0, 0, 0]);
  assert.equal(s.lang, null);
  assert.doesNotThrow(() => parseEchoHash("#%E0%A4%A"));
});

test("angles are clamped and wrapped", () => {
  const { pose } = clampEchoState(parseEchoHash("#p=9999,270,-90,95,-30"), ctx);
  assert.deepEqual(pose, { zMm: 500, theta: -90, rock: -60, fan: 80, rot: 330 });
});
