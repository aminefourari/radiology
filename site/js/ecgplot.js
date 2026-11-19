// ECG paper geometry. DOM-free. Units: time in s, paper in mm, signal in µV.

export const ROW_MM = 25;
const GRID_3X4 = [["I", "aVR", "V1", "V4"], ["II", "aVL", "V2", "V5"], ["III", "aVF", "V3", "V6"]];
const ORDER = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];

// Panels to draw: each lead from t0 to t1 on a row. x on paper = t * speed, so 3×4 columns line up in time.
export function panels(duration, layout) {
  if (layout === "12x1") return ORDER.map((lead, row) => ({ lead, row, t0: 0, t1: duration }));
  const col = duration / 4;
  const out = [];
  GRID_3X4.forEach((leads, row) => leads.forEach((lead, c) => out.push({ lead, row, t0: c * col, t1: (c + 1) * col })));
  out.push({ lead: "II", row: 3, t0: 0, t1: duration }); // rhythm strip
  return out;
}

export function paperMm(duration, speed, layout) {
  return { w: duration * speed, h: (layout === "12x1" ? 12 : 4) * ROW_MM };
}

// Flat [x0,y0,x1,y1,…] in px for one panel. Row midline sits at (row + 0.5) * ROW_MM.
export function tracePoints(samples, fs, { row, t0, t1 }, { speed, gain, ppm }) {
  const i0 = Math.max(0, Math.round(t0 * fs)), i1 = Math.min(samples.length - 1, Math.round(t1 * fs));
  const mid = (row + 0.5) * ROW_MM * ppm;
  const pts = new Float32Array((i1 - i0 + 1) * 2);
  for (let i = i0, k = 0; i <= i1; i++, k += 2) {
    pts[k] = (i / fs) * speed * ppm;
    pts[k + 1] = mid - (samples[i] / 1000) * gain * ppm;
  }
  return pts;
}

// Caliper readout from a drag of (dx, dy) px.
export function measure(dx, dy, { speed, gain, ppm }) {
  const ms = (Math.abs(dx) / ppm / speed) * 1000;
  return { ms: Math.round(ms), bpm: ms > 0 ? Math.round(60000 / ms) : null, mv: Math.round((Math.abs(dy) / ppm / gain) * 100) / 100 };
}

// SVG path "M x y L x y …" from flat points, 2 decimals (paper mm → 0.01 mm is plenty).
export function pathData(pts) {
  let d = "";
  for (let k = 0; k < pts.length; k += 2) d += `${k ? "L" : "M"}${pts[k].toFixed(2)} ${pts[k + 1].toFixed(2)}`;
  return d;
}

// Wave bands ({k, on, off} in samples) clipped to one panel → rects in paper mm.
export function waveBands(waves, fs, { row, t0, t1 }, speed) {
  const out = [];
  for (const w of waves) {
    const a = Math.max(w.on / fs, t0), b = Math.min(w.off / fs, t1);
    if (b > a) out.push({ k: w.k, x: a * speed, w: (b - a) * speed, y: row * ROW_MM, h: ROW_MM });
  }
  return out;
}
