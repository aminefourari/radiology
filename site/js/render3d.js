// 3D surface view of the label map by ray casting. DOM-free so Node can test it.
// ponytail: CPU ray casting at reduced resolution; move to WebGL if it is too slow on phones.

// Voxel box [x0, y0, z0, x1, y1, z1) holding any label, or null if the map is empty.
export function labelBounds(labels, [X, Y, Z]) {
  let x0 = X, y0 = Y, z0 = Z, x1 = -1, y1 = -1, z1 = -1;
  for (let z = 0, i = 0; z < Z; z++) {
    for (let y = 0; y < Y; y++) {
      for (let x = 0; x < X; x++, i++) {
        if (!labels[i]) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (z < z0) z0 = z;
        z1 = z;
      }
    }
  }
  return x1 < 0 ? null : [x0, y0, z0, x1 + 1, y1 + 1, z1 + 1];
}

// yaw 0, pitch 0 is the anterior view in radiological convention: patient right on screen left.
// r = screen right, u = screen up, d = view direction, all in RAS mm.
export function camera(yaw, pitch) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  return { r: [-cy, -sy, 0], u: [sy * sp, -cy * sp, cp], d: [sy * cp, -cy * cp, -sp] };
}

// Casts a W×H grid of parallel rays through the box; fills ids (first visible label) and
// depth (mm from the near plane). visible[id] != 0 marks labels to draw.
export function castRays(labels, dims, spacing, visible, box, { yaw, pitch, mmPerPx, panX = 0, panY = 0 }, W, H, ids, depth) {
  const [X, Y] = dims;
  const { r, u, d } = camera(yaw, pitch);
  const c = [0, 1, 2].map((k) => ((box[k] + box[k + 3]) / 2) * spacing[k]);
  const radius = Math.hypot(...[0, 1, 2].map((k) => (box[k + 3] - box[k]) * spacing[k])) / 2;
  const step = Math.min(...spacing);
  const dv = [0, 1, 2].map((k) => (d[k] * step) / spacing[k]); // voxels per step
  ids.fill(0);
  depth.fill(Infinity);
  for (let py = 0, o = 0; py < H; py++) {
    const b = (H / 2 - py - 0.5 + panY) * mmPerPx;
    for (let px = 0; px < W; px++, o++) {
      const a = (px + 0.5 - W / 2 - panX) * mmPerPx;
      const ov = [0, 1, 2].map((k) => (c[k] + r[k] * a + u[k] * b - d[k] * radius) / spacing[k]);
      // Slab test: clip the ray to the box, in steps.
      let t0 = 0, t1 = (2 * radius) / step;
      for (let k = 0; k < 3; k++) {
        if (dv[k] === 0) {
          if (ov[k] < box[k] || ov[k] >= box[k + 3]) t1 = -1;
          continue;
        }
        const ta = (box[k] - ov[k]) / dv[k], tb = (box[k + 3] - ov[k]) / dv[k];
        t0 = Math.max(t0, Math.min(ta, tb));
        t1 = Math.min(t1, Math.max(ta, tb));
      }
      for (let t = Math.ceil(t0); t < t1; t++) {
        const x = Math.floor(ov[0] + t * dv[0]), y = Math.floor(ov[1] + t * dv[1]), z = Math.floor(ov[2] + t * dv[2]);
        if (x < box[0] || y < box[1] || z < box[2] || x >= box[3] || y >= box[4] || z >= box[5]) continue;
        const id = labels[(z * Y + y) * X + x];
        if (id && visible[id]) { ids[o] = id; depth[o] = t * step; break; }
      }
    }
  }
}

// Colours each hit by its label and lights it with normals taken from the depth buffer.
export function shade(ids, depth, table, W, H, mmPerPx, selected, out) {
  const L = [-0.35, -0.45, 0.82]; // light from upper left, towards the viewer
  const at = (i, o) => (ids[i] ? depth[i] : depth[o]);
  for (let y = 0, o = 0; y < H; y++) {
    for (let x = 0; x < W; x++, o++) {
      const j = o * 4, id = ids[o];
      out[j + 3] = 255;
      if (!id) { out[j] = out[j + 1] = out[j + 2] = 0; continue; }
      const gx = (at(x < W - 1 ? o + 1 : o, o) - at(x > 0 ? o - 1 : o, o)) / (2 * mmPerPx);
      const gy = (at(y < H - 1 ? o + W : o, o) - at(y > 0 ? o - W : o, o)) / (2 * mmPerPx);
      const lambert = Math.max(0, (gx * L[0] + gy * L[1] + L[2]) / Math.hypot(gx, gy, 1));
      const k = 0.25 + 0.75 * lambert, lift = id === selected ? 90 : 0;
      for (let n = 0; n < 3; n++) out[j + n] = table[id * 4 + n] * k + lift;
    }
  }
}
