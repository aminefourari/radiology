import { test } from "node:test";
import assert from "node:assert/strict";
import { NORMAL, STEPS, diagnosisChoices, formatMeasure, isNormal, nextRandom, rng, score } from "../site/js/ecglearn.js";

test("STEPS cover the seven reading steps in order with the pipeline's answer values", () => {
  assert.deepEqual(STEPS.map((s) => s.key), ["rate", "rhythm", "axis", "pr", "qrs", "qt", "st"]);
  assert.deepEqual(STEPS.find((s) => s.key === "pr").choices, ["short", "normal", "long", "none"]);
  assert.deepEqual(STEPS.map((s) => s.measure), ["hr", null, "axis", "pr", "qrs", "qtc", null]);
});

test("isNormal: every NORMAL answer is normal, an abnormal one is not", () => {
  for (const [k, v] of Object.entries(NORMAL)) assert.equal(isNormal(k, v), true, k);
  assert.equal(isNormal("pr", "long"), false);
});

test("formatMeasure: missing → dash, axis signed with a real minus", () => {
  assert.equal(formatMeasure(null, "ms"), "—");
  assert.equal(formatMeasure(6, "°"), "+6°");
  assert.equal(formatMeasure(-29, "°"), "−29°");
  assert.equal(formatMeasure(226, "ms"), "226 ms");
});

test("nextRandom visits every id before repeating and never repeats across a reset", () => {
  const rand = rng(42), ids = ["a", "b", "c"];
  let seen = [], got = [];
  for (let i = 0; i < 3; i++) ({ seen } = nextRandom(ids, seen, rand)), got.push(seen.at(-1));
  assert.deepEqual([...got].sort(), ids);
  const after = nextRandom(ids, seen, rand);
  assert.notEqual(after.id, got.at(-1));
  assert.deepEqual(after.seen, [after.id]);
});

const LIST = [
  { id: "n", group: "normal" }, { id: "r1", group: "rhythm" }, { id: "r2", group: "rhythm" },
  { id: "r3", group: "rhythm" }, { id: "c1", group: "conduction" }, { id: "i1", group: "ischaemia" },
];

test("diagnosisChoices: lone-group id gets 3 distractors from other groups", () => {
  const ch = diagnosisChoices(LIST, "n", rng(1));
  assert.equal(ch.length, 4);
  assert.equal(new Set(ch).size, 4);
  assert.ok(ch.includes("n"));
  assert.ok(ch.filter((x) => x !== "n").every((x) => x !== "n"));
});

test("diagnosisChoices: includes a same-group distractor when one exists", () => {
  for (let seed = 1; seed < 20; seed++) {
    const ch = diagnosisChoices(LIST, "r1", rng(seed));
    assert.equal(new Set(ch).size, 4);
    assert.ok(ch.includes("r1"));
    assert.ok(ch.some((x) => x === "r2" || x === "r3"), `seed ${seed}`);
  }
});

test("score counts seven steps plus the diagnosis", () => {
  const answers = { ...NORMAL, pr: "long" };
  assert.deepEqual(score(answers, { ...NORMAL, pr: "long", dx: "x" }, "x"), { correct: 8, total: 8 });
  assert.deepEqual(score(answers, { ...NORMAL, dx: "y" }, "x"), { correct: 6, total: 8 });
});

test("makeStore falls back to memory when storage throws", async () => {
  const { makeStore } = await import("../site/js/ecglearn.js");
  const s = makeStore(() => { throw new Error("blocked"); });
  assert.deepEqual(s.get("seen", []), []);
  s.set("seen", ["a"]);
  assert.deepEqual(s.get("seen", []), ["a"]);
});

test("makeStore uses real storage when it works", async () => {
  const { makeStore } = await import("../site/js/ecglearn.js");
  const m = new Map(), storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  makeStore(() => storage).set("t", { done: 1 });
  assert.deepEqual(makeStore(() => storage).get("t", null), { done: 1 });
});

test("ltr wraps text in LTR isolates so signed numbers survive RTL", async () => {
  const { ltr } = await import("../site/js/ecglearn.js");
  assert.equal(ltr("−30…+90"), "⁦−30…+90⁩");
});
