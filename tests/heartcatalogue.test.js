// Acceptance checks for the rhythm catalogue beyond the original set (heartrhythms.test.js): each rhythm's teaching
// feature, measured on the simulated leads and events. A rhythm that can't pass is removed, never faked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LEAD_GAIN, LEADS, leadSignals, loadGraph, simulate } from "../site/js/heartsim.js";
import { buildHeart } from "../site/js/heartshape.js";
import { axisDeg, netArea, peaks, qrsShape } from "../site/js/heartmeasure.js";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const g = loadGraph(buildHeart().json, { radius: 3.5 });
const rhythms = Object.fromEntries(read("site/heart/rhythms.json").map((r) => [r.key, r]));
const cache = {};
const sim = (key) => (cache[key] ??= simulate(g, rhythms[key].model));

const of = (s, type) => s.events.filter((e) => e.type === type);
const idx = (s, t) => Math.round((t * s.fs) / 1000);
const win = (s, e, pad = 4) => [idx(s, e.t0) - pad, idx(s, e.t1) + pad];
const area = (s, lead, e, pad) => netArea(s.leads[lead], ...win(s, e, pad), s.fs);
const shape = (s, lead, e) => qrsShape(s.leads[lead], ...win(s, e));
const axis = (s, e) => axisDeg(s.leads, ...win(s, e));
const width = (e) => e.t1 - e.t0;
const mid = (arr) => arr[Math.floor(arr.length / 2)];
const rr = (s) => { const q = of(s, "QRS"); return q.slice(1).map((e, i) => e.t0 - q[i].t0); };
const mean = (xs) => xs.reduce((a, x) => a + x, 0) / xs.length;
const cv = (xs) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2))) / mean(xs);
const rate = (s) => 60000 / mean(rr(s));
const pp = (s) => { const p = of(s, "P"); return p.slice(1).map((e, i) => e.t0 - p[i].t0); };
// The P wave's own polarity: the leads of that atrial wavefront alone (P waves can sit inside a QRS or T).
const pSign = (s, p, lead) => {
  const w = s.wavefronts.find((x) => x.kind === "atrial" && x.beat === p.beat);
  return Math.sign(netArea(leadSignals(g, [w], s.duration, { gain: LEAD_GAIN })[lead], ...win(s, p, 0), s.fs));
};
// Frontal P axis of that atrial wavefront, to the nearest 30°.
const pAxis = (s, p) => {
  const w = s.wavefronts.find((x) => x.kind === "atrial" && x.beat === p.beat);
  const L = leadSignals(g, [w], s.duration, { gain: LEAD_GAIN });
  return Math.round(Math.atan2(netArea(L.aVF, ...win(s, p, 0)), netArea(L.I, ...win(s, p, 0))) / (Math.PI / 6));
};
const prOf = (s, q) => { const e = of(s, "PR").find((x) => x.beat === q.beat); return e ? e.t1 - e.t0 : null; };
const lastNegMs = (s, lead, e) => {
  const [a, b] = win(s, e); let mx = 0; for (let i = a; i < b; i++) mx = Math.max(mx, Math.abs(s.leads[lead][i]));
  let run = 0, last = 0; for (let i = a; i < b; i++) { if (s.leads[lead][i] < -0.02 * mx) run++; else { if (run) last = run; run = 0; } }
  return ((run || last) * 1000) / s.fs;
};
// RBBB (AHA 2009): QRS ≥ 120 ms; rsr′/rsR′/rSR′ in V1, or a broad (q)R; wide terminal S in I and V6.
const rbbbLike = (s, q) => width(q) >= 120 && /(r′|R′)$|^[qQ]?R$/.test(shape(s, "V1", q)) && lastNegMs(s, "I", q) > 40 && lastNegMs(s, "V6", q) > 40;
const qtc = (s, q, rrMs) => { const t = of(s, "T").find((e) => e.t0 > q.t0); return (t.t1 - q.t0) / Math.sqrt(rrMs / 1000); };

