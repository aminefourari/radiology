// Translation completeness: every UI string and every data name exists in every listed language.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const LANGS = read("site/i18n/index.json").map((l) => l.code);
const en = read("site/i18n/en.json");
const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

// [label, names object] for every translated name in the data files.
function dataNames() {
  const out = [];
  for (const s of read("pipeline/structures.json").structures) out.push([`structure ${s.key}`, s.names]);
  for (const e of read("pipeline/ecgs.json")) {
    out.push([`ecg ${e.id}`, e.title]);
    (e.clues || []).forEach((c, i) => out.push([`ecg ${e.id} clue ${i}`, c.text]));
    for (const [step, o] of Object.entries(e.override || {})) if (o.note) out.push([`ecg ${e.id} override ${step}`, o.note]);
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
  for (const e of read("pipeline/ecgs.json")) {
    assert.ok(["normal", "elevated", "depressed"].includes(e.st), `ecg ${e.id} st`);
    for (const c of e.clues || []) {
      assert.ok(c.leads.length && c.leads.every((l) => LEADS.includes(l)), `ecg ${e.id} clue leads ${c.leads}`);
      assert.ok(c.wave === undefined || ["P", "QRS", "ST", "T"].includes(c.wave), `ecg ${e.id} clue wave ${c.wave}`);
    }
  }
});
