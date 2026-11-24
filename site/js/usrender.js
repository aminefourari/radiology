// Ultrasound image from a CT + label volume. DOM-free.
// How a real scanner forms the picture, in miniature:
//  1. each sample along a scan line holds random-phase scatterers (tissue backscatter) plus a coherent echo where the
//     acoustic impedance jumps (organ capsules, bone and gas surfaces), all scaled by what the beam has lost so far;
//  2. the beam's point-spread function (short along the beam, wider across it and widest away from the focus)
//     sums them coherently, which is what makes speckle look like speckle;
//  3. envelope, time-gain compensation, log compression to a 60 dB display.
// Shadows, enhancement, reverberation and the vessels inside organs all come from that model and the CT, never per view.
import { nearest, trilinear } from "./usgeom.js";

export const FAN = { sectorDeg: 60, radiusMm: 50, lines: 192, samples: 512, freqMHz: 3.5 };

// Tuning constants, set by eye against real FAST images.
const SOFT_A = 0.5;      // dB/cm/MHz the time-gain compensation assumes
const SPEC = 0.35;       // coherent echo per unit amplitude reflection coefficient
const REF = 0.22;        // envelope shown as full white at 0 dB gain
const DR = 60;           // displayed dynamic range, dB
const GAMMA = 1.15;      // grey map: a touch of contrast in the mid-tones
const REVERB = 0.5;      // each gas reverberation relative to the one before
const DIRTY = 0.004;     // low-level "dirty" shadow under gas
const SRI = 0.55;         // speckle reduction, as scanners do: share of a 3×3 log-domain mean mixed in
const CLUTTER = 0.18;    // near-field reverberation of the strongest shallow interface
const GAS_HU = -300, BONE_HU = 300;
const VESSEL_DHU = 45;   // inside an organ, this much above its mean HU is a contrast-filled vessel
const SUBCUT_MM = 25;    // fat this close under the skin is subcutaneous (greyer); deeper fat has septa and is bright
const FAT_HU = -40;      // inside an organ, below this is fat (renal sinus, fissures)
const HU_DB = 0.12;      // dB of backscatter per HU away from the tissue's mean: CT texture becomes echo texture
const JITTER = 0.6;      // mm: dithers label edges so the beam blur makes them smooth, not voxel steps
const PSF_AX = 0.45;     // mm, axial σ of the pulse (~1 mm resolution at 3.5 MHz)
const BEAM_W0 = 0.7, BEAM_ZR = 40; // mm: beam σ at the focus (~2 mm resolution), and how fast it widens off focus

export function makeTissueLUT(tissues, structures) {
  const lut = new Float32Array(256 * 4).fill(-1);
  const parenchyma = new Uint8Array(256);
  const prefixes = Object.entries(tissues.byPrefix || {});
  const par = tissues.parenchyma || [];
  for (const s of structures) {
    const t = tissues.byKey?.[s.key] || prefixes.find(([p]) => s.key.startsWith(p))?.[1];
    if (t) lut.set([t.b, t.a, t.z, t.tex], s.id * 4);
    if (par.some((k) => s.key === k || s.key.startsWith(k))) parenchyma[s.id] = 1;
  }
  return { lut, parenchyma };
}

// Mean HU of every label: the reference that lets vessels and fat inside an organ stand out.
export function labelMeanHU(ct, labels) {
  const sum = new Float64Array(256), n = new Float64Array(256), out = new Float32Array(256);
  for (let i = 0; i < labels.length; i++) { sum[labels[i]] += ct[i]; n[labels[i]]++; }
  for (let i = 0; i < 256; i++) out[i] = n[i] ? sum[i] / n[i] : 0;
  return out;
}

const COS = new Float32Array(256), SIN = new Float32Array(256), RAYLEIGH = new Float32Array(65536);
for (let i = 0; i < 256; i++) { COS[i] = Math.cos((i / 256) * 2 * Math.PI); SIN[i] = Math.sin((i / 256) * 2 * Math.PI); }
for (let i = 0; i < 65536; i++) RAYLEIGH[i] = Math.sqrt(-Math.log((i + 0.5) / 65536));

