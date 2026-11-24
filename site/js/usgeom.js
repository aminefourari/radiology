// Ultrasound geometry: sampling a volume at world positions, and the probe's frame. DOM-free.
// World = mm in the case grid: pos = index * spacing (RAS+: x = patient's right, y = anterior, z = superior).
// Volumes are flat [z][y][x], dims = [X, Y, Z].

export function trilinear(vol, [X, Y, Z], [sx, sy, sz], x, y, z, outside) {
  const fx = x / sx, fy = y / sy, fz = z / sz;
  if (!(fx >= 0 && fy >= 0 && fz >= 0 && fx <= X - 1 && fy <= Y - 1 && fz <= Z - 1)) return outside;
  const x0 = Math.min(fx | 0, X - 2 < 0 ? 0 : X - 2), y0 = Math.min(fy | 0, Y - 2 < 0 ? 0 : Y - 2), z0 = Math.min(fz | 0, Z - 2 < 0 ? 0 : Z - 2);
  const dx = fx - x0, dy = fy - y0, dz = fz - z0;
  const ox = X > 1 ? 1 : 0, oy = Y > 1 ? X : 0, oz = Z > 1 ? X * Y : 0;
  const i = z0 * X * Y + y0 * X + x0;
  const c00 = vol[i] + (vol[i + ox] - vol[i]) * dx;
  const c10 = vol[i + oy] + (vol[i + oy + ox] - vol[i + oy]) * dx;
  const c01 = vol[i + oz] + (vol[i + oz + ox] - vol[i + oz]) * dx;
  const c11 = vol[i + oz + oy] + (vol[i + oz + oy + ox] - vol[i + oz + oy]) * dx;
  const c0 = c00 + (c10 - c00) * dy, c1 = c01 + (c11 - c01) * dy;
  return c0 + (c1 - c0) * dz;
}

export function nearest(vol, [X, Y, Z], [sx, sy, sz], x, y, z) {
  const ix = Math.round(x / sx), iy = Math.round(y / sy), iz = Math.round(z / sz);
  if (ix < 0 || iy < 0 || iz < 0 || ix >= X || iy >= Y || iz >= Z) return 0;
  return vol[iz * X * Y + iy * X + ix];
}

// Row r, column c samples origin + c*step*u + r*step*v (trilinear; -1024 outside).
export function samplePlane(vol, dims, spacing, origin, u, v, w, h, step, out) {
  for (let r = 0, o = 0; r < h; r++) {
    for (let c = 0; c < w; c++, o++) {
      const a = c * step, b = r * step;
      out[o] = trilinear(vol, dims, spacing,
        origin[0] + a * u[0] + b * v[0], origin[1] + a * u[1] + b * v[1], origin[2] + a * u[2] + b * v[2], -1024);
    }
  }
  return out;
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

// Rotate v about unit axis k by deg (right-handed, Rodrigues).
export function rotate(v, k, deg) {
  const t = (deg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
  const kv = cross(k, v), d = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
  return [0, 1, 2].map((i) => v[i] * c + kv[i] * s + k[i] * d * (1 - c));
}

// Probe frame from a skin point {p, n (inward normal)} and the student's angles.
// Start: beam b = n, marker m = +z projected off n. rot spins m about b (+90 on an anterior probe = marker to
// the patient's right); rock tilts b toward m (in the image plane); fan tilts b toward e (out of the plane).
export function poseFrame({ p, n }, { rock = 0, fan = 0, rot = 0 }) {
  let b = norm(n);
  let m = [-b[2] * b[0], -b[2] * b[1], 1 - b[2] * b[2]];
  m = Math.hypot(...m) < 1e-6 ? [0, 1, 0] : norm(m); // a beam straight up or down has no "head" direction
  m = rotate(m, b, -rot); // +rot: head → patient's right (+x) for an anterior probe
  let e = cross(b, m);
  [b, m] = [rotate(b, e, rock), rotate(m, e, rock)];
  [b, e] = [rotate(b, m, -fan), rotate(e, m, -fan)];
  b = norm(b); m = norm(m);
  return { p: [...p], b, m, e: cross(b, m) };
}
