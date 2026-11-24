// The schematic heart for heart.html: a slice of the idealised heart, its walls coloured from the simulation,
// with the conduction system, numbered action-potential sites and the heart vector drawn over it in SVG.
import { planeProject, sectionPlane, slicePlane, SHAPE, toLocal, valveHinges } from "./heartshape.js";
import { vertexState } from "./heartsim.js";
import { beatStart } from "./heartplots.js";
import { t as tr } from "./i18n.js";

const SVGNS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  n.append(...kids);
  return n;
};
const hex = (s) => { const v = parseInt(s.trim().replace("#", ""), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const dot2 = (d, e) => d[0] * e[0] + d[1] * e[1] + d[2] * e[2];
// Wall colours are painted one pixel per voxel (2 mm), then smoothed up and clipped to the fine wall mask.
const LOW_MM = 2;
// A projected conduction line, its voxel-path zigzag smoothed out (ends kept).
const smooth = (pts) => pts.map((p, i) => {
  if (i === 0 || i === pts.length - 1) return p;
  let x = 0, y = 0, c = 0;
  for (let j = Math.max(0, i - 2); j <= Math.min(pts.length - 1, i + 2); j++) { x += pts[j][0]; y += pts[j][1]; c++; }
  return [x / c, y / c];
});
// Grow a pixel → voxel map `passes` pixels into empty pixels, so smoothing at the wall's edge never blends in nothing.
function dilate(node, n, passes) {
  let cur = node;
  for (let p = 0; p < passes; p++) {
    const next = cur.slice();
    for (let i = 0; i < n * n; i++) {
      if (cur[i] >= 0) continue;
      const x = i % n;
      next[i] = x > 0 && cur[i - 1] >= 0 ? cur[i - 1] : x < n - 1 && cur[i + 1] >= 0 ? cur[i + 1] : i >= n && cur[i - n] >= 0 ? cur[i - n] : i < n * n - n ? cur[i + n] : -1;
    }
    cur = next;
  }
  return cur;
}
const lerp = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
// How closed the AV valves are at time t (0 open … 1 shut). Mechanics, for orientation only: they shut just after the
// QRS starts and reopen shortly after the T wave ends.
function valveShut(sim, t) {
  const q = sim.events.filter((e) => e.type === "QRS" && e.t0 <= t).at(-1);
  if (!q) return 0;
  const tw = sim.events.find((e) => e.type === "T" && e.t0 > q.t0);
  const shut = q.t0 + 20, reopen = (tw ? tw.t1 : q.t0 + 350) + 60;
  if (t < shut) return 0;
  return t < reopen ? Math.min(1, (t - shut) / 30) : Math.max(0, 1 - (t - reopen) / 40);
}
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
  const svg = el("svg", { class: "schematic-svg", role: "img", "aria-label": tr("heart.heart") });
  wrap.append(canvas, svg);
  container.append(wrap);
  const ctx = canvas.getContext("2d");
  // Off-screen layers: the wall mask and the blood in the cavities (fine, static), and the wall colours (coarse, per frame).
  const mask = document.createElement("canvas"), base = document.createElement("canvas"), low = document.createElement("canvas");
  const lowCtx = low.getContext("2d");
  const states = new Uint8Array(g.n);
  const local = (id) => toLocal(grid.ax, [g.pos[id * 3], g.pos[id * 3 + 1], g.pos[id * 3 + 2]]);
  const centre = toLocal(grid.ax, json.centre);
  let opts = { section: "4ch", level: 0.5, colour: "state", conduction: true, vector: true };
  let plane, map, lowNode, lowImage, size = 0, sim = null, model = null, time = 0, overlay = null;
  let colours = null;

  function readColours() {
    const cs = getComputedStyle(wrap);
    colours = ["--heart-rest", "--heart-front", "--heart-plateau", "--heart-repol", "--heart-blood", "--heart-ring"].map((v) => hex(cs.getPropertyValue(v) || "#888888"));
  }

  function rebuild() {
    const px = Math.round(Math.min(720, Math.max(160, wrap.clientWidth * Math.min(2, devicePixelRatio || 1))));
    plane = sectionPlane(opts.section, opts.level);
    size = px;
    canvas.width = canvas.height = mask.width = mask.height = base.width = base.height = px;
    map = slicePlane(grid, plane, px);
    readColours();
    // Behind the walls: blood in the cavities and valve openings, the fibrous ring in the AV gap.
    const m = new ImageData(px, px), b = new ImageData(px, px), [blood, ring] = colours.slice(4);
    for (let i = 0; i < px * px; i++) {
      const o = i * 4;
      m.data[o] = m.data[o + 1] = m.data[o + 2] = 255;
      m.data[o + 3] = Math.round(map.alpha[i] * 255);
      const bl = map.blood[i], rg = map.ring[i];
      if (!bl && !rg) continue;
      for (let k = 0; k < 3; k++) b.data[o + k] = (blood[k] * bl + ring[k] * rg) / (bl + rg);
      b.data[o + 3] = Math.round(map.inside[i] * 255);
    }
    mask.getContext("2d").putImageData(m, 0, 0);
    base.getContext("2d").putImageData(b, 0, 0);
    const n = Math.round((2 * plane.half) / LOW_MM);
    low.width = low.height = n;
    lowNode = dilate(slicePlane(grid, plane, n).node, n, 3);
    lowImage = lowCtx.createImageData(n, n);
    svg.setAttribute("viewBox", `${-plane.half} ${-plane.half} ${2 * plane.half} ${2 * plane.half}`);
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
      : [["heart.ch.ra", SHAPE.ra.c], ["heart.ch.la", SHAPE.la.c], ["heart.ch.rv", [44, 8, -28]], ["heart.ch.lv", [-2, 0, -54]]];
    for (const [k, p] of centres) { const [x, y] = P(p); labels.append(el("text", { x, y, class: "chamber" }, tr(k))); }

    const segs = [], dots = [], texts = el("g", { class: "cs-labels" });
    const lineG = el("g", { class: "cs" }), haloG = el("g", { class: "cs-halo" });
    // One drawn segment per path step, so each lights up as the impulse passes; a white halo underneath.
    const seg = (x1, y1, x2, y2, id, extra = "") => {
      haloG.append(el("line", { x1, y1, x2, y2 }));
      const s = el("line", { x1, y1, x2, y2, class: `cs-seg${extra}` });
      lineG.append(s); segs.push([s, id]);
    };
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
        const xy = smooth(pts.map(P));
        for (let i = 1; i < xy.length; i++) seg(...xy[i - 1], ...xy[i], ids[i]);
        const [lx, ly] = xy[Math.floor(xy.length * (name === "his" ? 0.5 : 0.75))];
        texts.append(el("text", { x: lx + 2, y: ly + (name === "lpf" ? 4 : -2), class: "cs-label" }, tr(LINE_KEYS[name])));
      }
      // Bachmann's bundle and the nodes, from their own voxels.
      if (!sax) {
        const bach = json.bachmannIds ?? [];
        const bxy = smooth(bach.map((v) => P(grid.local[v])));
        for (let i = 1; i < bxy.length; i++) seg(...bxy[i - 1], ...bxy[i], bach[i]);
        if (bach.length) { const [x, y] = bxy[Math.floor(bxy.length / 2)]; texts.append(el("text", { x, y: y - 3, class: "cs-label" }, tr("heart.cs.bachmann"))); }
        for (const [key, lm] of [["heart.cs.sa", "sa"], ["heart.cs.av", "avnode"]]) {
          const [x, y] = P(grid.local[json.landmarks[lm]]);
          const c = el("circle", { cx: x, cy: y, r: 2.4, class: "cs-node" });
          lineG.append(c); dots.push([c, json.landmarks[lm]]);
          // SA label above right; AV label to the left, clear of the His bundle's.
          texts.append(lm === "sa" ? el("text", { x: x + 3, y: y - 3, class: "cs-label" }, tr(key)) : el("text", { x: x - 3.5, y: y + 4.5, class: "cs-label", "text-anchor": "end" }, tr(key)));
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
        seg(x1, y1, x2, y2, ap[1], " ap");
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
    // AV valves where the slice cuts them: two leaflets each, hinged on the ring and hanging into the ventricle. The
    // longer leaflet is the mitral's anterior (septal side) and the tricuspid's anterior (free-wall side).
    const valveG = el("g", { class: "valves" }), leaflets = [];
    const down = [-plane.ex[2], -plane.ey[2]], dl = Math.hypot(...down), A = [down[0] / dl, down[1] / dl];
    for (const [k, [h1, h2]] of Object.entries(valveHinges(plane))) {
      const W = Math.hypot(h2[0] - h1[0], h2[1] - h1[1]), M = lerp(h1, h2, 0.5);
      const shutTip = [M[0] + A[0] * 0.16 * W, M[1] + A[1] * 0.16 * W];
      const lens = k === "mitral" ? [0.62, 0.42] : [0.6, 0.45];
      [[h1, lens[0]], [h2, lens[1]]].forEach(([H, f]) => {
        const L = f * W, inn = [(M[0] - H[0]) / (W / 2), (M[1] - H[1]) / (W / 2)];
        const at = (a, b) => [H[0] + A[0] * a * L + inn[0] * b * L, H[1] + A[1] * a * L + inn[1] * b * L];
        const mid = lerp(H, shutTip, 0.5);
        const paths = [el("path", { class: "leaflet-edge" }), el("path", { class: "leaflet" })];
        valveG.append(...paths);
        leaflets.push({ paths, H, open: [at(0.5, 0.05), at(0.92, 0.3)], shut: [[mid[0] - A[0] * 0.06 * W, mid[1] - A[1] * 0.06 * W], shutTip] });
      });
      const [lx, ly] = [M[0] - A[0] * 5, M[1] - A[1] * 5];
      texts.append(el("text", { x: lx, y: ly, class: "cs-label valve-label", "text-anchor": "middle" }, tr(`heart.valve.${k}`)));
    }

    // Heart vector: one arrow from the ventricular centre, and the loop its tip has traced this beat.
    const [ox, oy] = P(centre);
    const vec = { trail: el("path", { class: "hv-trail" }), halo: el("path", { class: "hv-halo" }), arrow: el("path", { class: "hv-arrow" }), origin: [ox, oy] };
    const vecG = el("g", { class: "hv" }, vec.trail, vec.halo, vec.arrow, el("circle", { cx: ox, cy: oy, r: 1.3, class: "hv-origin" }));
    const note = !sax && opts.conduction ? el("text", { x: -plane.half + 2, y: plane.half - 3, class: "note" }, tr("heart.projected")) : "";
    svg.replaceChildren(labels, valveG, haloG, lineG, texts, cuts, sites, vecG, note);
    overlay = { segs, dots, vec, vecG, leaflets };
  }

  function paint() {
    if (!sim || !lowNode) return;
    vertexState(sim, time, states);
    const [rest, front, plateau, repol] = colours, stateColour = [rest, front, plateau, repol];
    let times = null;
    if (opts.colour === "time") {
      // Per voxel: ms after its current beat started (the latest wavefront of its kind that has started), or −1.
      times = new Float32Array(g.nMesh).fill(-1);
      for (const w of sim.wavefronts) {
        if (w.t0 > time) continue;
        for (let v = 0; v < g.nMesh; v++) { const a = w.act[v]; if (a <= time) times[v] = a - w.t0; }
      }
    }
    const data = lowImage.data;
    for (let i = 0; i < lowNode.length; i++) {
      const v = lowNode[i], o = i * 4;
      if (v < 0) { data[o + 3] = 0; continue; }
      const c = times ? (times[v] >= 0 ? timeColour(times[v]) : rest) : stateColour[states[v]];
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    }
    lowCtx.putImageData(lowImage, 0, 0);
    // Walls: the coarse colours, smoothed up and clipped to the fine mask; then the blood behind them.
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = "source-in";
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(low, 0, 0, size, size);
    ctx.globalCompositeOperation = "destination-over";
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    if (!overlay) return;
    const cls = (id) => (states[id] === 1 ? "lit" : states[id] === 2 || states[id] === 3 ? "done" : "");
    for (const [s, id] of overlay.segs) s.setAttribute("data-s", cls(id));
    for (const [c, id] of overlay.dots) c.setAttribute("data-s", cls(id));
    const f = valveShut(sim, time);
    for (const { paths, H, open, shut } of overlay.leaflets) {
      const [c, tip] = [lerp(open[0], shut[0], f), lerp(open[1], shut[1], f)];
      const d = `M${H[0].toFixed(1)} ${H[1].toFixed(1)}Q${c[0].toFixed(1)} ${c[1].toFixed(1)} ${tip[0].toFixed(1)} ${tip[1].toFixed(1)}`;
      for (const p of paths) p.setAttribute("d", d);
    }
    drawVector();
  }

  // The heart vector projected on the slice. Length grows with the square root-ish of its size (exponent 0.6) so the
  // small P and T vectors stay visible next to the QRS; the direction is exact.
  function drawVector() {
    const { vec, vecG } = overlay;
    vecG.setAttribute("visibility", opts.vector ? "visible" : "hidden");
    if (!opts.vector) return;
    const V = sim.vectors, k = Math.max(0, Math.min(Math.floor(time), sim.duration - 1));
    sim._vmax ??= (() => { let m = 0; for (let i = 0; i < V.length; i += 3) m = Math.max(m, Math.hypot(V[i], V[i + 1], V[i + 2])); return m || 1; })();
    const [ox, oy] = vec.origin, reach = plane.half * 0.42;
    const tip = (i) => {
      const r = [V[i * 3], V[i * 3 + 1], V[i * 3 + 2]], m = Math.hypot(...r);
      if (m < 1e-9) return [ox, oy, 0];
      const d = toLocal(grid.ax, r), f = (reach * (m / sim._vmax) ** 0.6) / m;
      return [ox + dot2(d, plane.ex) * f, oy + dot2(d, plane.ey) * f, m / sim._vmax];
    };
    let trail = "";
    for (let i = Math.floor(beatStart(sim, k)); i <= k; i += 2) { const [x, y] = tip(i); trail += `${trail ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`; }
    vec.trail.setAttribute("d", trail);
    const [x, y, rel] = tip(k), len = Math.hypot(x - ox, y - oy);
    if (rel < 0.02 || len < 3) { vec.arrow.setAttribute("d", ""); vec.halo.setAttribute("d", ""); return; }
    const ux = (x - ox) / len, uy = (y - oy) / len, head = Math.min(5, len * 0.45), w = head * 0.42;
    const bx = x - ux * head, by = y - uy * head;
    const d = `M${ox.toFixed(1)} ${oy.toFixed(1)}L${bx.toFixed(1)} ${by.toFixed(1)}M${x.toFixed(1)} ${y.toFixed(1)}L${(bx - uy * w).toFixed(1)} ${(by + ux * w).toFixed(1)}L${(bx + uy * w).toFixed(1)} ${(by - ux * w).toFixed(1)}Z`;
    vec.arrow.setAttribute("d", d);
    vec.halo.setAttribute("d", d);
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
    retheme() { if (map) rebuild(); },
    element: wrap,
    dispose() { ro.disconnect(); wrap.remove(); },
  };
}
