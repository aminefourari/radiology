// Landing page: language picker + translated text. Chosen language carries into the atlases via #lang=.
import { applyDir, loadLanguages, loadStrings, pickLang, t } from "./i18n.js";
import { REPO_URL } from "./report.js";

const sel = document.getElementById("lang-select");

async function setLang(lang) {
  await loadStrings(lang);
  applyDir(lang);
  sel.value = lang;
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  document.querySelectorAll("[data-t-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.tAria)));
  document.title = t("home.title");
  document.querySelectorAll(".tile").forEach((a) => (a.hash = `lang=${lang}`));
}

const langs = await loadLanguages();
const codes = langs.map((l) => l.code);
const fromHash = new URLSearchParams(location.hash.slice(1)).get("lang");
sel.replaceChildren(...langs.map((l) => new Option(l.name, l.code)));
sel.onchange = () => setLang(sel.value);
if (REPO_URL) Object.assign(document.getElementById("repo-link"), { hidden: false, href: REPO_URL });
await setLang(codes.includes(fromHash) ? fromHash : pickLang(codes, navigator.languages || [navigator.language]));
