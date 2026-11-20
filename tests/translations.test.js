// Translation completeness: every UI string and every data name exists in every listed language.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const LANGS = read("site/i18n/index.json").map((l) => l.code);
const en = read("site/i18n/en.json");
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// pipeline/ecgs.json groups examples by diagnosis; flatten to one entry per ECG.
const ecgs = () => read("pipeline/ecgs.json").flatMap((d) => d.examples.map((ex) => ({ ...ex, title: d.title })));

// [label, names object] for every translated name in the data files.
function dataNames() {
  const out = [];
  for (const s of read("pipeline/structures.json").structures) out.push([`structure ${s.key}`, s.names]);
  for (const e of ecgs()) {
    out.push([`ecg ${e.id}`, e.title]);
    (e.clues || []).forEach((c, i) => out.push([`ecg ${e.id} clue ${i}`, c.text]));
    for (const [step, o] of Object.entries(e.override || {})) if (o.note) out.push([`ecg ${e.id} override ${step}`, o.note]);
  }
  for (const r of read("site/heart/rhythms.json")) {
    out.push([`rhythm ${r.key} title`, r.title]); // rhythm texts are English-first: checked in the heart-page test below
  }
  for (const f of readdirSync(new URL("../pipeline/cases/", import.meta.url)).filter((f) => f.endsWith(".json"))) {
    const c = read(`pipeline/cases/${f}`);
    if (c.title) out.push([`case ${f} title`, c.title]);
    (c.keyLevels || []).forEach((k, i) => out.push([`case ${f} key level ${i}`, k.names]));
  }
  return out;
}

for (const lang of LANGS) {
  test(`UI strings: ${lang} has every key from en.json, non-empty, same placeholders`, () => {
    const d = read(`site/i18n/${lang}.json`);
    const missing = Object.keys(en).filter((k) => typeof d[k] !== "string" || !d[k].trim());
    assert.deepEqual(missing, [], `${lang}.json is missing or has empty strings`);
    const bad = Object.keys(en).filter((k) => vars(en[k]).join() !== vars(d[k]).join());
    assert.deepEqual(bad, [], `${lang}.json placeholders differ from en.json`);
  });

  test(`data names: structures, ECGs, cases and key levels all have ${lang}`, () => {
    const missing = dataNames().filter(([, names]) => !names?.[lang]?.trim()).map(([label]) => label);
    assert.deepEqual(missing, [], `missing ${lang} names`);
  });
}

test("ECG clues name real leads and waves; every ECG has an ST answer", () => {
  const LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
  for (const e of ecgs()) {
    assert.ok(["normal", "elevated", "depressed"].includes(e.st), `ecg ${e.id} st`);
    for (const c of e.clues || []) {
      assert.ok(c.leads.length && c.leads.every((l) => LEADS.includes(l)), `ecg ${e.id} clue leads ${c.leads}`);
      assert.ok(c.wave === undefined || ["P", "QRS", "ST", "T"].includes(c.wave), `ecg ${e.id} clue wave ${c.wave}`);
    }
  }
});

test("en.json has every string the ECG reading card needs", async () => {
  const { STEPS } = await import("../site/js/ecglearn.js");
  const need = ["read.title", "read.machine", "read.clues", "read.noFindings", "read.community", "ecg.report", "ecg.measuresCredit", "step.dx"];
  for (const s of STEPS) need.push(`step.${s.key}`, `note.${s.key}`, ...s.choices.map((c) => `choice.${s.key}.${c}`));
  assert.deepEqual(need.filter((k) => !(k in en)), []);
});

test("en.json has every string Learn mode needs, with the right placeholders", async () => {
  const { STEPS } = await import("../site/js/ecglearn.js");
  const need = { "learn.button": [], "learn.exit": [], "learn.next": [], "learn.nextEcg": [], "learn.correct": [],
    "learn.wrong": ["answer"], "learn.measured": ["range", "value"], "learn.showOnTracing": [], "learn.session": ["n", "total"],
    "learn.score": ["correct", "total"], "learn.tally": ["correct", "done", "total"], "learn.question.dx": [] };
  for (const s of STEPS) need[`learn.question.${s.key}`] = [];
  for (const [k, v] of Object.entries(need)) {
    assert.ok(k in en, `${k} missing`);
    assert.deepEqual(vars(en[k]), v, `${k} placeholders`);
  }
});

test("teaching content uses the three-lead axis rule and a 1:1 P–QRS rhythm question", () => {
  assert.match(en["note.axis"], /\bII\b/);
  assert.match(en["note.axis"], /−30/);
  assert.match(en["learn.question.rhythm"], /every P wave/);
  const lafb = ecgs().find((e) => e.id === 4619);
  assert.match(lafb.clues[0].text.en, /\bII\b/);
  assert.ok(lafb.clues[0].leads.includes("II"));
});

test("UI strings: every case region and every CT window has a name in en.json", async () => {
  const { WINDOWS } = await import("../site/js/volume.js");
  const keys = [
    ...read("site/cases/index.json").map((c) => `region.${c.region}`),
    ...Object.keys(WINDOWS).map((w) => `win.${w}`),
  ];
  assert.deepEqual(keys.filter((k) => !(k in en)), []);
});

test("heart page: every rhythm has a title in every language, 3–6 why points and 2–5 ECG bullets in English", () => {
  // Texts are written in English; a translation, where present, has the same number of points.
  for (const r of read("site/heart/rhythms.json")) {
    for (const lang of LANGS) assert.ok(r.title[lang], `${r.key} title ${lang}`);
    assert.ok(r.why?.en?.length >= 3 && r.why.en.length <= 6, `${r.key} why`);
    assert.ok(r.looks?.en?.length >= 2 && r.looks.en.length <= 5, `${r.key} looks`);
    for (const lang of LANGS) {
      if (r.why[lang]) assert.equal(r.why[lang].length, r.why.en.length, `${r.key} why ${lang}`);
      if (r.looks[lang]) assert.equal(r.looks[lang].length, r.looks.en.length, `${r.key} looks ${lang}`);
    }
  }
});

test("heart page: a caption for every event the simulator emits", () => {
  const need = ["rest", "P", "P.retro", "P.flutter", "P.af", "AV", "blocked", "pre", "QRS", "QRS.ventricular", "QRS.junction", "ST", "T",
    "reentry.flutter", "reentry.avnrt", "reentry.avrt", "reentry.vt"].map((k) => `heart.cap.${k}`);
  assert.deepEqual(need.filter((k) => !(k in en)), []);
});

test("heart page: a label for every rhythm category, clock origin and new caption", async () => {
  const { CATEGORIES } = await import("../site/js/heartstate.js");
  const need = [...CATEGORIES.map((c) => `heart.cat.${c}`),
    ...["sinus", "atrial", "junction", "ventricle", "pacing"].map((o) => `heart.clock.${o}`),
    ...["vf", "sablock", "P.atrial", "P.paced", "QRS.paced", "QRS.fusion", "QRS.antidromic", "reentry.antidromic"].map((k) => `heart.cap.${k}`)];
  assert.deepEqual(need.filter((k) => !(k in en)), []);
  for (const r of read("site/heart/rhythms.json")) assert.ok(CATEGORIES.includes(r.category), r.key);
});
