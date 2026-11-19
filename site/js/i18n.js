// Translations. Pure helpers are DOM-free; loadStrings/applyDir touch fetch/document only when called.

let strings = {}, fallback = {}, languages = [];

export function pickLang(available, preferred) {
  for (const p of preferred) if (available.includes(p)) return p;
  for (const p of preferred) {
    const base = String(p).split("-")[0].toLowerCase();
    if (available.includes(base)) return base;
  }
  return "en";
}

const LANG_KEY = "atlas.lang";

// The language last picked in a selector. Storage can be blocked (private mode, file://): never throw.
export function savedLang() {
  try { return localStorage.getItem(LANG_KEY); } catch { return null; }
}

export function saveLang(lang) {
  try { localStorage.setItem(LANG_KEY, lang); } catch { /* blocked: choice lasts for this page only */ }
}

// A link's #lang= wins, then the last pick, then the browser's languages.
export function startLang(codes, linkLang) {
  const nav = globalThis.navigator;
  return pickLang(codes, [linkLang, savedLang(), ...(nav?.languages ?? [nav?.language])].filter(Boolean));
}

export async function loadLanguages(base = "i18n") {
  languages = await (await fetch(`${base}/index.json`)).json();
  return languages;
}

export async function loadStrings(lang, base = "i18n") {
  const get = async (l) => { try { return await (await fetch(`${base}/${l}.json`)).json(); } catch { return {}; } };
  [fallback, strings] = await Promise.all([get("en"), lang === "en" ? null : get(lang)]);
  strings ??= fallback;
}

export function t(key, vars = {}) {
  const s = strings[key] ?? fallback[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
}

export function structName(structure, lang) {
  return structure.names?.[lang] || structure.names?.en || structure.key;
}

export function localized(names, lang) {
  return names?.[lang] || names?.en || "";
}

export function applyDir(lang) {
  const info = languages.find((l) => l.code === lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = info?.dir || "ltr";
}