test("catalogue: 75 rhythms, unique keys, every category known", () => {
  const list = read("site/heart/rhythms.json");
  assert.equal(list.length, 75);
  assert.equal(new Set(list.map((r) => r.key)).size, list.length);
  const cats = ["sinus", "atrial", "junctional", "avblock", "bundle", "preexcitation", "ventricular", "paced", "other"];
  for (const r of list) assert.ok(cats.includes(r.category), r.key);
});

// Sinus
test("sinus arrhythmia: PP varies, P shape and PR do not", () => {
  const s = sim("sarr");
  assert.ok(cv(pp(s)) > 0.08, `PP CV ${cv(pp(s))}`);
  assert.equal(new Set(of(s, "P").map((p) => pAxis(s, p))).size, 1);
  assert.equal(new Set(of(s, "PR").map((e) => Math.round(e.t1 - e.t0))).size, 1);
});
test("sinus arrest: a pause with no P, ended by a narrow beat with no P before it", () => {
  const s = sim("sarrest"), sp = of(s, "P").filter((p) => p.origin === "sinus"), gaps = sp.slice(1).map((e, i) => e.t0 - sp[i].t0);
  assert.ok(Math.max(...gaps) > 1700 && Math.max(...gaps) % 800 > 50, `PP ${gaps}`);
  const esc = of(s, "QRS").find((q) => q.origin === "junction");
  assert.ok(esc && width(esc) < 120);
  assert.ok(!sp.some((p) => p.t0 > esc.t0 - 250 && p.t0 < esc.t0 - 20), "no sinus P before the escape");
});
test("SA exit block: one pause equal to 2 × PP", () => {
  const s = sim("sablock");
  assert.ok(pp(s).some((x) => Math.abs(x - 1600) <= 10), `PP ${pp(s)}`);
});
test("wandering atrial pacemaker: ≥ 3 P axes, rate < 100", () => {
  const s = sim("wap");
  assert.ok(new Set(of(s, "P").map((p) => pAxis(s, p))).size >= 3);
  assert.ok(rate(s) < 100);
});
test("low atrial rhythm: P negative in II, III, aVF; PR ≥ 120", () => {
  const s = sim("lowatrial"), p = mid(of(s, "P"));
  for (const l of ["II", "III", "aVF"]) assert.equal(pSign(s, p, l), -1, l);
  for (const q of of(s, "QRS")) assert.ok(prOf(s, q) >= 120);
});

