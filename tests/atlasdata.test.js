import { test } from "node:test";
import assert from "node:assert/strict";
import { atlasVisibility, tissueOf, siteToAtlas, atlasToSite, caseFor, sliceMm, ctToAtlas } from "../site/js/atlasdata.js";

const S = [
  { key: "liver", system: "digestive", color: "#7a2f25" },
  { key: "seg_iv", system: "digestive", color: "#7a2f25", parent: "liver" },
  { key: "femur_left", system: "skeleton", color: "#e2d5bb" },
  { key: "aorta", system: "vessels", color: "#b8302c" },
];
const none = new Set();
const vis = (sys, { hidden = none, faded = none, isolated = null } = {}) =>
  atlasVisibility(S, new Set(sys), hidden, faded, isolated);
const keys = (m) => [...m.keys()].sort();

test("only structures of systems that are on are drawn, with their tissue", () => {
  const m = vis(["skeleton", "vessels"]);
  assert.deepEqual(keys(m), ["aorta", "femur_left"]);
  assert.deepEqual(m.get("femur_left"), { color: "#e2d5bb", tissue: "bone", opacity: 1 });
  assert.equal(m.get("aorta").tissue, "vessel");
});

test("hidden are omitted, faded see-through, isolate keeps one", () => {
  assert.deepEqual(keys(vis(["skeleton", "vessels"], { hidden: new Set(["aorta"]) })), ["femur_left"]);
  assert.equal(vis(["skeleton"], { faded: new Set(["femur_left"]) }).get("femur_left").opacity, 0.15);
  assert.deepEqual(keys(vis(["skeleton", "vessels"], { isolated: "aorta" })), ["aorta"]);
  assert.equal(vis([], { isolated: "aorta" }).size, 0);
});

test("parts show only once their parent is hidden, or when isolated", () => {
  assert.deepEqual(keys(vis(["digestive"])), ["liver"]);
  assert.deepEqual(keys(vis(["digestive"], { hidden: new Set(["liver"]) })), ["seg_iv"]);
  assert.deepEqual(keys(vis(["digestive"], { isolated: "seg_iv" })), ["seg_iv"]);
});

test("tissue by system", () => {
  assert.equal(tissueOf("nervous"), "nerve");
  assert.equal(tissueOf("joints"), "cartilage");
  assert.equal(tissueOf("muscles"), "muscle");
  assert.equal(tissueOf("digestive"), "organ");
});

const links = { liver: ["liver"], liver_segment_4: ["seg_iv"], colon: ["a", "b"] };

test("site <-> atlas lookups", () => {
  assert.deepEqual(siteToAtlas(links, "colon"), ["a", "b"]);
  assert.deepEqual(siteToAtlas(links, "nope"), []);
  assert.equal(atlasToSite(links, "b"), "colon");
  assert.equal(atlasToSite(links, "liver"), "liver");
  assert.equal(atlasToSite(links, "zzz"), null);
});

test("caseFor prefers the current case, else the first case labelling it", () => {
  const cases = [{ id: "a", keys: new Set(["liver"]) }, { id: "b", keys: new Set(["liver", "colon"]) }];
  assert.equal(caseFor("liver", "b", cases), "b");
  assert.equal(caseFor("colon", "a", cases), "b");
  assert.equal(caseFor("brain", "a", cases), null);
});

test("slice index to mm and through the fit", () => {
  assert.equal(sliceMm("axial", 10, [1, 1, 2]), 21);
  assert.equal(sliceMm("sagittal", 0, [3, 1, 2]), 1.5);
  assert.deepEqual(ctToAtlas({ x: null, y: null, z: [2, 5] }, "axial", 10), { axis: "z", value: 25 });
  assert.deepEqual(ctToAtlas({ x: null, y: [1, -3], z: null }, "coronal", 10), { axis: "y", value: 7 });
  assert.equal(ctToAtlas({ x: null, y: null, z: null }, "sagittal", 3), null);
  assert.equal(ctToAtlas(null, "axial", 3), null);
});
