// Echo page state <-> URL hash. DOM-free.
// #w=ruq&p=<zMm>,<theta>,<rock>,<fan>,<rot>&d=160&g=0&f=0102&l=1&lang=en

export const ECHO_DEFAULTS = { win: null, pose: null, depth: 160, gain: 0, fluid: [0, 0, 0, 0], labels: true, lang: null };
const POSE_KEYS = ["zMm", "theta", "rock", "fan", "rot"];

export function parseEchoHash(hash) {
  let q;
  try { q = new URLSearchParams(String(hash).replace(/^#/, "")); } catch { q = new URLSearchParams(); }
  const num = (k) => (q.has(k) && q.get(k) !== "" ? Number(q.get(k)) : null);
  const p = q.get("p");
  return {
    win: q.get("w"),
    pose: p ? Object.fromEntries(POSE_KEYS.map((k, i) => [k, Number(p.split(",")[i] || NaN)])) : null,
    depth: num("d"),
    gain: num("g"),
    fluid: q.has("f") ? [...q.get("f").padEnd(4, "0").slice(0, 4)].map((c) => Number(c)) : null,
    labels: q.has("l") ? q.get("l") !== "0" : null,
    lang: q.get("lang"),
  };
}

const clamp = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const wrap180 = (v) => ((((v + 180) % 360) + 360) % 360) - 180;

export function clampEchoState(s, { windows, outline, langs }) {
  const w = windows.find((x) => x.key === s.win) || windows[0];
  const t = w.target, p = s.pose || {};
  const pose = {
    zMm: clamp(p.zMm, outline.zMin, outline.zMax, clamp(t.zMm, outline.zMin, outline.zMax, outline.zMin)),
    theta: Number.isFinite(p.theta) ? wrap180(p.theta) : t.theta,
    rock: clamp(p.rock, -60, 60, t.rock),
    fan: clamp(p.fan, -80, 80, t.fan),
    rot: Number.isFinite(p.rot) ? ((p.rot % 360) + 360) % 360 : t.rot,
  };
  return {
    win: w.key,
    pose,
    depth: Math.round(clamp(s.depth, 80, 240, ECHO_DEFAULTS.depth)),
    gain: clamp(s.gain, -20, 20, ECHO_DEFAULTS.gain),
    fluid: (s.fluid || ECHO_DEFAULTS.fluid).map((v) => Math.round(clamp(v, 0, 2, 0))),
    labels: s.labels ?? ECHO_DEFAULTS.labels,
    lang: langs.includes(s.lang) ? s.lang : null,
  };
}

const r1 = (v) => Math.round(v * 10) / 10;

export function formatEchoHash(s) {
  const q = new URLSearchParams();
  q.set("w", s.win);
  if (s.pose) q.set("p", POSE_KEYS.map((k) => r1(s.pose[k])).join(","));
  q.set("d", s.depth);
  q.set("g", r1(s.gain));
  q.set("f", s.fluid.join(""));
  q.set("l", s.labels ? "1" : "0");
  if (s.lang) q.set("lang", s.lang);
  return "#" + q.toString().replaceAll("%2C", ",");
}
