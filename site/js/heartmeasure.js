// Waveform measuring on simulated leads (for tests and captions). DOM-free. Windows are [i0, i1) samples.

// Local extrema with |v| >= min, in order; consecutive same-sign extrema merge into the larger one.
export function peaks(sig, i0, i1, min = 0.05) {
  const out = [];
  const end = Math.min(i1, sig.length);
  for (let i = Math.max(i0, 1); i < end - 1; i++) {
    const v = sig[i];
    if (Math.abs(v) < min) continue;
    const isMax = v > 0 && v >= sig[i - 1] && v > sig[i + 1];
    const isMin = v < 0 && v <= sig[i - 1] && v < sig[i + 1];
    if (!isMax && !isMin) continue;
    const last = out.at(-1);
    if (last && Math.sign(last.v) === Math.sign(v)) {
      if (Math.abs(v) > Math.abs(last.v)) out[out.length - 1] = { i, v };
    } else out.push({ i, v });
  }
  return out;
}

// QRS letters: positive = r/R (a second one r′/R′), negative before the first positive = q/Q, after = s/S;
// capital when at least half the largest deflection. All negative = "QS".
export function qrsShape(sig, i0, i1) {
  const p = peaks(sig, i0, i1);
  if (!p.length) return "";
  if (p.every((x) => x.v < 0)) return "QS";
  const big = Math.max(...p.map((x) => Math.abs(x.v)));
  let s = "", pos = 0;
  for (const { v } of p) {
    const letter = v > 0 ? (pos++ ? "r′" : "r") : pos ? "s" : "q";
    s += Math.abs(v) >= 0.5 * big ? letter.toUpperCase() : letter;
  }
  return s;
}

export function netArea(sig, i0, i1, fs = 500) {
  let a = 0;
  for (let i = i0; i < Math.min(i1, sig.length); i++) a += sig[i];
  return a / fs;
}

// ms from the window start to 80 % of the first positive peak (linear interpolation). Long = slurred (delta).
export function upstrokeMs(sig, i0, i1, fs = 500) {
  const first = peaks(sig, i0, i1).find((x) => x.v > 0);
  if (!first) return NaN;
  const level = 0.8 * first.v;
  for (let i = i0 + 1; i <= first.i; i++) {
    if (sig[i] >= level) {
      const x = i - 1 + (level - sig[i - 1]) / (sig[i] - sig[i - 1]);
      return Math.round(((x - i0) / fs) * 1000);
    }
  }
  return NaN;
}

// Frontal QRS axis in degrees from the net areas of I and aVF.
export const axisDeg = (leads, i0, i1) => (Math.atan2(netArea(leads.aVF, i0, i1), netArea(leads.I, i0, i1)) * 180) / Math.PI;