// Atrial
test("AF, controlled: irregular, 60–100/min, narrow", () => {
  const s = sim("afib_slow");
  assert.ok(cv(rr(s)) > 0.1 && rate(s) >= 60 && rate(s) <= 100, `rate ${rate(s)} CV ${cv(rr(s))}`);
  for (const q of of(s, "QRS")) assert.ok(width(q) < 120);
});
for (const [k, n] of [["aflt31", 3], ["aflt41", 4]]) {
  test(`flutter ${n}:1: RR = ${n} flutter cycles`, () => {
    for (const x of rr(sim(k))) assert.ok(Math.abs(x - n * 200) <= 5, `RR ${x}`);
  });
}
test("flutter, variable block: RR always a multiple of the flutter cycle, at least two multiples", () => {
  const m = rr(sim("afltvar")).map((x) => x / 200);
  for (const x of m) assert.ok(Math.abs(x - Math.round(x)) < 0.03, `RR/FF ${x}`);
  assert.ok(new Set(m.map(Math.round)).size >= 2);
});
test("focal AT: regular 150–220/min, P negative in I (left atrial focus)", () => {
  const s = sim("at");
  assert.ok(rate(s) >= 150 && rate(s) <= 220 && cv(rr(s)) < 0.02, `rate ${rate(s)}`);
  assert.equal(pSign(s, mid(of(s, "P")), "I"), -1);
});
test("AT with 2:1 block: two P per QRS, constant PR", () => {
  const s = sim("at21");
  assert.ok(Math.abs(of(s, "P").length / of(s, "QRS").length - 2) < 0.2);
  const prs = of(s, "PR").map((e) => e.t1 - e.t0);
  assert.ok(Math.max(...prs) - Math.min(...prs) < 3);
});
test("MAT: > 100/min, ≥ 3 P axes, irregular", () => {
  const s = sim("mat");
  assert.ok(rate(s) > 100 && cv(rr(s)) > 0.05);
  assert.ok(new Set(of(s, "P").map((p) => pAxis(s, p))).size >= 3);
});
test("PAC: early P with a different axis, pause less than compensatory", () => {
  const s = sim("pac"), P = of(s, "P"), i = P.findIndex((p) => p.origin === "atrial");
  assert.notEqual(pAxis(s, P[i]), pAxis(s, P[i - 1]));
  assert.ok(P[i + 1].t0 - P[i - 1].t0 < 1600 - 30, "not compensatory");
});
test("atrial bigeminy: every other P is premature", () => {
  const P = of(sim("pacbig"), "P");
  P.forEach((p, i) => assert.equal(p.origin, i % 2 ? "atrial" : "sinus"));
});
test("blocked PAC: the early P has no QRS", () => {
  const s = sim("pacblocked"), p = of(s, "P").find((x) => x.origin === "atrial");
  assert.ok(of(s, "blocked").some((b) => b.beat === p.beat));
});
test("PAC with aberrancy: that beat wide with RBBB shape, the sinus beats narrow", () => {
  const s = sim("pacaberrant"), Q = of(s, "QRS"), ab = Q.find((q) => q.cut);
  assert.ok(rbbbLike(s, ab), `aberrant QRS ${width(ab)} ${shape(s, "V1", ab)}`);
  for (const q of Q) if (q !== ab) assert.ok(width(q) < 120);
});

// AV nodal and junctional
test("atypical AVNRT: regular narrow, RP > PR, retrograde P negative inferiorly", () => {
  const s = sim("avnrt_atyp"), q = mid(of(s, "QRS"));
  assert.ok(cv(rr(s)) < 0.02 && width(q) < 120);
  const p = of(s, "P").find((e) => e.t0 > q.t0);
  const next = of(s, "QRS").find((e) => e.t0 > q.t0);
  assert.ok(p.t0 - q.t0 > next.t0 - p.t0, `RP ${p.t0 - q.t0} PR ${next.t0 - p.t0}`);
  for (const l of ["II", "III", "aVF"]) assert.equal(pSign(s, p, l), -1, l);
});
test("antidromic AVRT: regular wide (≥ 120) pre-excited tachycardia", () => {
  const s = sim("avrt_anti"), q = mid(of(s, "QRS"));
  assert.ok(cv(rr(s)) < 0.02 && rate(s) >= 150 && width(q) >= 120);
  assert.equal(q.origin, "antidromic");
});
for (const [k, lo, hi] of [["jescape", 40, 60], ["jaccel", 60, 100], ["jtach", 100, 200]]) {
  test(`${k}: narrow regular ${lo}–${hi}/min, retrograde P (negative in II)`, () => {
    const s = sim(k), q = mid(of(s, "QRS"));
    assert.ok(rate(s) >= lo && rate(s) <= hi && cv(rr(s)) < 0.02 && width(q) < 120, `rate ${rate(s)}`);
    assert.ok(of(s, "P").every((p) => p.origin === "retro"));
    assert.equal(pSign(s, mid(of(s, "P")), "II"), -1);
  });
}
test("PJC: early narrow beat, retrograde P near it", () => {
  const s = sim("pjc"), q = of(s, "QRS").find((e) => e.origin === "junction");
  assert.ok(width(q) < 120);
  const p = of(s, "P").find((e) => e.origin === "retro");
  assert.ok(Math.abs(p.t0 - q.t0) < 120 && pSign(s, p, "II") === -1);
});

