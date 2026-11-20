import { test } from "node:test";
import assert from "node:assert/strict";
import { ladderLines } from "../site/js/ladder.js";

const P = (t, origin = "sinus") => ({ type: "P", t0: t, t1: t + 100, origin });
const AV = (t0, t1) => ({ type: "AV", t0, t1 });
const Q = (t, origin = "conducted") => ({ type: "QRS", t0: t, t1: t + 90, origin });

test("a conducted sinus beat: one line per tier, the AV line slanting from row 1 to row 2", () => {
  const lines = ladderLines([P(0), AV(60, 150), Q(165)]);
  assert.deepEqual(lines.map((l) => l.row), ["A", "AV", "V"]);
  const av = lines[1];
  assert.deepEqual([av.t0, av.y0, av.t1, av.y1, av.blocked, av.retro], [60, 1, 150, 2, false, false]);
  assert.ok(lines[0].y0 === 0 && lines[0].y1 === 1 && lines[2].y0 === 2 && lines[2].y1 === 3);
});

test("Wenckebach: growing AV lines, then one that stops half way", () => {
  const ev = [P(0), AV(60, 150), Q(165), P(800), AV(860, 1000), Q(1015), P(1600), { type: "blocked", t0: 1660, t1: 1700, level: "node" }];
  const av = ladderLines(ev).filter((l) => l.row === "AV");
  assert.ok(av[1].t1 - av[1].t0 > av[0].t1 - av[0].t0);
  assert.equal(av[2].blocked, true);
  assert.equal(av[2].y1, 1.5);
});

test("block below the node reaches further down the AV tier", () => {
  const [l] = ladderLines([{ type: "blocked", t0: 0, t1: 90, level: "his" }]);
  assert.equal(l.y1, 1.9);
});

test("retrograde atrial activation runs up from the ventricular beat (AVNRT / AVRT)", () => {
  const lines = ladderLines([Q(100, "avrt"), P(220, "retro")]);
  const r = lines.find((l) => l.retro);
  assert.deepEqual([r.row, r.t0, r.y0, r.t1, r.y1], ["AV", 100, 2, 220, 1]);
});

test("beats not from the atria have only a ventricular line", () => {
  const rows = ladderLines([Q(100, "vt"), Q(430, "vt")]).map((l) => l.row);
  assert.deepEqual(rows, ["V", "V"]);
});
