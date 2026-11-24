// Ultrasound image from a CT + label volume: per scan line, a 1-D pulse-echo model. DOM-free.
// Every feature comes from the physics: interface echoes from impedance jumps, shadows from what bone and gas
// let through, enhancement because fluid barely attenuates while TGC assumes soft tissue, reverberation from
// the gas surface bouncing back to the probe face.
import { nearest, trilinear } from "./usgeom.js";

export const FAN = { sectorDeg: 60, radiusMm: 50, lines: 192, samples: 384, freqMHz: 3.5 };

// Tuning constants (Task 9 sets these by eye against textbook FAST images).
const SOFT_A = 0.5;      // dB/cm/MHz the time-gain compensation assumes
const SPEC = 0.6;        // specular gain on interface echoes
const REF = 0.25;        // echo amplitude shown as full white at 0 dB gain
const DR = 50;           // displayed dynamic range, dB
const REVERB = 0.5;      // each reverberation's amplitude relative to the one before
const DIRTY = 0.004;     // low-level "dirty" shadow under gas
const GAS_HU = -300, BONE_HU = 300;

export function makeTissueLUT(tissues, structures) {
  const lut = new Float32Array(256 * 4).fill(-1);
  const prefixes = Object.entries(tissues.byPrefix || {});
  for (const s of structures) {
    const t = tissues.byKey?.[s.key] || prefixes.find(([p]) => s.key.startsWith(p))?.[1];
    if (t) lut.set([t.b, t.a, t.z, t.tex], s.id * 4);
  }
  return { lut };
}

// Rayleigh-distributed speckle tied to the body: one value per 0.4 mm cell of world space.
export function speckle(x, y, z) {
  let h = Math.imul(Math.floor(x / 0.4), 0x8da6b343) ^ Math.imul(Math.floor(y / 0.4), 0xd8163841) ^ Math.imul(Math.floor(z / 0.4), 0xcb1ab31f);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  h ^= h >>> 16;
  const u = ((h >>> 0) + 1) / 4294967297; // (0, 1)
  return Math.sqrt(-2 * Math.log(u));
}

// Scan line i: leaves a virtual apex radiusMm behind the skin point; line 0 is tilted toward the marker.
export function fanRay(frame, i, lines = FAN.lines) {
  const a = ((FAN.sectorDeg / 2 - (FAN.sectorDeg * i) / (lines - 1)) * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a), { p, b, m } = frame;
  const dir = [c * b[0] + s * m[0], c * b[1] + s * m[1], c * b[2] + s * m[2]];
  const R = FAN.radiusMm;
  return { origin: [0, 1, 2].map((k) => p[k] - R * b[k] + R * dir[k]), dir };
}

export function sampleDepth(k, depthMm) {
  return ((k + 0.5) * depthMm) / FAN.samples;
}

// labelsOut (optional, Uint8Array lines*samples) receives the structure label at each sample, for overlays.
export function renderFan(vol, frame, { depthMm, gainDb = 0, amounts, lut, tissues }, out, labelsOut = null) {
  const { lines, samples, freqMHz: f } = FAN;
  const { ct, labels, fluid, dims, spacing } = vol;
  const ds = depthMm / samples, dsCm = ds / 10;
  const att = (a) => Math.pow(10, (-2 * a * f * dsCm) / 20);
  const T = (t) => [t.b, att(t.a), t.z, t.tex];
  const FL = T(tissues.fluid), GAS = T(tissues.gas), BONE = T(tissues.bone);
  const byHU = tissues.byHU.map(([hi, t]) => [hi, T(t)]);
  const SOFT = byHU[byHU.length - 1][1];
  const lutT = [];
  for (let i = 0; i < 256; i++) lutT.push(lut[i * 4] >= 0 ? [lut[i * 4], att(lut[i * 4 + 1]), lut[i * 4 + 2], lut[i * 4 + 3]] : null);
  const huHi = byHU.map(([hi]) => hi), huT = byHU.map(([, t]) => t);
  const gain = Math.pow(10, gainDb / 20);
  const tgc = new Float32Array(samples);
  for (let k = 0; k < samples; k++) tgc[k] = gain * Math.pow(10, (2 * SOFT_A * f * (sampleDepth(k, depthMm) / 10)) / 20);
  const all = new Float32Array(lines * samples); // linear echo, before lateral blur and compression

  for (let i = 0; i < lines; i++) {
    const { origin: o, dir } = fanRay(frame, i, lines);
    const lin = all.subarray(i * samples, (i + 1) * samples);
    let I = 1, zPrev = -1, gasAt = -1, gasE = 0, touched = false; // touched: the line has reached the body
    for (let k = 0; k < samples; k++) {
      const d = sampleDepth(k, depthMm);
      const x = o[0] + d * dir[0], y = o[1] + d * dir[1], z = o[2] + d * dir[2];
      const hu = trilinear(ct, dims, spacing, x, y, z, NaN);
      if (Number.isNaN(hu)) { lin[k] = 0; if (labelsOut) labelsOut[i * samples + k] = 0; continue; }
      let lab = -1;
      let b, at, zz, tex, gas = false;
      const fv = fluid ? nearest(fluid, dims, spacing, x, y, z) : 0;
      let t = null;
      if (fv && (fv & 3) <= (amounts[fv >> 2] || 0)) t = FL;
      // Air before the line first meets the body is the gel between the curved probe face and the skin.
      else if (hu < GAS_HU) { if (!touched) t = FL; else { t = GAS; gas = true; } }
      if (hu >= GAS_HU) touched = true;
      if (!t) {
        lab = nearest(labels, dims, spacing, x, y, z);
        if (lut[lab * 4] >= 0) t = lutT[lab];
        else if (hu > BONE_HU) t = BONE;
        else { let j = 0; while (j < huHi.length - 1 && hu >= huHi[j]) j++; t = huT[j]; }
        if (t[2] < 0.01) gas = true; // labelled lung
      }
      b = t[0]; at = t[1]; zz = t[2]; tex = t[3];
      if (labelsOut) labelsOut[i * samples + k] = lab >= 0 ? lab : nearest(labels, dims, spacing, x, y, z);
      if (zPrev < 0) zPrev = zz;
      const r = (zz - zPrev) / (zz + zPrev);
      const e = I * (Math.abs(r) * SPEC + b * (1 - tex + tex * speckle(x, y, z)));
      I *= (1 - r * r) * at;
      if (gas && gasAt < 0) { gasAt = k; gasE = e; }
      lin[k] = e;
      zPrev = zz;
    }
    if (gasAt >= 0) {
      // Artefacts below gas are displayed at the gas line's level, not re-amplified by TGC with depth.
      const g0 = tgc[gasAt];
      for (let k = gasAt + 1; k < samples; k++) lin[k] += (gasE * DIRTY * 0.6 * speckle(i * 0.4, k * 0.4, 0.2) * g0) / tgc[k];
      for (let n = 2, amp = gasE * REVERB; ; n++, amp *= REVERB) {
        const kk = Math.round(n * (gasAt + 0.5) - 0.5);
        if (kk >= samples) break;
        for (let j = -1; j <= 2; j++) if (kk + j < samples) lin[kk + j] += (amp * (j === 0 ? 1 : 0.6) * g0) / tgc[kk + j];
      }
    }
    // Pulse length: a short blur along the beam.
    for (let k = 0, prev = lin[0]; k < samples; k++) {
      const cur = lin[k], next = k + 1 < samples ? lin[k + 1] : cur;
      lin[k] = (prev + 2 * cur + next) / 4;
      prev = cur;
    }
  }
  // Beam width: lateral resolution is coarser than axial, so speckle smears across neighbouring lines.
  for (let i = 0; i < lines; i++) {
    const a = all.subarray(Math.max(0, i - 1) * samples), c = all.subarray(i * samples), b = all.subarray(Math.min(lines - 1, i + 1) * samples);
    for (let k = 0; k < samples; k++) {
      const v = ((a[k] + 2 * c[k] + b[k]) / 4) * tgc[k];
      const g = v > 0 ? 1 + (20 * Math.log10(v / REF)) / DR : 0;
      out[i * samples + k] = g <= 0 ? 0 : g >= 1 ? 255 : Math.round(g * 255);
    }
  }
  return out;
}

