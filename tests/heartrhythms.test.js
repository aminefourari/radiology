// Acceptance checks: each simulated rhythm meets the ECG criteria the ECG atlas teaches, measured on the
// simulated leads (morphology) and the simulation's events (intervals). Runs on the shipped heart graph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadGraph, simulate, wrapTime } from "../site/js/heartsim.js";
import { axisDeg, netArea, peaks, qrsShape, upstrokeMs } from "../site/js/heartmeasure.js";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const g = loadGraph(read("site/heart/heart-graph.json"));
const rhythms = Object.fromEntries(read("site/heart/rhythms.json").map((r) => [r.key, r]));
const cache = {};
const sim = (key) => (cache[key] ??= simulate(g, rhythms[key].model));

const of = (s, type) => s.events.filter((e) => e.type === type);
const idx = (s, t) => Math.round((t * s.fs) / 1000);
// A QRS window in samples, padded so the smoothed edges are included.
const win = (s, e, pad = 4) => [idx(s, e.t0) - pad, idx(s, e.t1) + pad];
const area = (s, lead, e, pad) => netArea(s.leads[lead], ...win(s, e, pad), s.fs);
const shape = (s, lead, e) => qrsShape(s.leads[lead], ...win(s, e));
// Middle beat: away from the strip edges.
const mid = (arr) => arr[Math.floor(arr.length / 2)];
const rr = (s) => { const q = of(s, "QRS"); return q.slice(1).map((e, i) => e.t0 - q[i].t0); };
// The T wave belonging to a QRS: the first T event starting after it.
const tOf = (s, qrs) => of(s, "T").find((e) => e.t0 > qrs.t0);
// Duration (ms) of the last negative lobe inside a window.
function lastNegMs(s, lead, e) {
  const [a, b] = win(s, e); let run = 0, last = 0;
  for (let i = a; i < b; i++) { if (s.leads[lead][i] < -0.02 * maxAbs(s, lead, e)) run++; else { if (run) last = run; run = 0; } }
  return ((run || last) * 1000) / s.fs;
}
const maxAbs = (s, lead, e) => { const [a, b] = win(s, e); let m = 0; for (let i = a; i < b; i++) m = Math.max(m, Math.abs(s.leads[lead][i])); return m; };

test("determinism: the same model gives identical leads", () => {
  const a = simulate(g, rhythms.nsr.model), b = sim("nsr");
  assert.deepEqual(Array.from(a.leads.V1), Array.from(b.leads.V1));
});

test("wrapTime wraps into the strip both ways", () => {
  const s = sim("nsr");
  assert.equal(wrapTime(s, -1), s.duration - 1);
  assert.equal(wrapTime(s, s.duration + 5), 5);
  assert.equal(wrapTime(s, 7), 7);
});

test("every QRS event window contains its lead II extreme", () => {
  const s = sim("nsr");
  for (const e of of(s, "QRS")) {
    const [a, b] = win(s, e, 0);
    const p = peaks(s.leads.II, a - 40, b + 40).reduce((m, x) => (Math.abs(x.v) > Math.abs(m.v) ? x : m));
    assert.ok(p.i >= a - 2 && p.i <= b + 2, `peak at ${p.i} outside ${a}–${b}`);
  }
});

test("NSR: rate, PR, QRS, QTc and axis in the normal ranges", () => {
  const s = sim("nsr"), q = mid(of(s, "QRS")), p = of(s, "P").filter((e) => e.t0 < q.t0).at(-1);
  const rate = 60000 / mid(rr(s));
  assert.ok(rate >= 60 && rate <= 100, `rate ${rate}`);
  const pr = q.t0 - p.t0;
  assert.ok(pr >= 120 && pr <= 200, `PR ${pr}`);
  assert.ok(q.t1 - q.t0 < 120, `QRS ${q.t1 - q.t0}`);
  const qt = tOf(s, q).t1 - q.t0, qtc = qt / Math.sqrt(mid(rr(s)) / 1000);
  assert.ok(qtc >= 350 && qtc <= 450, `QTc ${qtc}`);
  const ax = axisDeg(s.leads, ...win(s, q));
  assert.ok(ax >= -30 && ax <= 90, `axis ${ax}`);
});

