// 3D atlas rules: what to draw, site <-> atlas links, CT slice -> atlas plane. DOM-free so Node can test it.
import { PLANES } from "./volume.js";

const TISSUE = { skeleton: "bone", joints: "cartilage", muscles: "muscle", vessels: "vessel", nervous: "nerve" };
export const tissueOf = (system) => TISSUE[system] ?? "organ";

// structures: index.json structures. A part (parent set, e.g. a liver segment) lies inside its parent, so it
// is drawn only once the parent is hidden, or when it is isolated.
export function atlasVisibility(structures, systemsOn, hidden, faded, isolated) {
  const out = new Map();
  for (const s of structures) {
    if (!systemsOn.has(s.system) || hidden.has(s.key)) continue;
    if (isolated ? s.key !== isolated : s.parent && !hidden.has(s.parent)) continue;
    out.set(s.key, { color: s.color, tissue: tissueOf(s.system), opacity: faded.has(s.key) ? 0.15 : 1 });
  }
  return out;
}

export const siteToAtlas = (links, siteKey) => links[siteKey] ?? [];

// First site key in file order whose list has it; the map lists parents before their parts.
export function atlasToSite(links, atlasKey) {
  for (const [site, atlas] of Object.entries(links)) if (atlas.includes(atlasKey)) return site;
  return null;
}

// cases: [{ id, keys: Set of site structure keys }]
export function caseFor(siteKey, currentId, cases) {
  const has = cases.filter((c) => c.keys.has(siteKey));
  return (has.find((c) => c.id === currentId) ?? has[0])?.id ?? null;
}

const AXIS = { axial: 2, coronal: 1, sagittal: 0 };
export const sliceMm = (plane, slice, spacing) => (slice + 0.5) * spacing[AXIS[plane]];

// fit: atlaslink.json ({ x: [a, b] | null, y, z }). null when that axis has no fit.
export function ctToAtlas(fit, plane, mm) {
  const axis = "xyz"[AXIS[plane]];
  const f = fit?.[axis];
  return PLANES.includes(plane) && f ? { axis, value: f[0] * mm + f[1] } : null;
}
