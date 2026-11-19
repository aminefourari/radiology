import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { pickLang, structName } from "../site/js/i18n.js";

const dir = new URL("../site/i18n/", import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(f, dir), "utf8"));

test("pickLang matches exact, then base subtag, else en", () => {
  assert.equal(pickLang(["en", "de"], ["de-AT", "fr"]), "de");
  assert.equal(pickLang(["en", "fr"], ["fr"]), "fr");
  assert.equal(pickLang(["en"], ["xx"]), "en");
});

test("structName falls back to English", () => {
  assert.equal(structName({ names: { en: "Liver", fr: "Foie" } }, "fr"), "Foie");
  assert.equal(structName({ names: { en: "Liver" } }, "nl"), "Liver");
});

test("every language file parses and has no keys unknown to en.json", () => {
  const en = Object.keys(read("en.json"));
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json")) {
    const keys = Object.keys(read(f));
    const extra = keys.filter((k) => !en.includes(k));
    assert.deepEqual(extra, [], `${f} has keys missing from en.json`);
    const missing = en.filter((k) => !keys.includes(k));
    if (missing.length) console.warn(`${f}: ${missing.length} untranslated keys (fall back to en)`);
  }
});

test("index.json lists all seven launch languages, each with a file", () => {
  const codes = read("index.json").map((l) => l.code);
  assert.deepEqual(codes, ["en", "de", "es", "ar", "fr", "it", "nl"]);
  for (const c of codes) read(`${c}.json`);
  assert.equal(read("index.json").find((l) => l.code === "ar").dir, "rtl");
});
