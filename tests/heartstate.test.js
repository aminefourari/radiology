import { test } from "node:test";
import assert from "node:assert/strict";
import { clockLabel, closeupWindow, DEFAULTS, filterRhythms, formatHash, parseHash } from "../site/js/heartstate.js";

const KEYS = ["nsr", "rbbb", "afib", "lafb"];

test("parseHash: defaults for unknown or bad values; old what-if keys ignored", () => {
  const s = parseHash("#rhythm=foo&mode=bar&t=-5&speed=3&cutLbb=1&whatif=1&leads=I,XX,V6", KEYS);
  assert.deepEqual(s, DEFAULTS);
  assert.equal(parseHash("#t=Infinity", KEYS).t, 0);
});

test("formatHash round-trips and omits defaults", () => {
  assert.equal(formatHash(DEFAULTS), "");
  const st = { ...DEFAULTS, rhythm: "lafb", compare: "nsr", mode: "12", ladder: false, heart: "torso", section: "sax", level: 0.3,
    colour: "time", conduction: false, vector: false, speed: 1, t: 463.4, leads: ["II", "aVL", "V2"], split: 0.25 };
  assert.deepEqual(parseHash(formatHash(st), KEYS), { ...st, t: 463 });
});

const list = [
  { key: "lafb", title: { en: "Left anterior fascicular block", fr: "Bloc fasciculaire antérieur gauche" } },
  { key: "nsr", title: { en: "Normal sinus rhythm", fr: "Rythme sinusal normal" } },
  { key: "pac", title: { en: "Premature atrial complex", fr: "Extrasystole auriculaire" } },
];
test("filterRhythms: key, English or page language, case and accents ignored, every word must match", () => {
  assert.deepEqual(filterRhythms(list, "lafb", "fr").map((r) => r.key), ["lafb"]);
  assert.deepEqual(filterRhythms(list, "Fascicular", "fr").map((r) => r.key), ["lafb"]);
  assert.deepEqual(filterRhythms(list, "anterieur", "fr").map((r) => r.key), ["lafb"]);
  assert.deepEqual(filterRhythms(list, "sinus normal", "en").map((r) => r.key), ["nsr"]);
  assert.deepEqual(filterRhythms(list, "zzz", "en"), []);
  assert.equal(filterRhythms(list, "  ", "en").length, 3);
});

test("clockLabel: time since the latest impulse origin; null in AF/VF", () => {
  const sim = { events: [{ type: "fire", t0: 20, t1: 20, origin: "sinus" }, { type: "P", t0: 25, t1: 100 }, { type: "fire", t0: 820, t1: 820, origin: "sinus" }] };
  assert.deepEqual(clockLabel(sim, 483), { ms: 463, origin: "sinus" });
  assert.deepEqual(clockLabel(sim, 900), { ms: 80, origin: "sinus" });
  assert.equal(clockLabel(sim, 10), null);
  assert.equal(clockLabel({ ...sim, vf: true }, 483), null);
});

test("closeupWindow pages through the strip", () => {
  assert.deepEqual(closeupWindow(100, 8000), [0, 1200]);
  assert.deepEqual(closeupWindow(1300, 8000), [1200, 2400]);
  assert.deepEqual(closeupWindow(7999, 8000), [6800, 8000]);
});
