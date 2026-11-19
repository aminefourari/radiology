import { test } from "node:test";
import assert from "node:assert/strict";
import { clampState, formatHash, parseHash, SYSTEMS } from "../site/js/state.js";

const ctx = { cases: ["s1"], langs: ["en"], dims: [10, 10, 10] };

test("bad share link clamps to a valid view", () => {
  const s = clampState(parseHash("#case=zzz&plane=foo&slice=9999&zoom=-3&lang=xx&sys=organs,bogus"), ctx);
  assert.deepEqual(s, { case: "s1", lang: null, plane: "axial", slice: 9, sys: ["organs"], zoom: 0.25 });
});

test("missing slice defaults to the middle", () => {
  assert.equal(clampState(parseHash(""), ctx).slice, 5);
});

test("garbage hash does not throw", () => {
  assert.doesNotThrow(() => clampState(parseHash("%%%"), ctx));
});

test("format/parse round-trips", () => {
  const s = { case: "s1", lang: "ar", plane: "coronal", slice: 3, sys: ["organs", "segments"], zoom: 2 };
  assert.deepEqual(parseHash(formatHash(s)), s);
});

test("empty sys list survives a round-trip", () => {
  const s = clampState(parseHash(formatHash({ case: "s1", lang: "en", plane: "axial", slice: 1, sys: [], zoom: 1 })), ctx);
  assert.deepEqual(s.sys, []);
});

test("systems are in the launch order", () => {
  assert.deepEqual(SYSTEMS, ["organs", "segments", "digestive", "urinary", "pelvis", "spine", "arteries", "veins"]);
});