// AV blocks
test("Mobitz I 3:2: PR lengthens, two QRS per three P", () => {
  const s = sim("mob1_32"), prs = of(s, "PR").map((e) => e.t1 - e.t0);
  assert.ok(prs[1] > prs[0] + 20);
  assert.ok(Math.abs(of(s, "P").length / of(s, "QRS").length - 1.5) < 0.2);
});
test("2:1 AV block, narrow: two P per QRS, block at the node", () => {
  const s = sim("avb21");
  assert.ok(Math.abs(of(s, "P").length / of(s, "QRS").length - 2) < 0.2);
  assert.ok(of(s, "QRS").every((q) => width(q) < 120) && of(s, "blocked").every((b) => b.level === "node"));
});
test("2:1 AV block with RBBB: two P per QRS, wide RBBB beats, block below the node", () => {
  const s = sim("avb21bbb");
  assert.ok(Math.abs(of(s, "P").length / of(s, "QRS").length - 2) < 0.2);
  assert.ok(rbbbLike(s, mid(of(s, "QRS"))) && of(s, "blocked").every((b) => b.level === "his"));
});
test("high-grade AV block: three P per QRS, constant PR", () => {
  const s = sim("avbhigh"), prs = of(s, "PR").map((e) => e.t1 - e.t0);
  assert.ok(Math.abs(of(s, "P").length / of(s, "QRS").length - 3) < 0.35);
  assert.ok(Math.max(...prs) - Math.min(...prs) < 3);
});

// Bundle branch and fascicular
test("incomplete RBBB: QRS 100–119 ms with rSr′ in V1", () => {
  const s = sim("irbbb"), q = mid(of(s, "QRS"));
  assert.ok(width(q) >= 100 && width(q) < 120, `QRS ${width(q)}`);
  assert.match(shape(s, "V1", q), /^r[sS](r′|R′)$/);
});
// With LAFB as well, the late superior-left forces dominate lead I, so the terminal S is checked in V6 only.
const bifascicular = (s, q) => width(q) >= 120 && /(r′|R′)$|^[qQ]?R$/.test(shape(s, "V1", q)) && lastNegMs(s, "V6", q) > 40 && axis(s, q) <= -45;
test("RBBB + LAFB: RBBB pattern in V1/V6 and axis ≤ −45°", () => {
  const s = sim("rbbb_lafb"), q = mid(of(s, "QRS"));
  assert.ok(bifascicular(s, q), `${shape(s, "V1", q)} axis ${axis(s, q)}`);
});
test("bifascicular block + 1st-degree AV block: as above with PR > 200", () => {
  const s = sim("trifasc"), q = mid(of(s, "QRS"));
  assert.ok(bifascicular(s, q) && prOf(s, q) > 200);
});
test("LBBB + 1st-degree AV block: LBBB shape and PR > 200", () => {
  const s = sim("lbbb_1avb"), q = mid(of(s, "QRS"));
  assert.ok(width(q) >= 120 && prOf(s, q) > 200);
  assert.match(shape(s, "V6", q), /^R/);
  assert.match(shape(s, "V1", q), /^(QS|rS)$/);
});
test("rate-related LBBB: narrow at the slow rate, LBBB once the RR shortens", () => {
  const s = sim("ratelbbb"), Q = of(s, "QRS");
  assert.ok(width(Q[1]) < 120 && width(Q.at(-2)) >= 120);
  assert.match(shape(s, "V6", Q.at(-2)), /^R/);
});
test("alternating BBB: consecutive beats alternate RBBB and LBBB", () => {
  const s = sim("altbbb"), Q = of(s, "QRS").slice(1, -1);
  for (const q of Q) {
    const v1 = shape(s, "V1", q);
    assert.ok(width(q) >= 120);
    assert.ok(q.cut.includes("rbb") ? /r′|R′/.test(v1) : /^(QS|rS)$/.test(v1), `${q.cut} ${v1}`);
  }
  for (let i = 1; i < Q.length; i++) assert.notDeepEqual(Q[i].cut, Q[i - 1].cut);
});

