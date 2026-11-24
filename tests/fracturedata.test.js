// Fracture pages: content and shapes agree, every citation resolves, every 3D key exists in the atlas.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { typeFragments } from "../site/js/fracturegeom.js";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const LANGS = read("site/i18n/index.json").map((l) => l.code);
const shapes = read("site/fracture/shapes.json");
const atlas = new Map(read("site/atlas/index.json").structures.map((s) => [s.key, s]));

for (const id of Object.keys(shapes)) { // shapes.json order is the page order
  const f = read(`site/fracture/${id}.json`), sh = shapes[id];

  test(`${id}: titles in every language, types and approaches match the shapes`, () => {
    for (const lang of LANGS) assert.ok(f.title[lang]?.trim(), `title ${lang}`);
    for (const ty of f.types) for (const lang of LANGS) assert.ok(ty.title[lang]?.trim(), `${ty.code} title ${lang}`);
    assert.deepEqual(f.types.map((t) => t.code).sort(), Object.keys(sh.types).sort());
    assert.deepEqual(f.approaches.map((a) => a.id).sort(), Object.keys(sh.approaches).sort());
    for (const ty of f.types) assert.ok(ty.approach === null || f.approaches.some((a) => a.id === ty.approach), `${ty.code} approach`);
    for (const ty of f.types) assert.ok(["op", "nonop", "either"].includes(ty.management), `${ty.code} management`);
  });

  test(`${id}: every cited reference exists and has a year and a link`, () => {
    const ids = new Set(f.refs.map((r) => r.id));
    const cited = [f.classification.refs, ...f.types.map((t) => t.refs), ...f.decide.map((d) => d.refs), ...f.approaches.map((a) => a.refs), f.after.refs].flat().filter(Boolean);
    assert.deepEqual(cited.filter((r) => !ids.has(r)), []);
    for (const r of f.refs) assert.ok(r.year && r.url && r.cite && r.kind, `ref ${r.id}`);
  });

  test(`${id}: 3D keys exist in the atlas and every type resolves`, () => {
    const keys = [sh.bone, ...sh.context, ...(sh.fade ?? []), ...f.approaches.flatMap((a) => a.atRisk.map((r) => r.key))];
    for (const code of Object.keys(sh.types)) {
      const frags = typeFragments(sh, code);
      keys.push(...frags.map((x) => x.bone).filter(Boolean));
      for (const x of frags) for (const c of x.cuts) assert.ok(c.n.some((v) => v !== 0), `${code} cut normal`);
    }
    assert.deepEqual(keys.filter((k) => !atlas.has(k)), []);
    for (const ap of Object.values(sh.approaches)) for (const line of ap.incisions) assert.ok(line.length >= 2 && line.every((p) => p.length === 3));
  });
}
