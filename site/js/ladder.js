// Ladder (Lewis) diagram geometry from simulation events. DOM-free.
// Rows: A (atria) y 0–1, AV (node + His) y 1–2, V (ventricles) y 2–3. Lines run from (t0, y0) to (t1, y1).

const TIER_MS = 20; // slant of the atrial and ventricular lines

export function ladderLines(events) {
  const out = [];
  const line = (row, t0, y0, t1, y1, extra = {}) => out.push({ row, t0, y0, t1, y1, blocked: false, retro: false, ...extra });
  let lastV = null;
  for (const e of events) {
    if (e.type === "P") {
      line("A", e.t0, 0, e.t0 + TIER_MS, 1);
      if (e.origin === "retro" && lastV) line("AV", lastV.t0, 2, e.t0, 1, { retro: true });
    } else if (e.type === "AV") line("AV", e.t0, 1, e.t1, 2);
    else if (e.type === "blocked") line("AV", e.t0, 1, e.level === "his" ? e.t1 : e.t0 + (e.t1 - e.t0) / 2, e.level === "his" ? 1.9 : 1.5, { blocked: true });
    else if (e.type === "QRS") { line("V", e.t0, 2, e.t0 + TIER_MS, 3); lastV = e; }
  }
  return out;
}