// Pre-excitation
test("WPW posteroseptal: short PR, delta wave, net negative in III and aVF", () => {
  const s = sim("wpw_ps"), q = mid(of(s, "QRS"));
  assert.ok(prOf(s, q) < 120 && of(s, "pre").length > 0);
  for (const l of ["III", "aVF"]) assert.ok(area(s, l, q) < 0, l);
});
test("intermittent pre-excitation: both kinds of beat on one strip", () => {
  const s = sim("wpw_int"), Q = of(s, "QRS");
  assert.ok(Q.some((q) => q.origin === "pre" && prOf(s, q) < 120 && width(q) >= 110));
  assert.ok(Q.some((q) => q.origin === "conducted" && prOf(s, q) >= 120 && width(q) < 120));
});
test("pre-excited AF: irregular, wide beats of varying width, some RR < 250 ms", () => {
  const s = sim("afpre"), w = of(s, "QRS").map(width);
  assert.ok(cv(rr(s)) > 0.15 && Math.min(...rr(s)) < 250);
  assert.ok(Math.max(...w) >= 120 && Math.max(...w) - Math.min(...w) > 30);
});

// Ventricular
test("RVOT PVC: wide, negative V1, positive II/III/aVF", () => {
  const s = sim("pvc_rvot"), q = of(s, "QRS").find((e) => e.origin === "ectopic");
  assert.ok(width(q) >= 120 && area(s, "V1", q) < 0);
  for (const l of ["II", "III", "aVF"]) assert.ok(area(s, l, q) > 0, l);
});
for (const [k, n] of [["vbig", 2], ["vtrig", 3]]) {
  test(`${k}: every ${n === 2 ? "second" : "third"} beat a wide PVC`, () => {
    const Q = of(sim(k), "QRS"), first = Q.findIndex((q) => q.origin === "ectopic");
    Q.forEach((q, i) => assert.equal(q.origin === "ectopic", i >= first && (i - first) % n === 0, `beat ${i}`));
    assert.ok(Q.filter((q) => q.origin === "ectopic").every((q) => width(q) >= 120));
  });
}
test("couplet: two consecutive PVCs", () => {
  const Q = of(sim("couplet"), "QRS"), i = Q.findIndex((q) => q.origin === "ectopic");
  assert.equal(Q[i + 1].origin, "ectopic");
  assert.notEqual(Q[i + 2].origin, "ectopic");
});
test("fusion: one beat wider than sinus and narrower than the PVC, with a P before it", () => {
  const s = sim("fusion"), f = of(s, "QRS").find((q) => q.origin === "fusion");
  const pvcW = width(of(sim("vbig"), "QRS").find((q) => q.origin === "ectopic"));
  const sinusW = width(of(s, "QRS")[1]);
  assert.ok(width(f) > sinusW + 5 && width(f) < pvcW, `fusion ${width(f)} sinus ${sinusW} pvc ${pvcW}`);
  assert.ok(prOf(s, f) > 0);
});
test("AIVR: wide regular 50–110/min, P waves unrelated", () => {
  const s = sim("aivr"), V = of(s, "QRS").filter((q) => q.origin !== "conducted");
  const d = V.slice(1).map((q, i) => q.t0 - V[i].t0).filter((x) => x < 1000);
  assert.ok(V.length >= 4 && V.every((q) => width(q) >= 120));
  assert.ok(60000 / mean(d) >= 50 && 60000 / mean(d) <= 110);
});
test("idioventricular escape: no P, wide regular 20–40/min", () => {
  const s = sim("idiov");
  assert.equal(of(s, "P").length, 0);
  assert.ok(rate(s) >= 20 && rate(s) <= 40 && of(s, "QRS").every((q) => width(q) >= 120));
});
test("RVOT VT: wide regular > 120/min, negative V1, inferior axis", () => {
  const s = sim("vt_rvot"), q = mid(of(s, "QRS"));
  assert.ok(rate(s) > 120 && cv(rr(s)) < 0.02 && width(q) >= 120 && area(s, "V1", q) < 0);
  for (const l of ["II", "aVF"]) assert.ok(area(s, l, q) > 0, l);
});
test("fascicular VT: regular, QRS 110–150, RBBB-like V1, axis ≤ −30°", () => {
  const s = sim("vt_fasc"), q = mid(of(s, "QRS"));
  assert.ok(cv(rr(s)) < 0.02 && width(q) >= 110 && width(q) <= 150, `QRS ${width(q)}`);
  assert.ok(peaks(s.leads.V1, ...win(s, q)).at(-1).v > 0 && axis(s, q) <= -30, `axis ${axis(s, q)}`);
});
test("NSVT: 3–10 consecutive wide fast beats inside sinus rhythm", () => {
  const Q = of(sim("nsvt"), "QRS"), run = Q.filter((q) => q.origin === "vt");
  assert.ok(run.length >= 3 && run.length <= 10 && run.every((q) => width(q) >= 120));
  assert.equal(Q[0].origin, "conducted");
  assert.equal(Q.at(-1).origin, "conducted");
});
test("torsades: long QT on sinus beats, then wide beats whose axis turns ≥ 180°", () => {
  const s = sim("tdp"), Q = of(s, "QRS"), sinus = Q[1];
  assert.ok(qtc(s, sinus, 1100) > 480, `QTc ${qtc(s, sinus, 1100)}`);
  const ax = Q.filter((q) => q.origin === "vt").map((q) => axis(s, q));
  let turn = 0;
  for (let i = 1; i < ax.length; i++) turn += Math.abs((((ax[i] - ax[i - 1]) % 360) + 540) % 360 - 180);
  assert.ok(turn >= 180, `axes ${ax.map(Math.round)}`);
});
test("VF: no QRS events, irregular deflections, never quiet", () => {
  const s = sim("vf"), II = s.leads.II;
  assert.equal(of(s, "QRS").length, 0);
  const pk = peaks(II, 500, II.length);
  const gaps = pk.slice(1).map((p, i) => p.i - pk[i].i);
  assert.ok(pk.length > 20 && cv(gaps) > 0.2, `${pk.length} peaks, CV ${cv(gaps)}`);
});