test("NSR: P upright in I and II; QRS positive in I, II, aVF and negative in aVR", () => {
  const s = sim("nsr"), q = mid(of(s, "QRS")), p = of(s, "P").filter((e) => e.t0 < q.t0).at(-1);
  for (const l of ["I", "II"]) assert.ok(area(s, l, p) > 0, `P in ${l}`);
  for (const l of ["I", "II", "aVF"]) assert.ok(area(s, l, q) > 0, `QRS in ${l}`);
  assert.ok(area(s, "aVR", q) < 0);
});

test("NSR: V1 rS, V6 qR with a septal q, transition at V3–V4", () => {
  const s = sim("nsr"), q = mid(of(s, "QRS"));
  assert.match(shape(s, "V1", q), /^r(S|s)$/);
  assert.match(shape(s, "V6", q), /^qR/);
  const firstPositive = ["V1", "V2", "V3", "V4", "V5", "V6"].find((l) => area(s, l, q) > 0);
  assert.ok(["V3", "V4"].includes(firstPositive), `transition at ${firstPositive}`);
});

test("NSR: T upright in I, II, V5, V6", () => {
  const s = sim("nsr"), t = tOf(s, mid(of(s, "QRS")));
  for (const l of ["I", "II", "V5", "V6"]) assert.ok(area(s, l, t, 0) > 0, `T in ${l}`);
});

test("RBBB: QRS ≥ 120 ms, rsr′/rSR′ in V1, wide terminal S in I and V6", () => {
  const s = sim("rbbb"), q = mid(of(s, "QRS"));
  assert.ok(q.t1 - q.t0 >= 120, `QRS ${q.t1 - q.t0}`);
  assert.match(shape(s, "V1", q), /^r[sS](r′|R′)$/);
  for (const l of ["I", "V6"]) assert.ok(lastNegMs(s, l, q) > 40, `terminal S in ${l}: ${lastNegMs(s, l, q)} ms`);
});

test("LBBB: QRS ≥ 120 ms, no septal q in I/V5/V6, broad R in V6, QS or rS in V1, discordant T", () => {
  const s = sim("lbbb"), q = mid(of(s, "QRS")), t = tOf(s, q);
  assert.ok(q.t1 - q.t0 >= 120, `QRS ${q.t1 - q.t0}`);
  for (const l of ["I", "V5", "V6"]) assert.doesNotMatch(shape(s, l, q), /^q/i, `septal q in ${l}`);
  assert.match(shape(s, "V6", q), /^R/);
  assert.match(shape(s, "V1", q), /^(QS|rS)$/);
  assert.ok(area(s, "V1", t, 0) > 0 && area(s, "V6", t, 0) < 0, "T opposite to the QRS in V1 and V6");
});

test("WPW: short PR, slurred upstroke (delta wave), QRS ≥ 110 ms", () => {
  const s = sim("wpw"), n = sim("nsr");
  const q = mid(of(s, "QRS")), p = of(s, "P").filter((e) => e.t0 < q.t0).at(-1);
  assert.ok(q.t0 - p.t0 < 120, `PR ${q.t0 - p.t0}`);
  assert.ok(q.t1 - q.t0 >= 110, `QRS ${q.t1 - q.t0}`);
  assert.ok(of(s, "pre").length > 0);
  // The lead where the delta is upright: slower upstroke than the same lead in NSR.
  const qn = mid(of(n, "QRS"));
  const lead = ["V1", "V2", "II", "aVF", "III"].find((l) => upstrokeMs(s.leads[l], ...win(s, q)) > upstrokeMs(n.leads[l], ...win(n, qn)) + 15);
  assert.ok(lead, "a slurred upstroke in some lead");
});

