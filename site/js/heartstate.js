// Page state for heart.html: URL hash, rhythm search, the clock under the tracing. DOM-free.

export const MODES = ["closeup", "strip", "12"];
export const HEART_MODES = ["slice", "3d", "torso"];
export const SECTIONS = ["outside", "4ch", "sax"];
export const COLOURS = ["state", "time"];
export const SPEEDS = [0.1, 0.2, 0.5, 1];
export const CATEGORIES = ["sinus", "atrial", "junctional", "avblock", "bundle", "preexcitation", "ventricular", "paced", "other"];
const LEADS = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
export const DEFAULTS = { rhythm: "nsr", compare: null, mode: "closeup", ladder: true, heart: "slice", section: "4ch", level: 0.5,
  colour: "state", conduction: true, vector: true, speed: 0.2, t: 0, leads: ["I", "V1", "V6"], split: 0.5 };

const pick = (v, list, d) => (list.includes(v) ? v : d);
const num = (v, lo, hi, d) => (v != null && v !== "" && Number.isFinite(+v) && +v >= lo && +v <= hi ? +v : d);

// Unknown keys (e.g. the old what-if flags) are ignored; bad values fall back to the defaults.
export function parseHash(hash, rhythmKeys) {
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const leads = (h.get("leads") ?? "").split(",");
  return {
    rhythm: pick(h.get("rhythm"), rhythmKeys, DEFAULTS.rhythm),
    compare: pick(h.get("compare"), rhythmKeys, null),
    mode: pick(h.get("mode"), MODES, DEFAULTS.mode),
    ladder: h.get("ladder") !== "0",
    heart: pick(h.get("heart"), HEART_MODES, DEFAULTS.heart),
    section: pick(h.get("section"), SECTIONS, DEFAULTS.section),
    level: num(h.get("level"), 0, 1, DEFAULTS.level),
    colour: pick(h.get("colour"), COLOURS, DEFAULTS.colour),
    conduction: h.get("conduction") !== "0",
    vector: h.get("vector") !== "0",
    speed: SPEEDS.includes(+h.get("speed")) && h.has("speed") ? +h.get("speed") : DEFAULTS.speed,
    t: num(h.get("t"), 0, 60000, 0),
    leads: leads.length === 3 && leads.every((l) => LEADS.includes(l)) ? leads : DEFAULTS.leads,
    split: num(h.get("split"), 0, 1, DEFAULTS.split),
  };
}

export function formatHash(st) {
  const h = new URLSearchParams();
  for (const [k, d] of Object.entries(DEFAULTS)) {
    const v = st[k];
    if (k === "leads" ? v.join() === d.join() : v === d) continue;
    h.set(k, typeof v === "boolean" ? (v ? "1" : "0") : k === "leads" ? v.join(",") : k === "t" ? Math.round(v) : v);
  }
  const s = h.toString();
  return s ? `#${s}` : "";
}

// Case- and accent-insensitive match on the title (in the page language and in English) and on the key.
const fold = (s) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
export function filterRhythms(list, query, lang) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return list.filter((r) => {
    const hay = fold(`${r.key} ${r.title[lang] ?? ""} ${r.title.en}`);
    return words.every((w) => hay.includes(w));
  });
}

// "N ms after the SA node fires": the latest impulse origin at or before t. Null when there is none (AF, VF).
export function clockLabel(sim, t) {
  if (sim.af || sim.vf) return null;
  let best = null;
  for (const e of sim.events) if (e.type === "fire" && e.t0 <= t && (!best || e.t0 >= best.t0)) best = e;
  return best ? { ms: Math.round(t - best.t0), origin: best.origin } : null;
}

// The close-up shows the tracing a page at a time, like a monitor: [t0, t1) containing t.
export const CLOSEUP_MS = 1200;
export function closeupWindow(t, duration) {
  const t0 = Math.min(Math.floor(t / CLOSEUP_MS) * CLOSEUP_MS, Math.max(0, duration - CLOSEUP_MS));
  return [t0, Math.min(duration, t0 + CLOSEUP_MS)];
}
