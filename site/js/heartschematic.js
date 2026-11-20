// The schematic heart for heart.html: a slice of the idealised heart, its walls coloured from the simulation,
// with the conduction system, numbered action-potential sites and the wavefront arrow drawn over it in SVG.
import { planeProject, sectionPlane, slicePlane, SHAPE, toLocal } from "./heartshape.js";
import { vertexState } from "./heartsim.js";
import { t as tr } from "./i18n.js";

const SVGNS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  n.append(...kids);
  return n;
};
const hex = (s) => { const v = parseInt(s.trim().replace("#", ""), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const LINE_KEYS = { his: "heart.cs.his", lbb: "heart.cs.lbb", rbb: "heart.cs.rbb", laf: "heart.cs.laf", lpf: "heart.cs.lpf" };
const CUT_PARTS = { lbb: ["lbb", "laf", "lpf"], rbb: ["rbb"], laf: ["laf"], lpf: ["lpf"], his: ["his"] };

// Isochrone colours for "activation time": red (early) → yellow → green → blue (late), 0–160 ms.
export const TIME_SPAN = 160;
export function timeColour(ms) {
  const stops = [[0, [214, 48, 49]], [50, [245, 196, 50]], [100, [76, 184, 115]], [160, [52, 101, 196]]];
  const x = Math.max(0, Math.min(TIME_SPAN, ms));
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], f = (x - a) / (b - a);
      return ca.map((c, k) => Math.round(c + (cb[k] - c) * f));
    }
  }
  return stops.at(-1)[1];
}

