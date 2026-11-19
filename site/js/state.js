// View state <-> URL hash. DOM-free.
import { PLANES, sliceCount } from "./volume.js";

export const DEFAULTS = { case: null, lang: null, plane: "axial", slice: null, sys: null, zoom: 1 };

export function parseHash(hash) {
  let q;
  try { q = new URLSearchParams(String(hash).replace(/^#/, "")); } catch { q = new URLSearchParams(); }
  const num = (k) => (q.has(k) && q.get(k) !== "" ? Number(q.get(k)) : null);
  return {
    case: q.get("case") || DEFAULTS.case,
    lang: q.get("lang") || DEFAULTS.lang,
    plane: q.get("plane") || DEFAULTS.plane,
    slice: num("slice"),
    sys: q.has("sys") ? q.get("sys").split(",").filter(Boolean) : DEFAULTS.sys,
    zoom: num("zoom") ?? DEFAULTS.zoom,
  };
}

// systems/defaultSystems come from the loaded case; null before a case is loaded.
export function clampState(s, { cases, langs, dims, systems = null, defaultSystems = null }) {
  const plane = PLANES.includes(s.plane) ? s.plane : "axial";
  let slice = s.slice;
  if (dims) {
    const n = sliceCount(dims, plane);
    slice = Number.isFinite(slice) ? Math.min(n - 1, Math.max(0, Math.round(slice))) : Math.floor(n / 2);
  }
  const zoom = Number.isFinite(s.zoom) ? Math.min(8, Math.max(0.25, s.zoom)) : 1;
  return {
    case: cases.includes(s.case) ? s.case : cases[0] ?? null,
    lang: langs.includes(s.lang) ? s.lang : null,
    plane,
    slice,
    sys: !systems ? s.sys : s.sys == null ? [...(defaultSystems ?? [])] : systems.filter((k) => s.sys.includes(k)),
    zoom,
  };
}

export function formatHash(s) {
  const q = new URLSearchParams();
  for (const k of ["case", "lang", "plane", "slice", "zoom"]) if (s[k] != null) q.set(k, s[k]);
  if (s.sys) q.set("sys", s.sys.join(","));
  return "#" + q.toString().replaceAll("%2C", ",");
}