// Paced
const spikes = (s, ch) => of(s, "spike").filter((e) => e.chamber === ch);
test("AAI: a spike before each P, normal QRS", () => {
  const s = sim("aai");
  for (const p of of(s, "P")) assert.ok(spikes(s, "A").some((x) => p.t0 - x.t0 >= 0 && p.t0 - x.t0 < 20));
  assert.ok(of(s, "QRS").every((q) => width(q) < 120));
});
test("VVI: spike before each wide QRS, negative V1, axis ≤ −30°", () => {
  const s = sim("vvi"), q = mid(of(s, "QRS"));
  assert.ok(of(s, "QRS").every((x) => spikes(s, "V").some((sp) => x.t0 - sp.t0 >= 0 && x.t0 - sp.t0 < 20)));
  assert.ok(width(q) >= 120 && area(s, "V1", q) < 0 && axis(s, q) <= -30, `QRS ${width(q)} axis ${axis(s, q)}`);
});
test("DDD: atrial spike, P, then ventricular spike and wide QRS", () => {
  const s = sim("ddd"), q = mid(of(s, "QRS"));
  assert.equal(spikes(s, "A").length, spikes(s, "V").length);
  assert.ok(width(q) >= 120);
});
test("biventricular pacing: narrower than VVI, net negative in I", () => {
  const s = sim("biv"), q = mid(of(s, "QRS")), v = mid(of(sim("vvi"), "QRS"));
  assert.ok(width(q) < width(v) && area(s, "I", q) < 0, `BiV ${width(q)} VVI ${width(v)}`);
});
test("failure to capture: some ventricular spikes without a QRS", () => {
  const s = sim("capfail"), Q = of(s, "QRS");
  assert.ok(spikes(s, "V").some((sp) => !Q.some((q) => q.t0 - sp.t0 >= 0 && q.t0 - sp.t0 < 40)));
});
test("pacing spikes appear in the leads (device artefact)", () => {
  const s = sim("vvi"), sp = spikes(s, "V")[1], i = idx(s, sp.t0);
  assert.ok(s.leads.II[i] - s.leads.II[i - 2] > 1);
});

