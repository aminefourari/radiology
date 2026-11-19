// 3D mesh decoding and visibility rules. DOM-free so Node can test it.

// buf: decompressed mesh.bin.gz; index: meshes.json. Positions come back in RAS mm.
export function decodeMeshes(buf, { box, meshes }) {
  const out = new Map();
  for (const m of meshes) {
    const q = new Uint16Array(buf, m.offset, m.vertexCount * 3);
    const positions = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) {
      const k = i % 3;
      positions[i] = box[k] + (q[i] / 65535) * (box[k + 3] - box[k]);
    }
    const indices = new Uint16Array(buf, m.offset + m.vertexCount * 6, m.indexCount);
    out.set(m.id, { positions, indices, anchor: m.anchor, size: m.size });
  }
  return out;
}

// Which meshes to draw, with colour and opacity. Mirrors overlay.colorTable: a parent (liver) is
// drawn as its own union mesh unless its children's system (segments) is on, then as the children.
export function meshVisibility(structures, systemsOn, hidden, faded, isolated, meshIds) {
  const kids = new Map();
  for (const s of structures) if (s.parent) kids.set(s.parent, [...(kids.get(s.parent) ?? []), s]);
  const out = new Map();
  for (const s of structures) {
    if (!meshIds.has(s.id) || hidden.has(s.id) || !systemsOn.has(s.system)) continue;
    if (kids.get(s.id)?.some((c) => systemsOn.has(c.system))) continue;
    if (isolated && s.id !== isolated) continue;
    out.set(s.id, { color: s.color, opacity: faded.has(s.id) ? 0.15 : 1 });
  }
  return out;
}