// Map each output pixel to (fractional) polar coordinates. Marker side (line 0) on the image left.
export function scanMap(depthMm, W, H) {
  const { lines, samples, radiusMm: R } = FAN;
  const half = ((FAN.sectorDeg / 2) * Math.PI) / 180;
  const wMm = 2 * (R + depthMm) * Math.sin(half), top = R * Math.cos(half), hMm = R + depthMm - top;
  const mmPerPx = Math.max(wMm / W, hMm / H);
  const line = new Int32Array(W * H).fill(-1), sample = new Int32Array(W * H);
  const fl = new Float32Array(W * H), fs = new Float32Array(W * H);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const x = (px + 0.5 - W / 2) * mmPerPx, y = top + (py + 0.5) * mmPerPx;
      const ang = (Math.atan2(-x, y) * 180) / Math.PI;
      const li = ((FAN.sectorDeg / 2 - ang) / FAN.sectorDeg) * (lines - 1);
      const sk = ((Math.hypot(x, y) - R) / depthMm) * samples - 0.5;
      if (li < 0 || li > lines - 1 || sk < -0.5 || sk > samples - 0.5) continue;
      const o = py * W + px, l0 = Math.min(Math.floor(li), lines - 2), s0 = Math.max(0, Math.min(Math.floor(sk), samples - 2));
      line[o] = l0; sample[o] = s0; fl[o] = li - l0; fs[o] = Math.max(0, Math.min(1, sk - s0));
    }
  }
  return { W, H, line, sample, fl, fs, mmPerPx, topMm: top, depthMm };
}

export function scanConvert(polar, map, rgba) {
  const S = FAN.samples, { line, sample, fl, fs } = map;
  for (let o = 0, q = 0; o < line.length; o++, q += 4) {
    let v = 0;
    if (line[o] >= 0) {
      const i = line[o] * S + sample[o], a = fl[o], b = fs[o];
      v = (polar[i] * (1 - b) + polar[i + 1] * b) * (1 - a) + (polar[i + S] * (1 - b) + polar[i + S + 1] * b) * a;
    }
    rgba[q] = rgba[q + 1] = rgba[q + 2] = v;
    rgba[q + 3] = 255;
  }
  return rgba;
}

// Depth scale: one tick every 2 cm, as a fraction of the image height (same geometry as scanMap).
export function depthTicks(depthMm, W, H) {
  const half = ((FAN.sectorDeg / 2) * Math.PI) / 180, R = FAN.radiusMm;
  const top = R * Math.cos(half), mmPerPx = Math.max((2 * (R + depthMm) * Math.sin(half)) / W, (R + depthMm - top) / H);
  const out = [];
  for (let cm = 2; cm * 10 <= depthMm; cm += 2) out.push({ cm, frac: (R + cm * 10 - top) / mmPerPx / H });
  return out;
}