const GREY = new Uint8Array(4096);
for (let i = 0; i < 4096; i++) GREY[i] = Math.round(Math.pow(i / 4095, GAMMA) * 255);

function hash(x, y, z, seed) {
  let h = Math.imul(x, 0x8da6b343) ^ Math.imul(y, 0xd8163841) ^ Math.imul(z, 0xcb1ab31f) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296; // [0, 1)
}

// Rayleigh-distributed value tied to the body: one per 0.4 mm cell of world space.
export function speckle(x, y, z) {
  const u = hash(Math.floor(x / 0.4), Math.floor(y / 0.4), Math.floor(z / 0.4), 0) + 1 / 4294967296;
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

const gaussKernel = (sigma, step, maxTaps) => {
  const n = Math.min(maxTaps, Math.max(1, Math.ceil((2.5 * sigma) / step)));
  const w = [];
  for (let j = -n; j <= n; j++) w.push(Math.exp(-((j * step) ** 2) / (2 * sigma * sigma)));
  const l2 = Math.sqrt(w.reduce((s, v) => s + v * v, 0)); // unit energy: speckle keeps its level, edges add up
  return w.map((v) => v / l2);
};

// labelsOut (optional, Uint8Array lines*samples) receives the structure label at each sample, for overlays.
// huRef (optional, from labelMeanHU) turns on vessels and fat inside organs.
export function renderFan(vol, frame, { depthMm, gainDb = 0, amounts, lut, parenchyma = null, huRef = null, tissues }, out, labelsOut = null) {
  const { lines, samples, freqMHz: f, radiusMm: R } = FAN;
  const { ct, labels, fluid, dims, spacing } = vol;
  const ds = depthMm / samples, dsCm = ds / 10;
  const att = (a) => Math.pow(10, (-2 * a * f * dsCm) / 20);
  const T = (t) => [t.b, att(t.a), t.z, t.tex];
  const FL = T(tissues.fluid), GAS = T(tissues.gas), BONE = T(tissues.bone), BLOOD = T(tissues.blood || tissues.fluid);
  const byHU = tissues.byHU.map(([hi, t]) => [hi, T(t)]);
  const FAT = byHU[0][1], DEEP_FAT = T(tissues.deepFat || tissues.byHU[0][1]);
  const lutT = [];
  for (let i = 0; i < 256; i++) lutT.push(lut[i * 4] >= 0 ? [lut[i * 4], att(lut[i * 4 + 1]), lut[i * 4 + 2], lut[i * 4 + 3]] : null);
  const huHi = byHU.map(([hi]) => hi), huT = byHU.map(([, t]) => t);
  const gain = Math.pow(10, gainDb / 20);
  const tgc = new Float32Array(samples);
  for (let k = 0; k < samples; k++) tgc[k] = gain * Math.pow(10, (2 * SOFT_A * f * (sampleDepth(k, depthMm) / 10)) / 20);
  const re = new Float32Array(lines * samples), im = new Float32Array(lines * samples);
  const env = new Float32Array(lines * samples);
  const gas = new Int32Array(lines).fill(-1), gasE = new Float32Array(lines);
  const nearK = new Int32Array(lines).fill(-1), nearE = new Float32Array(lines);
  const useVessels = !!(huRef && parenchyma);

  for (let i = 0; i < lines; i++) {
    const { origin: o, dir } = fanRay(frame, i, lines);
    let I = 1, zPrev = -1, touched = false, skinD = 0; // touched: the line has reached the body, at depth skinD
    for (let k = 0, q = i * samples; k < samples; k++, q++) {
      const d = sampleDepth(k, depthMm);
      const x = o[0] + d * dir[0], y = o[1] + d * dir[1], z = o[2] + d * dir[2];
      const hu = trilinear(ct, dims, spacing, x, y, z, NaN);
      if (Number.isNaN(hu)) { if (labelsOut) labelsOut[q] = 0; continue; }
      // Scatterer cell and a dithered position for the label / fluid lookups.
      const cx = Math.floor(x * 4), cy = Math.floor(y * 4), cz = Math.floor(z * 4);
      const hj = hash(cx, cy, cz, 11) * 1073741824; // 30 random bits → three 10-bit jitters
      const jx = x + ((hj & 1023) / 511.5 - 1) * JITTER, jy = y + (((hj >>> 10) & 1023) / 511.5 - 1) * JITTER, jz = z + (((hj >>> 20) & 1023) / 511.5 - 1) * JITTER;
      let t = null, isGas = false, lab = -1, fatW = -1;
      const fv = fluid ? nearest(fluid, dims, spacing, jx, jy, jz) : 0;
      if (fv && (fv & 3) <= (amounts[fv >> 2] || 0)) t = FL;
      // Air before the line first meets the body is the gel between the curved probe face and the skin.
      else if (hu < GAS_HU) { if (!touched) t = FL; else { t = GAS; isGas = true; } }
      if (hu >= GAS_HU && !touched) { touched = true; skinD = d; }
      if (!t) {
        lab = nearest(labels, dims, spacing, jx, jy, jz);
        if (useVessels && parenchyma[lab] && hu - huRef[lab] > VESSEL_DHU) t = BLOOD;
        else if (useVessels && parenchyma[lab] && hu < FAT_HU) t = DEEP_FAT;
        else if (lut[lab * 4] >= 0) t = lutT[lab];
        else if (hu > BONE_HU) t = BONE;
        else if (useVessels && !lab && hu > 150) t = BLOOD; // unlabelled contrast-filled vessel
        else { let j = 0; while (j < huHi.length - 1 && hu >= huHi[j]) j++; t = huT[j]; if (j === 0) fatW = Math.max(0, Math.min(1, (d - skinD - SUBCUT_MM) / 20)); }
        if (t[2] < 0.01) isGas = true; // labelled lung
      }
      if (labelsOut) labelsOut[q] = nearest(labels, dims, spacing, x, y, z);
      let b = fatW >= 0 ? t[0] + (DEEP_FAT[0] - t[0]) * fatW : t[0]; // fat brightens gradually below the subcutaneous layer
      const tex = t[3], zz = t[2];
      if (useVessels && lab > 0 && t === lutT[lab]) b *= Math.exp(Math.max(-6, Math.min(6, (hu - huRef[lab]) * HU_DB)) * 0.11512925); // dB → amplitude
      if (zPrev < 0) zPrev = zz;
      const r = (zz - zPrev) / (zz + zPrev);
      // complex scatterer amplitude: Box-Muller from two body-fixed uniforms
      const hs = hash(cx, cy, cz, 1) * 16777216; // 24 bits: 16 for the magnitude, 8 for the phase
      const rr = RAYLEIGH[hs >>> 8], ph = hs & 255; // |g| ~ Rayleigh, E|g|² = 1, uniform phase
      const amp = b * (tex * rr + (1 - tex) * 0.886); // tex blends magnitude spread; phase is always random (scatter, not mirror)
      re[q] = I * (r * SPEC + amp * COS[ph]);
      im[q] = I * amp * SIN[ph];
      if (d < 25 && Math.abs(r) > nearE[i] && !isGas) { nearE[i] = Math.abs(r) * I * SPEC; nearK[i] = k; }
      if (isGas && gas[i] < 0) { gas[i] = k; gasE[i] = I * Math.abs(r) * SPEC; } // the gas echo itself, before the beam is lost
      I *= (1 - r * r) * t[1];
      zPrev = zz;
    }
  }

  // Beam point-spread: axial (short pulse), then lateral (depth-dependent beam width), coherently.
  const ax = gaussKernel(PSF_AX, ds, 6), na = (ax.length - 1) / 2;
  const tr = new Float32Array(samples), ti = new Float32Array(samples);
  for (let i = 0; i < lines; i++) {
    const base = i * samples;
    for (let k = 0; k < samples; k++) {
      let sr = 0, si = 0;
      for (let j = -na; j <= na; j++) {
        const kk = k + j;
        if (kk < 0 || kk >= samples) continue;
        sr += ax[j + na] * re[base + kk]; si += ax[j + na] * im[base + kk];
      }
      tr[k] = sr; ti[k] = si;
    }
    re.set(tr, base); im.set(ti, base);
  }
  const focus = Math.min(120, Math.max(40, 0.6 * depthMm));
  const dTheta = ((FAN.sectorDeg * Math.PI) / 180) / (lines - 1);
  const dirAmp = new Float32Array(lines);
  for (let i = 0; i < lines; i++) dirAmp[i] = Math.pow(Math.cos(((FAN.sectorDeg / 2 - FAN.sectorDeg * i / (lines - 1)) * Math.PI) / 180), 1.5);
  const colR = new Float32Array(lines), colI = new Float32Array(lines);
  for (let k = 0; k < samples; k++) {
    const d = sampleDepth(k, depthMm);
    const sigma = BEAM_W0 * Math.sqrt(1 + ((d - focus) / BEAM_ZR) ** 2);
    const w = gaussKernel(sigma, (R + d) * dTheta, 8), nl = (w.length - 1) / 2;
    for (let i = 0; i < lines; i++) { colR[i] = re[i * samples + k]; colI[i] = im[i * samples + k]; }
    for (let i = 0; i < lines; i++) {
      let sr = 0, si = 0;
      const j0 = Math.max(-nl, -i), j1 = Math.min(nl, lines - 1 - i);
      for (let j = j0; j <= j1; j++) { const wj = w[j + nl]; sr += wj * colR[i + j]; si += wj * colI[i + j]; }
      env[i * samples + k] = Math.sqrt(sr * sr + si * si) * tgc[k] * dirAmp[i];
    }
  }

  // Artefacts that add incoherently on the envelope.
  for (let i = 0; i < lines; i++) {
    const base = i * samples;
    if (nearK[i] > 0) { // near-field clutter: the strongest shallow interface echoes back and forth
      for (let n = 2, amp = nearE[i] * CLUTTER; amp > 1e-4; n++, amp *= CLUTTER) {
        const kk = Math.round(n * (nearK[i] + 0.5) - 0.5);
        if (kk >= samples) break;
        for (let j = -2; j <= 2; j++) if (kk + j >= 0 && kk + j < samples) env[base + kk + j] += amp * tgc[kk + j] * speckle(i * 0.4, (kk + j) * 0.4, 1.7) * (1 - Math.abs(j) / 3);
      }
    }
    const g = gas[i];
    if (g < 0) continue;
    // Below gas: a low "dirty" shadow and reverberations, shown at the gas line's level (not re-amplified by TGC).
    const g0 = tgc[g] * gasE[i];
    for (let k = g + 1; k < samples; k++) env[base + k] += g0 * DIRTY * 0.6 * speckle(i * 0.4, k * 0.4, 0.2);
    for (let n = 2, amp = REVERB; ; n++, amp *= REVERB) {
      const kk = Math.round(n * (g + 0.5) - 0.5);
      if (kk >= samples) break;
      for (let j = -1; j <= 2; j++) if (kk + j < samples) env[base + kk + j] += g0 * SPEC * amp * (j === 0 ? 1 : 0.6);
    }
  }

  // Log compression, light speckle reduction (as scanners do), grey map.
  const lg = new Float32Array(env.length);
  const lnK = 20 / Math.LN10 / DR, lnRef = Math.log(REF);
  for (let q = 0; q < env.length; q++) lg[q] = env[q] > 0 ? 1 + (Math.log(env[q]) - lnRef) * lnK : -1;
  for (let i = 0; i < lines; i++) {
    for (let k = 0; k < samples; k++) {
      const q = i * samples + k;
      let g = lg[q];
      if (g > -1) {
        let sum = 0, n = 0;
        for (let di = -1; di <= 1; di++) {
          const ii = i + di;
          if (ii < 0 || ii >= lines) continue;
          for (let dk = -1; dk <= 1; dk++) {
            const kk = k + dk;
            if (kk < 0 || kk >= samples) continue;
            const v = lg[ii * samples + kk];
            if (v > -1) { sum += v; n++; }
          }
        }
        g = (1 - SRI) * g + (SRI * sum) / n;
      }
      out[q] = g <= 0 ? 0 : g >= 1 ? 255 : GREY[(g * 4095) | 0];
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