test("Flutter: atrial cycle 200 ms, negative flutter waves in II, III, aVF, 2:1 conduction", () => {
  const s = sim("aflt");
  const P = of(s, "P");
  const cyc = P.slice(1).map((e, i) => e.t0 - P[i].t0);
  assert.ok(cyc.every((c) => Math.abs(c - 200) <= 2), `atrial cycles ${cyc}`);
  assert.ok(Math.abs(mid(rr(s)) - 400) <= 5, `RR ${mid(rr(s))}`);
  // Atrial activity between QRS-T complexes: the sawtooth is net negative in the inferior leads.
  const span = { t0: 0, t1: s.duration };
  const q = of(s, "QRS"), t = of(s, "T");
  const busy = (ms) => q.some((e) => ms >= e.t0 - 10 && ms <= e.t1 + 10) || t.some((e) => ms >= e.t0 && ms <= e.t1);
  for (const l of ["II", "III", "aVF"]) {
    let a = 0;
    for (let i = 0; i < s.leads[l].length; i++) if (!busy((i * 1000) / s.fs)) a += s.leads[l][i];
    assert.ok(a < 0, `flutter waves in ${l} not negative (${a})`);
  }
  void span;
});

test("NSR: leads are in mV — R in V5 about 1.5 mV, P under 0.25 mV in II", () => {
  const s = sim("nsr"), q = mid(of(s, "QRS")), p = of(s, "P").filter((e) => e.t0 < q.t0).at(-1);
  const r = maxAbs(s, "V5", q);
  assert.ok(r > 1 && r < 2, `R V5 ${r} mV`);
  assert.ok(maxAbs(s, "II", p) < 0.25 && maxAbs(s, "II", p) > 0.05, `P II ${maxAbs(s, "II", p)} mV`);
});

const pr = (s) => of(s, "QRS").map((q) => { const p = of(s, "PR").find((e) => e.beat === q.beat); return p ? p.t1 - p.t0 : null; });
const cv = (xs) => { const m = xs.reduce((a, x) => a + x, 0) / xs.length; return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length) / m; };
const rateOf = (s) => 60000 / (rr(s).reduce((a, x) => a + x, 0) / rr(s).length);

test("sinus bradycardia < 60/min and tachycardia > 100/min, PR normal", () => {
  assert.ok(rateOf(sim("sbrad")) < 60);
  assert.ok(rateOf(sim("stach")) > 100);
  for (const k of ["sbrad", "stach"]) for (const x of pr(sim(k))) assert.ok(x >= 120 && x <= 200, `${k} PR ${x}`);
});

test("1st-degree AV block: PR > 200 ms and every P conducted", () => {
  const s = sim("1avb");
  for (const x of pr(s)) assert.ok(x > 200, `PR ${x}`);
  assert.equal(of(s, "blocked").length, 0);
  assert.equal(of(s, "P").length, of(s, "QRS").length);
});

test("Mobitz I: PR lengthens beat by beat, then a P is not conducted", () => {
  const s = sim("mob1");
  const seq = of(s, "P").map((p) => { const b = of(s, "blocked").find((e) => e.beat === p.beat); if (b) return "x"; const q = of(s, "PR").find((e) => e.t0 === p.t0); return q ? q.t1 - q.t0 : null; }).filter((x) => x != null);
  const firstBlock = seq.indexOf("x");
  assert.ok(firstBlock >= 2, `sequence ${seq}`);
  const run = seq.slice(0, firstBlock);
  assert.ok(run.every((x, i) => i === 0 || x > run[i - 1] + 10), `PRs ${run}`);
});

test("Mobitz II: constant PR, then a P blocked below the node", () => {
  const s = sim("mob2");
  const prs = pr(s);
  assert.ok(Math.max(...prs) - Math.min(...prs) < 3, `PRs ${prs}`);
  const b = of(s, "blocked");
  assert.ok(b.length > 0 && b.every((e) => e.level === "his"));
});

test("Complete heart block: no P–QRS relation, slow wide ventricular escape", () => {
  const s = sim("3avb");
  assert.equal(of(s, "AV").length, 0);
  assert.ok(rateOf(s) < 60000 / 800 && rateOf(s) < 40, `ventricular rate ${rateOf(s)}`);
  const q = mid(of(s, "QRS"));
  assert.ok(q.t1 - q.t0 >= 120, `escape QRS ${q.t1 - q.t0}`);
  const lag = of(s, "QRS").map((qq) => qq.t0 - of(s, "P").filter((p) => p.t0 < qq.t0).at(-1).t0);
  assert.ok(Math.max(...lag) - Math.min(...lag) > 100, `P–QRS intervals ${lag}`);
});

