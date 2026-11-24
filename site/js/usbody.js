// The body's skin surface, for placing the probe. DOM-free.
// θ (degrees) goes round the body seen from the feet: 0 = anterior midline, +90 = patient's LEFT flank,
// −90 = patient's RIGHT flank, ±180 = back. World = mm in the case grid (pos = index * spacing).

const BODY_HU = -500;

// Largest 4-connected region of HU > BODY_HU in one axial slice (drops the table, arms, blankets).
function largestRegion(ct, X, Y, off) {
  const mark = new Int32Array(X * Y);
  const stack = new Int32Array(X * Y);
  let best = 0, bestId = 0, id = 0;
  for (let s = 0; s < X * Y; s++) {
    if (mark[s] || ct[off + s] <= BODY_HU) continue;
    id++;
    let n = 0, top = 0;
    stack[top++] = s;
    mark[s] = id;
    while (top) {
      const i = stack[--top];
      n++;
      const x = i % X;
      for (const j of [x > 0 ? i - 1 : -1, x < X - 1 ? i + 1 : -1, i - X, i + X]) {
        if (j >= 0 && j < X * Y && !mark[j] && ct[off + j] > BODY_HU) { mark[j] = id; stack[top++] = j; }
      }
    }
    if (n > best) { best = n; bestId = id; }
  }
  return { mark, id: bestId, size: best };
}

export function bodyOutline(ct, [X, Y, Z], [sx, sy, sz], nTheta = 180) {
  const cx = new Float32Array(Z), cy = new Float32Array(Z), raw = new Float32Array(Z * nTheta);
  let zLo = -1, zHi = -1;
  for (let z = 0; z < Z; z++) {
    const { mark, id, size } = largestRegion(ct, X, Y, z * X * Y);
    if (size < 50) continue;
    let mx = 0, my = 0;
    for (let i = 0; i < X * Y; i++) if (mark[i] === id) { mx += i % X; my += (i / X) | 0; }
    mx /= size; my /= size;
    cx[z] = mx * sx; cy[z] = my * sy;
    const maxR = Math.hypot(X, Y);
    for (let k = 0; k < nTheta; k++) {
      const t = ((-180 + (k * 360) / nTheta) * Math.PI) / 180, dx = Math.sin(t), dy = Math.cos(t);
      let last = 0;
      for (let r = 0; r < maxR; r += 0.5) {
        const ix = Math.round(mx + (dx * r)), iy = Math.round(my + (dy * r) * (sx / sy));
        if (ix < 0 || iy < 0 || ix >= X || iy >= Y) break;
        if (mark[iy * X + ix] === id) last = r;
      }
      raw[z * nTheta + k] = (last + 0.5) * sx; // to the outer edge of the last body voxel
    }
    if (zLo < 0) zLo = z;
    zHi = z;
  }
  // Light smoothing across neighbouring slices and angles (only slices with a body), so the probe glides.
  const r = new Float32Array(Z * nTheta);
  for (let z = Math.max(zLo, 0); z <= zHi; z++) {
    for (let k = 0; k < nTheta; k++) {
      let sum = 0, n = 0;
      for (let dz = -1; dz <= 1; dz++) {
        const zz = z + dz;
        if (zz < zLo || zz > zHi || !raw[zz * nTheta]) continue;
        for (let dk = -1; dk <= 1; dk++) { sum += raw[zz * nTheta + ((k + dk + nTheta) % nTheta)]; n++; }
      }
      r[z * nTheta + k] = n ? sum / n : 0;
    }
  }
  return { zMin: Math.max(zLo, 0) * sz, zMax: Math.max(zHi, 0) * sz, step: sz, nTheta, cx, cy, r };
}

function point(o, iz, theta) {
  const f = ((((theta + 180) % 360) + 360) % 360) / (360 / o.nTheta);
  const k0 = Math.floor(f) % o.nTheta, k1 = (k0 + 1) % o.nTheta, w = f - Math.floor(f);
  const rr = o.r[iz * o.nTheta + k0] * (1 - w) + o.r[iz * o.nTheta + k1] * w;
  const t = (theta * Math.PI) / 180;
  return [o.cx[iz] + rr * Math.sin(t), o.cy[iz] + rr * Math.cos(t), iz * o.step];
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function skinPoint(o, zMm, theta) {
  const z = Math.min(o.zMax, Math.max(o.zMin, Number.isFinite(zMm) ? zMm : (o.zMin + o.zMax) / 2));
  const th = Number.isFinite(theta) ? theta : 0;
  const iz = Math.round(z / o.step), lo = Math.round(o.zMin / o.step), hi = Math.round(o.zMax / o.step);
  const p = point(o, iz, th);
  const dTheta = sub(point(o, iz, th + 3), point(o, iz, th - 3));
  const dZ = sub(point(o, Math.min(hi, iz + 1), th), point(o, Math.max(lo, iz - 1), th));
  let n = hi > lo ? cross(dTheta, dZ) : cross(dTheta, [0, 0, 1]);
  const l = Math.hypot(...n) || 1;
  n = n.map((v) => v / l);
  if (n[0] * (o.cx[iz] - p[0]) + n[1] * (o.cy[iz] - p[1]) < 0) n = n.map((v) => -v); // point inward
  return { p, n, zMm: iz * o.step };
}

// x extent of the body per slice, in mm: left = patient's left (largest x), right = patient's right.
export function frontSilhouette(o) {
  const Z = o.cx.length, left = new Float32Array(Z), right = new Float32Array(Z), z = new Float32Array(Z);
  for (let iz = 0; iz < Z; iz++) {
    z[iz] = iz * o.step;
    if (!o.r[iz * o.nTheta]) continue;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < o.nTheta; k++) {
      const x = point(o, iz, -180 + (k * 360) / o.nTheta)[0];
      lo = Math.min(lo, x); hi = Math.max(hi, x);
    }
    left[iz] = hi; right[iz] = lo;
  }
  return { z, left, right };
}
