// "Report a problem" → prefilled GitHub issue. No backend.

// Set to the public GitHub repo URL (e.g. "https://github.com/<owner>/<repo>") once it exists.
// Empty hides every report link in the UI.
export const REPO_URL = "https://github.com/aminefourari/radiology";

export function reportUrl(repo, { caseId, structureKey, structureName, lang, plane, slice, shareUrl }) {
  const body = [
    "**What is wrong?** (wrong label, wrong outline, wrong translation, …)",
    "",
    "",
    "---",
    `case: ${caseId}`,
    `structure: ${structureName} (${structureKey})`,
    `language: ${lang}`,
    `plane: ${plane}`,
    `slice: ${slice}`,
    `view: ${shareUrl}`,
  ].join("\n");
  const q = new URLSearchParams({ title: `[${caseId}] ${structureName} (${structureKey})`, body, labels: "label-report" });
  return `${repo}/issues/new?${q}`;
}

export function ecgReportUrl(repo, { ecgId, item, lang, shareUrl }) {
  const body = [
    "**What is wrong?** (wrong clue, wrong answer, wrong translation, …)",
    "",
    "",
    "---",
    `ecg: ${ecgId}`,
    `item: ${item}`,
    `language: ${lang}`,
    `view: ${shareUrl}`,
  ].join("\n");
  const q = new URLSearchParams({ title: `[ECG ${ecgId}] ${item}`, body, labels: "label-report" });
  return `${repo}/issues/new?${q}`;
}