export function createSchematic(container, { json, grid, g }) {
  const wrap = document.createElement("div");
  wrap.className = "schematic";
  const canvas = document.createElement("canvas");
  const svg = el("svg", { class: "schematic-svg", role: "img" });
  wrap.append(canvas, svg);
  container.append(wrap);
  const ctx = canvas.getContext("2d");
  const states = new Uint8Array(g.n);
  const local = (id) => toLocal(grid.ax, [g.pos[id * 3], g.pos[id * 3 + 1], g.pos[id * 3 + 2]]);
  let opts = { section: "4ch", level: 0.5, colour: "state", conduction: true, vector: true };
  let plane, map, image, size = 0, sim = null, model = null, time = 0, overlay = null;
  let colours = null;

  function readColours() {
    const cs = getComputedStyle(wrap);
    colours = ["--heart-rest", "--heart-front", "--heart-plateau", "--heart-repol", "--heart-blood", "--heart-outline"].map((v) => hex(cs.getPropertyValue(v) || "#888888"));
  }

  function rebuild() {
    const px = Math.round(Math.min(720, Math.max(160, wrap.clientWidth * Math.min(2, devicePixelRatio || 1))));
    plane = sectionPlane(opts.section, opts.level);
    size = px;
    canvas.width = canvas.height = px;
    map = slicePlane(grid, plane, px);
    image = ctx.createImageData(px, px);
    svg.setAttribute("viewBox", `${-plane.half} ${-plane.half} ${2 * plane.half} ${2 * plane.half}`);
    readColours();
    buildOverlay();
    paint();
  }

  // Static SVG: chamber labels, conduction system, sites. Elements that change with time are kept for paint().
  function buildOverlay() {
    const P = (p) => planeProject(plane, p);
    const sax = plane.section === "sax", w = plane.origin[2];
    const near = (p, mm = 6) => !sax || Math.abs(p[2] - w) < mm;
    const labels = el("g", { class: "chambers" });
    const centres = sax
      ? [["heart.ch.rv", [46, 8, w]], ["heart.ch.lv", [0, 0, w]]]
      : [["heart.ch.ra", SHAPE.ra.c], ["heart.ch.la", SHAPE.la.c], ["heart.ch.rv", [44, 8, -28]], ["heart.ch.lv", [0, 0, -34]]];
    for (const [k, p] of centres) { const [x, y] = P(p); labels.append(el("text", { x, y, class: "chamber" }, tr(k))); }

    const segs = [], dots = [], texts = el("g", { class: "cs-labels" });
    const lineG = el("g", { class: "cs" });
    if (opts.conduction) {
      for (const [name, ids] of Object.entries(g.lineNodes)) {
        const pts = ids.map(local);
        if (sax) {
          for (let i = 1; i < pts.length; i++) {
            const a = pts[i - 1], b = pts[i];
            if ((a[2] - w) * (b[2] - w) > 0 || a[2] === b[2]) continue;
            const f = (w - a[2]) / (b[2] - a[2]);
            const [x, y] = P(a.map((v, k) => v + (b[k] - v) * f));
            const c = el("circle", { cx: x, cy: y, r: 1.6, class: "cs-node" });
            lineG.append(c); dots.push([c, ids[i]]);
            texts.append(el("text", { x: x + 2.2, y: y - 1.5, class: "cs-label" }, tr(LINE_KEYS[name])));
          }
          continue;
        }
        for (let i = 1; i < pts.length; i++) {
          const [x1, y1] = P(pts[i - 1]), [x2, y2] = P(pts[i]);
          const s = el("line", { x1, y1, x2, y2, class: "cs-seg" });
          lineG.append(s); segs.push([s, ids[i]]);
        }
        const [lx, ly] = P(pts[Math.floor(pts.length * (name === "his" ? 0.5 : 0.75))]);
        texts.append(el("text", { x: lx + 2, y: ly + (name === "lpf" ? 4 : -2), class: "cs-label" }, tr(LINE_KEYS[name])));
      }
      // Bachmann's bundle and the nodes, from their own voxels.
      if (!sax) {
        const bach = json.bachmannIds ?? [];
        for (let i = 1; i < bach.length; i++) {
          const [x1, y1] = P(grid.local[bach[i - 1]]), [x2, y2] = P(grid.local[bach[i]]);
          const s = el("line", { x1, y1, x2, y2, class: "cs-seg" });
          lineG.append(s); segs.push([s, bach[i]]);
        }
        if (bach.length) { const [x, y] = P(grid.local[bach[Math.floor(bach.length / 2)]]); texts.append(el("text", { x, y: y - 3, class: "cs-label" }, tr("heart.cs.bachmann"))); }
        for (const [key, lm] of [["heart.cs.sa", "sa"], ["heart.cs.av", "avnode"]]) {
          const [x, y] = P(grid.local[json.landmarks[lm]]);
          const c = el("circle", { cx: x, cy: y, r: 2.4, class: "cs-node" });
          lineG.append(c); dots.push([c, json.landmarks[lm]]);
          texts.append(el("text", { x: x + 3, y: y + (lm === "sa" ? -3 : 5), class: "cs-label" }, tr(key)));
        }
      }
      // Purkinje fibres: the Purkinje nodes lying close to this slice.
      let shown = 0, label = null;
      for (const [v, id] of g.purkinje) {
        const p = grid.local[v];
        const off = sax ? Math.abs(p[2] - w) : Math.abs(p[1]);
        if (off > 2.2 || (v * 7) % 3) continue;
        const [x, y] = P(p);
        const c = el("circle", { cx: x, cy: y, r: 0.7, class: "cs-node purk" });
        lineG.append(c); dots.push([c, id]); shown++;
        if (!label || y > label[1]) label = [x, y];
      }
      if (shown && label) texts.append(el("text", { x: label[0] + 2, y: label[1] + 5, class: "cs-label" }, tr("heart.cs.purkinje")));
      // Accessory pathway.
      const ap = model?.accessory ? (model.accessory === "ps" ? json.landmarks.accessory_ps : json.landmarks.accessory) : null;
      if (ap && (!sax || near(grid.local[ap[1]], 10))) {
        const [x1, y1] = P(grid.local[ap[0]]), [x2, y2] = P(grid.local[ap[1]]);
        const s = el("line", { x1, y1, x2, y2, class: "cs-seg ap" });
        lineG.append(s); segs.push([s, ap[1]]);
        texts.append(el("text", { x: x1 - 2, y: y1 - 3, class: "cs-label ap", "text-anchor": "end" }, tr("heart.cs.accessory")));
      }
    }
    // Blocked bundles: ✕ just past the start of each cut line.
    const cuts = el("g", { class: "cuts" });
    const cutNames = new Set((model?.cut ?? []).flatMap((c) => CUT_PARTS[c] ?? [c]));
    for (const name of cutNames) {
      if (sax || !g.lineNodes[name]) continue;
      const ids = g.lineNodes[name];
      const [x, y] = P(local(ids[Math.min(ids.length - 1, 2)]));
      cuts.append(el("text", { x, y, class: "cut" }, "✕"), el("text", { x: x + 4, y: y + 6, class: "cut-label" }, tr("heart.blocked", { name: tr(LINE_KEYS[name]) })));
    }
    const sites = el("g", { class: "sites" });
    [["site_ra", 1], ["site_septum", 2], ["site_lv", 3]].forEach(([k, n]) => {
      const p = grid.local[json.landmarks[k]];
      if (!near(p)) return;
      const [x, y] = P(p);
      sites.append(el("circle", { cx: x, cy: y, r: 3.4 }), el("text", { x, y }, String(n)));
    });
    const arrow = el("line", { class: "front-arrow", "marker-end": "url(#arrowhead)", x1: 0, y1: 0, x2: 0, y2: 0, visibility: "hidden" });
    const defs = el("defs", {}, el("marker", { id: "arrowhead", viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto-start-reverse" }, el("path", { d: "M0 0L10 5L0 10z" })));
    const note = !sax && opts.conduction ? el("text", { x: -plane.half + 2, y: plane.half - 3, class: "note" }, tr("heart.projected")) : "";
    svg.replaceChildren(defs, labels, lineG, texts, cuts, sites, arrow, note);
    overlay = { segs, dots, arrow };
  }

  function paint() {
    if (!sim || !map) return;
    vertexState(sim, time, states);
    const data = image.data, [rest, front, plateau, repol, blood, outline] = colours;
    const stateColour = [rest, front, plateau, repol];
    let times = null;
    if (opts.colour === "time") {
      // Per voxel: ms after its current beat started (the latest wavefront of its kind that has started), or −1.
      times = new Float32Array(g.nMesh).fill(-1);
      for (const w of sim.wavefronts) {
        if (w.t0 > time) continue;
        for (let v = 0; v < g.nMesh; v++) { const a = w.act[v]; if (a <= time) times[v] = a - w.t0; }
      }
    }
    const fx = [0, 0, 0], bx = [0, 0, 0];
    for (let i = 0, n = map.node.length; i < n; i++) {
      const o = i * 4, v = map.node[i], a = map.alpha[i];
      let c = null, alpha = 0;
      if (v >= 0 && a > 0) {
        c = times ? (times[v] >= 0 ? timeColour(times[v]) : rest) : stateColour[states[v]];
        alpha = a;
        if (states[v] === 1) { fx[0] += i % size; fx[1] += Math.floor(i / size); fx[2]++; }
      }
      if (map.cavity[i] && a < 1) { c = c ? c.map((x, k) => x * a + blood[k] * (1 - a)) : blood; alpha = 1; }
      if (map.edge[i]) { c = c ? c.map((x, k) => x * 0.35 + outline[k] * 0.65) : outline; alpha = Math.max(alpha, 0.9); }
      if (!c) { data[o + 3] = 0; continue; }
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = Math.round(alpha * 255);
    }
    ctx.putImageData(image, 0, 0);
    if (overlay) {
      const cls = (id) => (states[id] === 1 ? "lit" : states[id] === 2 || states[id] === 3 ? "done" : "");
      for (const [s, id] of overlay.segs) s.setAttribute("data-s", cls(id));
      for (const [c, id] of overlay.dots) c.setAttribute("data-s", cls(id));
      // Wavefront arrow: from where the front was 25 ms ago to where it is now, in the slice.
      const ar = overlay.arrow;
      if (opts.vector && fx[2] > 12) {
        for (let i = 0, n = map.node.length; i < n; i++) {
          const v = map.node[i];
          if (v < 0 || states[v] !== 2) continue;
          const lastAct = sim.wavefronts.reduce((m, w) => (w.act[v] <= time && w.act[v] > m ? w.act[v] : m), -Infinity);
          if (time - lastAct < 40) { bx[0] += i % size; bx[1] += Math.floor(i / size); bx[2]++; }
        }
        if (bx[2] > 12) {
          const toMm = (p) => (p / bx[2]) * map.mmPerPx - plane.half, toMmF = (p) => (p / fx[2]) * map.mmPerPx - plane.half;
          const [x1, y1, x2, y2] = [toMm(bx[0]), toMm(bx[1]), toMmF(fx[0]), toMmF(fx[1])];
          const d = Math.hypot(x2 - x1, y2 - y1);
          if (d > 2) {
            const k = 16 / d;
            Object.entries({ x1: x2 - (x2 - x1) * k, y1: y2 - (y2 - y1) * k, x2: x2 + (x2 - x1) * k * 0.3, y2: y2 + (y2 - y1) * k * 0.3, visibility: "visible" }).forEach(([a, b]) => ar.setAttribute(a, b));
          } else ar.setAttribute("visibility", "hidden");
        } else ar.setAttribute("visibility", "hidden");
      } else ar.setAttribute("visibility", "hidden");
    }
  }

  const ro = new ResizeObserver(() => { if (Math.abs(wrap.clientWidth * Math.min(2, devicePixelRatio || 1) - size) > 40) rebuild(); });
  ro.observe(wrap);

  return {
    setSim(s, m) { const rebuildOverlay = m !== model; sim = s; model = m; if (!map) rebuild(); else if (rebuildOverlay) { buildOverlay(); paint(); } },
    setTime(t) { time = t; paint(); },
    setOptions(o) {
      const geo = o.section !== opts.section || o.level !== opts.level;
      opts = { ...opts, ...o };
      if (geo || !map) rebuild(); else { buildOverlay(); paint(); }
    },
    relabel() { if (map) { buildOverlay(); paint(); } },
    retheme() { readColours(); paint(); },
    element: wrap,
    dispose() { ro.disconnect(); wrap.remove(); },
  };
}
