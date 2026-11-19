import { test } from "node:test";
import assert from "node:assert/strict";
import { ecgReportUrl, reportUrl } from "../site/js/report.js";

test("report URL is a prefilled GitHub new-issue link", () => {
  const share = "https://example.org/#case=s1&plane=axial&slice=120";
  const url = reportUrl("https://github.com/o/r", {
    caseId: "s1", structureKey: "liver", structureName: "Liver", lang: "en", plane: "axial", slice: 120, shareUrl: share,
  });
  assert.ok(url.startsWith("https://github.com/o/r/issues/new?"));
  const q = new URL(url).searchParams;
  assert.equal(q.get("title"), "[s1] Liver (liver)");
  assert.ok(q.get("body").includes("slice: 120"));
  assert.ok(q.get("body").includes(share));
  assert.equal(q.get("labels"), "label-report");
});

test("ECG report URL names the ECG, the item and the view", () => {
  const url = ecgReportUrl("https://github.com/o/r", { ecgId: 687, item: "clue 1: ST elevation", lang: "fr", shareUrl: "https://x/ecg.html#ecg=687" });
  const q = new URL(url).searchParams;
  assert.equal(q.get("title"), "[ECG 687] clue 1: ST elevation");
  assert.equal(q.get("labels"), "label-report");
  for (const line of ["ecg: 687", "item: clue 1: ST elevation", "language: fr", "view: https://x/ecg.html#ecg=687"]) assert.ok(q.get("body").includes(line), line);
});
