// Label-map colouring. DOM-free.

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// 256×RGBA lookup: own colour if own system on, else parent's if the parent's system is on.
export function colorTable(structures, systemsOn, hidden) {
  const table = new Uint8Array(256 * 4);
  const byId = new Map(structures.map((s) => [s.id, s]));
  const shown = (s) => s && systemsOn.has(s.system) && !hidden.has(s.id);
  for (const s of structures) {
    if (hidden.has(s.id)) continue;
    const src = shown(s) ? s : shown(byId.get(s.parent)) ? byId.get(s.parent) : null;
    if (!src) continue;
    table.set([...hexToRgb(src.color), 255], s.id * 4);
  }
  return table;
}

export function visibleIds(table) {
  const ids = new Set();
  for (let i = 1; i < 256; i++) if (table[i * 4 + 3]) ids.add(i);
  return ids;
}

export function compositeOverlay(rgba, labels, table, opacity, mode, w, h) {
  const outline = mode === "outline";
  const a = outline ? 1 : opacity;
  for (let r = 0, i = 0; r < h; r++) {
    for (let c = 0; c < w; c++, i++) {
      const id = labels[i];
      if (!id || !table[id * 4 + 3]) continue;
      if (outline &&
        (c > 0 ? labels[i - 1] : id) === id && (c < w - 1 ? labels[i + 1] : id) === id &&
        (r > 0 ? labels[i - w] : id) === id && (r < h - 1 ? labels[i + w] : id) === id) continue;
      const j = i * 4, t = id * 4;
      rgba[j] += (table[t] - rgba[j]) * a;
      rgba[j + 1] += (table[t + 1] - rgba[j + 1]) * a;
      rgba[j + 2] += (table[t + 2] - rgba[j + 2]) * a;
    }
  }
}
