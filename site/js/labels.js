// Label anchors and leader-line layout. DOM-free.
// Sides are image sides (left half → left column), never text direction, so RTL never mirrors them.

export function anchors(labels, w, h, ids) {
  const acc = new Map();
  for (let r = 0, i = 0; r < h; r++) {
    for (let c = 0; c < w; c++, i++) {
      const id = labels[i];
      if (!id || !ids.has(id)) continue;
      let a = acc.get(id);
      if (!a) acc.set(id, (a = { sx: 0, sy: 0, n: 0 }));
      a.sx += c; a.sy += r; a.n++;
    }
  }
  const out = new Map();
  for (const [id, { sx, sy, n }] of acc) {
    let x = Math.round(sx / n), y = Math.round(sy / n);
    if (labels[y * w + x] !== id) [x, y] = nearest(labels, w, h, id, x, y);
    out.set(id, { x, y, area: n });
  }
  return out;
}

// ponytail: full scan for the nearest pixel; only runs for non-convex shapes, fine at slice sizes.
function nearest(labels, w, h, id, x0, y0) {
  let best = [x0, y0], bd = Infinity;
  for (let r = 0, i = 0; r < h; r++) {
    for (let c = 0; c < w; c++, i++) {
      if (labels[i] !== id) continue;
      const d = (c - x0) ** 2 + (r - y0) ** 2;
      if (d < bd) { bd = d; best = [c, r]; }
    }
  }
  return best;
}

export function layoutLabels(anchorMap, w, h, lineHeight) {
  const sides = { left: [], right: [] };
  for (const [id, { x, y }] of anchorMap) sides[x < w / 2 ? "left" : "right"].push({ id, side: x < w / 2 ? "left" : "right", ax: x, ay: y, y });
  const out = [];
  for (const col of Object.values(sides)) {
    if (col.length * lineHeight > h) return null;
    col.sort((a, b) => a.ay - b.ay);
    const lo = lineHeight / 2, hi = h - lineHeight / 2;
    col.forEach((l, i) => { l.y = Math.max(l.ay, lo, i ? col[i - 1].y + lineHeight : lo); });
    for (let i = col.length - 1; i >= 0; i--) col[i].y = Math.min(col[i].y, i === col.length - 1 ? hi : col[i + 1].y - lineHeight);
    out.push(...col);
  }
  return out;
}

// Columns spanned by the body (HU > threshold), ignoring columns with only a few such pixels
// (CT table, noise). Right is exclusive. Falls back to the full width.
export function bodyExtent(ct, w, h, threshold) {
  const min = Math.max(1, Math.ceil(h * 0.03));
  let left = -1, right = -1;
  for (let c = 0; c < w; c++) {
    let n = 0;
    for (let r = 0; r < h && n < min; r++) if (ct[r * w + c] > threshold) n++;
    if (n >= min) { if (left < 0) left = c; right = c + 1; }
  }
  return left < 0 ? { left: 0, right: w } : { left, right };
}
