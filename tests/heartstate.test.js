import { test } from "node:test";
import assert from "node:assert/strict";
import { applyWhatIf, formatHash, parseHash, toggleWhatIf } from "../site/js/heartstate.js";

const KEYS = ["nsr", "rbbb", "afib"];
const NSR = { duration: 4000, sinus: { cycle: 800 }, avDelay: 90 };

test("parseHash falls back to defaults for unknown or bad values", () => {
  const s = parseHash("#rhythm=foo&view=bar&t=-5&speed=3", KEYS);
  assert.deepEqual([s.rhythm, s.view, s.speed, s.t], ["nsr", "outside", 0.2, 0]);
  assert.equal(parseHash("#t=Infinity", KEYS).t, 0);
  assert.deepEqual(s.whatIf, { cutRbb: false, cutLbb: false, avDelay: 160, blockNode: false, accessory: false, extraBeat: false });
});

test("what-ifs only apply to the normal heart", () => {
  assert.equal(parseHash("#rhythm=rbbb&cutLbb=1", KEYS).whatIf.cutLbb, false);
  assert.equal(parseHash("#rhythm=nsr&cutLbb=1", KEYS).whatIf.cutLbb, true);
});

test("formatHash round-trips and omits defaults", () => {
  const h = "#rhythm=nsr&view=4ch&speed=0.5&t=1200&cutRbb=1&avDelay=250";
  assert.deepEqual(parseHash(formatHash(parseHash(h, KEYS)), KEYS), parseHash(h, KEYS));
  assert.equal(formatHash(parseHash("", KEYS)), "");
});

test("applyWhatIf names what the heart has become", () => {
  const off = parseHash("", KEYS).whatIf;
  assert.deepEqual(applyWhatIf(NSR, off), { model: NSR, becomes: "nsr" });
  const r = applyWhatIf(NSR, { ...off, cutRbb: true });
  assert.equal(r.becomes, "rbbb");
  assert.deepEqual(r.model.cut, ["rbb"]);
  const d = applyWhatIf(NSR, { ...off, avDelay: 250 });
  assert.equal(d.becomes, "1avb");
  assert.ok(d.model.avDelay > NSR.avDelay);
  assert.equal(applyWhatIf(NSR, { ...off, blockNode: true }).becomes, "3avb_node");
  assert.equal(applyWhatIf(NSR, { ...off, accessory: true }).model.accessory, true);
  assert.equal(applyWhatIf(NSR, { ...off, extraBeat: true }).model.ectopic.length, 1);
  const both = applyWhatIf(NSR, { ...off, cutRbb: true, cutLbb: true });
  assert.equal(both.becomes, "3avb");
  assert.equal(both.model.escape.site, "ventricle");
  assert.equal(applyWhatIf(NSR, { ...off, blockNode: true }).model.escape.site, "junction");
});

test("the PR slider changes the model anywhere in its range, not only above 200 ms", () => {
  const off = parseHash("", KEYS).whatIf;
  const r = applyWhatIf(NSR, { ...off, avDelay: 130 });
  assert.equal(r.becomes, "nsr");
  assert.equal(r.model.avDelay, NSR.avDelay - 30);
});

test("what-ifs the model can't combine switch each other off", () => {
  const off = parseHash("", KEYS).whatIf;
  const a = toggleWhatIf({ ...off, cutRbb: true, accessory: true }, "blockNode", true);
  assert.deepEqual([a.blockNode, a.cutRbb, a.accessory], [true, false, false]);
  const b = toggleWhatIf({ ...off, blockNode: true, cutLbb: true }, "accessory", true);
  assert.deepEqual([b.accessory, b.blockNode, b.cutLbb], [true, false, false]);
  const c = toggleWhatIf({ ...off, cutRbb: true }, "cutLbb", true);
  assert.deepEqual([c.cutRbb, c.cutLbb], [true, true]);
  assert.equal(toggleWhatIf(off, "cutRbb", true).blockNode, false);
  // A hand-made hash with a conflict is cleaned the same way.
  assert.deepEqual(Object.entries(parseHash("#blockNode=1&accessory=1&cutRbb=1", KEYS).whatIf).filter(([, v]) => v === true).map(([k]) => k), ["blockNode"]);
});

test("the name shown is the most important change; a long PR is not named when it can't show", () => {
  const off = parseHash("", KEYS).whatIf;
  assert.equal(applyWhatIf(NSR, { ...off, avDelay: 300, extraBeat: true }).becomes, "1avb");
  assert.equal(applyWhatIf(NSR, { ...off, cutLbb: true, avDelay: 300 }).becomes, "lbbb");
  assert.equal(applyWhatIf(NSR, { ...off, accessory: true, avDelay: 300 }).becomes, "wpw");
  assert.equal(applyWhatIf(NSR, { ...off, blockNode: true, avDelay: 300 }).becomes, "3avb_node");
  const both = applyWhatIf(NSR, { ...off, cutRbb: true, cutLbb: true }).model;
  assert.deepEqual(both.cut, ["rbb", "lbb"]);
});