test("Block in the AV node: narrow junctional escape at 40–60/min", () => {
  const s = sim("3avb_node"), q = mid(of(s, "QRS"));
  assert.ok(q.t1 - q.t0 < 120, `QRS ${q.t1 - q.t0}`);
  assert.ok(rateOf(s) >= 40 && rateOf(s) <= 60, `rate ${rateOf(s)}`);
  assert.equal(of(s, "AV").length, 0);
});

test("AVNRT: regular narrow tachycardia 150–250/min, atria and ventricles activated together", () => {
  const s = sim("avnrt");
  assert.ok(rateOf(s) >= 150 && rateOf(s) <= 250, `rate ${rateOf(s)}`);
  assert.ok(cv(rr(s)) < 0.02);
  const q = mid(of(s, "QRS"));
  assert.ok(q.t1 - q.t0 < 120);
  const p = of(s, "P").reduce((best, e) => (Math.abs(e.t0 - q.t0) < Math.abs(best.t0 - q.t0) ? e : best));
  assert.ok(Math.abs(p.t0 - q.t0) <= 40, `P ${p.t0} vs QRS ${q.t0}`);
});

test("AVRT: regular narrow tachycardia, retrograde P 70–150 ms after QRS onset", () => {
  const s = sim("avrt"), q = mid(of(s, "QRS"));
  assert.ok(rateOf(s) >= 150 && rateOf(s) <= 250 && cv(rr(s)) < 0.02);
  assert.ok(q.t1 - q.t0 < 120);
  const p = of(s, "P").find((e) => e.t0 > q.t0);
  assert.ok(p.t0 - q.t0 >= 70 && p.t0 - q.t0 <= 150, `RP ${p.t0 - q.t0}`);
});

test("AF: no regular atrial activity, irregularly irregular RR", () => {
  const s = sim("afib");
  assert.ok(cv(rr(s)) > 0.1, `RR CV ${cv(rr(s))}`);
  const P = of(s, "P");
  assert.ok(cv(P.slice(1).map((e, i) => e.t0 - P[i].t0)) > 0.15, "atrial activity is not a repeating P");
  for (const x of of(s, "QRS")) assert.ok(x.t1 - x.t0 < 120);
});

test("PVC: early wide beat without a premature P, then a compensatory pause", () => {
  const s = sim("pvc");
  const v = of(s, "QRS").find((e) => e.origin === "ectopic");
  assert.ok(v.t1 - v.t0 >= 120, `PVC QRS ${v.t1 - v.t0}`);
  assert.ok(!of(s, "P").some((p) => p.t0 > v.t0 - 200 && p.t0 < v.t0), "no P just before the PVC");
  const Q = of(s, "QRS"), i = Q.indexOf(v);
  assert.ok(Math.abs(Q[i + 1].t0 - Q[i - 1].t0 - 1600) <= 30, `pause ${Q[i + 1].t0 - Q[i - 1].t0}`);
});

test("VT: regular wide tachycardia ≥ 120/min with AV dissociation", () => {
  const s = sim("vt"), q = mid(of(s, "QRS"));
  assert.ok(rateOf(s) >= 120 && cv(rr(s)) < 0.02, `rate ${rateOf(s)}`);
  assert.ok(q.t1 - q.t0 >= 140, `QRS ${q.t1 - q.t0}`);
  const P = of(s, "P");
  const atrialCycle = (P.at(-1).t0 - P[0].t0) / (P.length - 1);
  assert.ok(Math.abs(atrialCycle - mid(rr(s))) > 100, "atria at their own rate");
  assert.equal(of(s, "AV").length, 0);
});

test("ladder: AVNRT and AVRT show retrograde conduction; Mobitz I a blocked impulse", async () => {
  const { ladderLines } = await import("../site/js/ladder.js");
  for (const k of ["avnrt", "avrt"]) assert.ok(ladderLines(sim(k).events).some((l) => l.retro), k);
  assert.ok(ladderLines(sim("mob1").events).some((l) => l.blocked));
});