// Repolarisation and leads
test("peaked T: taller and narrower T in V2–V4 than NSR", () => {
  const s = sim("peakedt"), n = simulate(g, rhythms.nsr.model);
  const tq = (x) => { const q = mid(of(x, "QRS")); return of(x, "T").find((e) => e.t0 > q.t0); };
  for (const l of ["V2", "V3", "V4"]) {
    const [a, b] = [tq(s), tq(n)];
    const peak = (x, t) => Math.max(...x.leads[l].slice(...win(x, t, 0)));
    assert.ok(peak(s, a) > peak(n, b), `${l} peak`);
  }
  // Narrower: width at half height in V3.
  const fwhm = (x, t) => { const sig = x.leads.V3.slice(...win(x, t, 0)), m = Math.max(...sig); return sig.filter((v) => v > m / 2).length; };
  assert.ok(fwhm(s, tq(s)) < fwhm(n, tq(n)), `${fwhm(s, tq(s))} vs ${fwhm(n, tq(n))} samples`);
});
test("long QT: QTc > 480; short QT: QTc < 340", () => {
  const l = sim("longqt"), s = sim("shortqt");
  assert.ok(qtc(l, mid(of(l, "QRS")), 1000) > 480, `long ${qtc(l, mid(of(l, "QRS")), 1000)}`);
  assert.ok(qtc(s, mid(of(s, "QRS")), 800) < 340, `short ${qtc(s, mid(of(s, "QRS")), 800)}`);
});
test("LA/RA reversal: I inverted, II↔III, aVR↔aVL, aVF unchanged (lead algebra on NSR)", () => {
  const r = sim("lareversal"), n = simulate(g, rhythms.nsr.model);
  const same = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-6);
  assert.ok(same(r.leads.I, n.leads.I.map((x) => -x)));
  assert.ok(same(r.leads.II, n.leads.III) && same(r.leads.III, n.leads.II));
  assert.ok(same(r.leads.aVR, n.leads.aVL) && same(r.leads.aVF, n.leads.aVF));
  for (const l of ["V1", "V6"]) assert.ok(same(r.leads[l], n.leads[l]));
});
test("V1–V2 too high: rSr′ in V1 where NSR has rS", () => {
  const s = sim("highv12"), n = simulate(g, rhythms.nsr.model);
  assert.match(shape(s, "V1", mid(of(s, "QRS"))), /r′/);
  assert.doesNotMatch(shape(n, "V1", mid(of(n, "QRS"))), /r′/);
});

test("speed: the slowest rhythm simulates in under 5 s", () => {
  let worst = 0, key = "";
  for (const k of ["vf", "afpre", "aflt", "avrt_anti"]) {
    const t0 = performance.now(); simulate(g, rhythms[k].model);
    const ms = performance.now() - t0;
    if (ms > worst) [worst, key] = [ms, k];
  }
  console.log(`slowest: ${key} ${Math.round(worst)} ms`);
  assert.ok(worst < 5000);
});

void LEADS;
