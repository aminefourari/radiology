// heart.html wiring: one clock drives the tracing, ladder, caption, schematic or 3D heart, action potentials and
// vector loops, for one rhythm or two side by side.
import { LEADS, eventAt, leadAxes, loadGraph, simulate, vertexState, wrapTime } from "./heartsim.js";
import { buildHeart } from "./heartshape.js";
import { clockLabel, closeupWindow, formatHash, parseHash } from "./heartstate.js";
import { apCurve, HEXAXIAL, precordialAxes, vectorLoop } from "./heartplots.js";
import { createSchematic, TIME_SPAN, timeColour } from "./heartschematic.js";
import { openPicker } from "./heartpicker.js";
import { ladderLines } from "./ladder.js";
import { ROW_MM, panels } from "./ecgplot.js";
import { applyDir, loadLanguages, loadStrings, localized, saveLang, startLang, t } from "./i18n.js";
import { REPO_URL } from "./report.js";

const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const GAIN = 10, LADDER_ROW_MM = 30, MIN_PPM = 2.2, MAX_PPM = 8;
const WAVES = ["P", "PR", "QRS", "ST", "T"];
const SITES = [["site_ra", "heart.site.ra"], ["site_septum", "heart.site.septum"], ["site_lv", "heart.site.lv"]];
const SIDES = ["a", "b"];

let heart, graph, axes, rhythms, byKey;
let st = null;
const ui = { stageGen: 0, stageKey: null, raf: 0, drawnWin: {}, playing: false, waves: [], last: 0, events: [], ppm: 3, schematics: [], views: [], viewKind: null, apCache: new Map() };
const sims = new Map(); // model JSON → simulation
const current = { a: null, b: null }; // { key, model, sim }

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  n.append(...kids);
  return n;
};
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  n.append(...kids);
  return n;
};
const sides = () => (st.compare ? SIDES : ["a"]);
const timeOf = (side) => wrapTime(current[side].sim, st.t);
const longest = () => Math.max(...sides().map((s) => current[s].sim.duration));

async function boot() {
  let langs;
  try {
    [langs, rhythms] = await Promise.all([loadLanguages(), fetch("heart/rhythms.json").then((r) => r.json())]);
  } catch (e) {
    document.body.append(h("p", { class: "bad" }, String(e)));
    return;
  }
  heart = buildHeart();
  graph = loadGraph(heart.json, { radius: 3.5 });
  axes = leadAxes(graph);
  byKey = Object.fromEntries(rhythms.map((r) => [r.key, r]));
  st = parseHash(location.hash, rhythms.map((r) => r.key));
  st.lang = startLang(langs.map((l) => l.code), new URLSearchParams(location.hash.slice(1)).get("lang"));

  $("lang-select").replaceChildren(...langs.map((l) => new Option(`${l.flag} ${l.name}`, l.code)));
  $("lang-select").onchange = (e) => { saveLang(e.target.value); setLang(e.target.value); };
  $("pick").onclick = () => openPicker($("picker"), rhythms, st.lang, st.rhythm, (k) => { st.rhythm = k; load(); });
  $("pick2").onclick = () => openPicker($("picker"), rhythms, st.lang, st.compare, (k) => { st.compare = k; load(); });
  $("compare-on").onchange = (e) => { st.compare = e.target.checked ? (st.rhythm === "nsr" ? "rbbb" : "nsr") : null; load(); };
  $("ladder-on").onchange = (e) => { st.ladder = e.target.checked; draw(); saveHash(); };
  segmented("mode", (v) => { st.mode = v; draw(); });
  segmented("heart-mode", (v) => {
    st.heart = v;
    if (v === "slice" && st.section === "outside") st.section = "4ch";
    if (`${v === "slice" ? "slice" : "3d"}|${sides().length}` !== ui.stageKey) setupStage(); else applyHeartOptions();
  });
  segmented("section", (v) => { st.section = v; applyHeartOptions(); });
  segmented("colour", (v) => { st.colour = v; applyHeartOptions(); renderLegend(); });
  $("level").oninput = (e) => { st.level = +e.target.value; applyHeartOptions(); };
  $("conduction-on").onchange = (e) => { st.conduction = e.target.checked; applyHeartOptions(); };
  $("vector-on").onchange = (e) => { st.vector = e.target.checked; applyHeartOptions(); };
  $("play").onclick = () => setPlaying(!ui.playing);
  $("replay").onclick = () => { st.t = 0; setPlaying(true); };
  $("speed").onchange = (e) => { st.speed = +e.target.value; saveHash(); };
  $("scrub").oninput = (e) => { st.t = +e.target.value; frame(); };
  $("scrub").onchange = () => saveHash();
  $("waves").onclick = (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    ui.waves = WAVES.filter((x) => (x === k) !== ui.waves.includes(x));
    draw();
  };
  setupSplit();
  if (REPO_URL) { $("repo-link").hidden = false; $("repo-link").href = REPO_URL; }
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea, button, dialog")) return;
    if (e.key === " ") { e.preventDefault(); setPlaying(!ui.playing); }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const n = longest(); st.t = ((st.t + (e.key === "ArrowRight" ? 10 : -10)) % n + n) % n; frame(); }
  });
  new ResizeObserver(() => draw()).observe($("paper"));
  matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", () => ui.schematics.forEach((s) => s.retheme()));

  // A pasted or edited link (replaceState never fires this).
  addEventListener("hashchange", () => { const lang = st.lang; st = { ...parseHash(location.hash, rhythms.map((r) => r.key)), lang }; load(); });

  await setLang(st.lang);
  load();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches && !new URLSearchParams(location.hash.slice(1)).has("t")) setPlaying(true);
}

function segmented(id, on) {
  $(id).onclick = (e) => { const v = e.target.closest("[data-v]")?.dataset.v; if (v) { on(v); syncControls(); saveHash(); } };
}

async function setLang(lang) {
  st.lang = lang;
  await loadStrings(lang);
  applyDir(lang);
  $("lang-select").value = lang;
  document.querySelectorAll("[data-t]").forEach((n) => (n.textContent = t(n.dataset.t)));
  document.querySelectorAll("[data-t-aria]").forEach((n) => n.setAttribute("aria-label", t(n.dataset.tAria)));
  document.title = t("heart.title");
  $("play").textContent = t(ui.playing ? "heart.pause" : "heart.play");
  ui.apCache.clear();
  if (current.a) { syncControls(); renderText(); renderLeadPickers(); renderLegend(); ui.schematics.forEach((s) => s.relabel()); renderAp(); draw(); }
}

function simFor(key) {
  const model = byKey[key].model, k = JSON.stringify(model);
  if (!sims.has(k)) sims.set(k, simulate(graph, model));
  return { key, model, sim: sims.get(k) };
}

// (Re)build the simulations for the chosen rhythm(s), then everything that depends on them.
function load() {
  current.a = simFor(st.rhythm);
  current.b = st.compare ? simFor(st.compare) : null;
  st.t = ((st.t % longest()) + longest()) % longest();
  $("scrub").max = String(longest() - 1);
  ui.apCache.clear();
  ui.cursors = [];
  ui.apWindow = null;
  ui.drawnWin = {};
  syncControls();
  renderText();
  renderLeadPickers();
  renderLegend();
  const stageKey = `${st.heart === "slice" ? "slice" : "3d"}|${sides().length}`;
  draw();
  if (stageKey !== ui.stageKey) setupStage(); else applyHeartOptions();
  saveHash();
}

function syncControls() {
  const set = (id, v) => { for (const b of $(id).querySelectorAll("[data-v]")) b.setAttribute("aria-checked", b.dataset.v === v); };
  set("mode", st.mode); set("heart-mode", st.heart); set("colour", st.colour);
  set("section", st.heart === "slice" && st.section === "outside" ? "4ch" : st.section);
  $("section").querySelector('[data-v="outside"]').hidden = st.heart === "slice";
  $("level-wrap").hidden = st.section !== "sax";
  $("level").value = String(st.level);
  $("compare-on").checked = !!st.compare;
  $("pick2").hidden = !st.compare;
  $("ladder-on").checked = st.ladder;
  $("conduction-on").checked = st.conduction;
  $("vector-on").checked = st.vector;
  $("speed").value = String(st.speed);
  $("lead-pickers").hidden = st.mode !== "closeup";
  $("pick-label").textContent = `${localized(byKey[st.rhythm].title, st.lang)} · ${t("heart.search", { n: rhythms.length })}`;
  if (st.compare) $("pick2-label").textContent = localized(byKey[st.compare].title, st.lang);
}

function saveHash() {
  const { lang, ...rest } = st;
  void lang;
  const hash = formatHash({ ...rest, t: ui.playing ? 0 : st.t });
  history.replaceState(null, "", hash || location.pathname + location.search);
}

function setPlaying(on) {
  ui.playing = on;
  $("play").textContent = t(on ? "heart.pause" : "heart.play");
  $("play").setAttribute("aria-pressed", on);
  saveHash();
  cancelAnimationFrame(ui.raf);
  if (on) { ui.last = performance.now(); ui.raf = requestAnimationFrame(tick); }
}

function tick(now) {
  if (!ui.playing) return;
  const n = longest();
  st.t = ((st.t + (now - ui.last) * st.speed) % n + n) % n;
  ui.last = now;
  frame();
  ui.raf = requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------------------------------------
// Tracing and ladder: one SVG in paper mm. Close-up: three chosen leads at 100 mm/s, a 1.2 s page at a time.
// Rhythm strip: lead II, 25 mm/s. 12-lead: 3×4 at 25 mm/s. In compare mode rhythm B is stacked under A.

function rows() {
  const out = [];
  sides().forEach((side, i) => {
    const { sim } = current[side], dur = sim.duration;
    if (st.mode === "closeup") {
      const [t0, t1] = closeupWindow(timeOf(side), dur);
      st.leads.forEach((lead, r) => out.push({ side, sim, lead, row: i * 3 + r, t0, t1, x0: t0, speed: 100, first: r === 0 }));
    } else if (st.mode === "strip") {
      out.push({ side, sim, lead: "II", row: i, t0: 0, t1: dur, x0: 0, speed: 25, first: true });
    } else {
      for (const p of panels(dur / 1000, "3x4")) if (p.row < 3) out.push({ side, sim, lead: p.lead, row: i * 3 + p.row, t0: p.t0 * 1000, t1: p.t1 * 1000, x0: 0, speed: 25, first: p.row === 0 && p.t0 === 0 });
    }
  });
  return out;
}
const xOf = (r, ms) => ((ms - r.x0) / 1000) * r.speed;

function draw() {
  if (!current.a) return;
  ui.drawnWin = Object.fromEntries(sides().map((side) => [side, closeupWindow(timeOf(side), current[side].sim.duration)[0]]));
  const rs = rows();
  const w = Math.max(...rs.map((r) => xOf(r, r.t1))), nRows = Math.max(...rs.map((r) => r.row)) + 1, hgt = nRows * ROW_MM;
  ui.ppm = Math.min(MAX_PPM, Math.max(MIN_PPM, $("paper").clientWidth / w));
  const svg = $("trace");
  svg.setAttribute("viewBox", `0 0 ${w} ${hgt}`);
  svg.style.width = `${w * ui.ppm}px`;
  svg.style.height = `${hgt * ui.ppm}px`;
  const bands = el("g", { class: "waves" }), traces = el("g", { class: "traces" }), labels = el("g", { class: "leads" }), marks = el("g", { class: "marks" });
  ui.cursors = [];
  for (const r of rs) {
    const top = r.row * ROW_MM, mid = top + ROW_MM / 2, sig = r.sim.leads[r.lead], fs = r.sim.fs;
    for (const e of r.sim.events) {
      if (!ui.waves.includes(e.type) || e.t1 < r.t0 || e.t0 > r.t1) continue;
      const a = Math.max(e.t0, r.t0), b = Math.min(e.t1, r.t1);
      bands.append(el("rect", { class: `w-${e.type}`, x: xOf(r, a), y: top + 1, width: xOf(r, b) - xOf(r, a), height: ROW_MM - 2 }));
    }
    let d = "";
    for (let i = Math.max(0, Math.floor((r.t0 * fs) / 1000)); i <= Math.min(sig.length - 1, Math.ceil((r.t1 * fs) / 1000)); i++) {
      d += `${d ? "L" : "M"}${xOf(r, (i * 1000) / fs).toFixed(2)} ${(mid - sig[i] * GAIN).toFixed(2)}`;
    }
    traces.append(el("path", { d }));
    const x = xOf(r, r.t0);
    labels.append(el("text", { x: x + 1, y: top + 4 }, r.lead));
    if (r.first && st.compare) labels.append(el("text", { x: x + 1, y: top + 8.5, class: `tag ${r.side}` }, r.side.toUpperCase()));
    if (x > 0) labels.append(el("line", { x1: x, x2: x, y1: top + ROW_MM * 0.3, y2: top + ROW_MM * 0.7 }));
    // Close-up: name each wave above the first lead of each rhythm.
    if (st.mode === "closeup" && r.first) {
      for (const e of r.sim.events) {
        if (!["P", "QRS", "T"].includes(e.type) || e.t0 < r.t0 || e.t1 > r.t1 + 200) continue;
        const c = e.type === "T" ? e.t0 + (e.t1 - e.t0) * 0.45 : (e.t0 + e.t1) / 2;
        if (c > r.t1) continue;
        marks.append(el("text", { x: xOf(r, c), y: top + 3.2, class: `mark w-${e.type}` }, e.type));
      }
    }
  }
  for (const side of sides()) {
    const mine = rs.filter((r) => r.side === side);
    const top = Math.min(...mine.map((r) => r.row)) * ROW_MM, bottom = (Math.max(...mine.map((r) => r.row)) + 1) * ROW_MM;
    ui.cursors.push({ side, r: mine[0], line: el("line", { class: "cursor", y1: top, y2: bottom }) });
  }
  svg.replaceChildren(gridDefs(), el("rect", { class: "bg", width: w, height: hgt }), el("rect", { width: w, height: hgt, fill: "url(#grid5)" }),
    bands, traces, labels, marks, ...ui.cursors.map((c) => c.line));
  drawLadder(rs, w);
  $("scale").textContent = t(st.mode === "closeup" ? "heart.scale.closeup" : "heart.scale.strip");
  for (const b of $("waves").children) b.setAttribute("aria-pressed", ui.waves.includes(b.dataset.k));
  renderAp();
  frame();
}

function drawLadder(rs, w) {
  const lad = $("ladder");
  lad.hidden = !st.ladder;
  if (!st.ladder) return;
  const H = LADDER_ROW_MM * sides().length;
  lad.setAttribute("viewBox", `0 0 ${w} ${H}`);
  lad.style.width = $("trace").style.width;
  lad.style.height = `${H * ui.ppm}px`;
  const parts = [el("rect", { class: "bg", width: w, height: H })];
  sides().forEach((side, i) => {
    const r0 = rs.find((r) => r.side === side), sim = r0.sim;
    const r = st.mode === "closeup" ? r0 : { ...r0, x0: 0, t0: 0, t1: sim.duration };
    const top = i * LADDER_ROW_MM, row = LADDER_ROW_MM / 3, y = (v) => top + v * row, x = (ms) => xOf(r, ms);
    const g = el("g", { class: "rows" });
    for (let k = i ? 0 : 1; k < 3; k++) g.append(el("line", { x1: 0, x2: w, y1: y(k), y2: y(k) }));
    ["A", "AV", "V"].forEach((name, k) => g.append(el("text", { x: 1, y: y(k) + 4 }, st.compare && k === 0 ? `${side.toUpperCase()} · ${name}` : name)));
    const lines = el("g", { class: "lines" });
    for (const l of ladderLines(sim.events)) {
      if (l.t1 < r.t0 || l.t0 > r.t1) continue;
      lines.append(el("line", { x1: x(l.t0), y1: y(l.y0), x2: x(l.t1), y2: y(l.y1), class: l.retro ? "retro" : l.blocked ? "blocked" : "" }));
      if (l.blocked) lines.append(el("line", { x1: x(l.t1) - 1.2, x2: x(l.t1) + 1.2, y1: y(l.y1), y2: y(l.y1), class: "blocked" }));
    }
    // Pacing spikes: short ticks at the top of the paced row.
    for (const e of sim.events) if (e.type === "spike" && e.t0 >= r.t0 && e.t0 <= r.t1) lines.append(el("line", { x1: x(e.t0), x2: x(e.t0), y1: y(e.chamber === "A" ? 0 : 2), y2: y(e.chamber === "A" ? 0.45 : 2.45), class: "spike" }));
    const c = el("line", { class: "cursor", y1: top, y2: top + LADDER_ROW_MM });
    parts.push(g, lines, c);
    ui.cursors.push({ side, line: c, r });
  });
  lad.replaceChildren(...parts);
}

function gridDefs() {
  const defs = el("defs");
  const p1 = el("pattern", { id: "grid1", width: 1, height: 1, patternUnits: "userSpaceOnUse" });
  p1.append(el("path", { d: "M1 0V1H0", class: "g1" }));
  const p5 = el("pattern", { id: "grid5", width: 5, height: 5, patternUnits: "userSpaceOnUse" });
  p5.append(el("rect", { width: 5, height: 5, fill: "url(#grid1)" }), el("path", { d: "M5 0V5H0", class: "g5" }));
  defs.append(p1, p5);
  return defs;
}

function renderLeadPickers() {
  $("lead-pickers").replaceChildren(...st.leads.map((lead, i) => {
    const s = h("select", { "aria-label": `${t("heart.lead")} ${i + 1}` }, ...LEADS.map((l) => new Option(l, l)));
    s.value = lead;
    s.onchange = () => { st.leads = st.leads.map((x, k) => (k === i ? s.value : x)); draw(); saveHash(); };
    return s;
  }));
}

// ---------------------------------------------------------------------------------------------------------
// Heart stage: the schematic slice (default) or the 3D / torso view, for A and optionally B behind a split.

async function setupStage() {
  const want = st.heart === "slice" ? "slice" : "3d";
  const gen = ++ui.stageGen;
  ui.stageKey = `${want}|${sides().length}`;
  for (const s of ui.schematics) s.dispose();
  ui.schematics = [];
  for (const v of ui.views) v.dispose();
  ui.views = [];
  ui.viewKind = want;
  $("stage-b").hidden = !st.compare;
  $("split").hidden = $("tag-a").hidden = $("tag-b").hidden = !st.compare;
  applySplit();
  if (want === "slice") {
    for (const side of sides()) {
      const s = createSchematic($(`stage-${side}`), { json: heart.json, grid: heart.grid, g: graph });
      ui.schematics.push(s);
    }
    applyHeartOptions();
    return;
  }
  for (const side of SIDES) $(`stage-${side}`).replaceChildren();
  const msg = h("p", { class: "loading-msg" }, t("heart.loading"));
  $("stage-a").append(msg);
  try {
    const { createHeartView } = await import("./heartview.js");
    ui.surface ??= (await import("./heartshape.js")).surface(heart.grid);
    if (gen !== ui.stageGen) return;
    const made = [];
    for (const side of sides()) made.push(await createHeartView($(`stage-${side}`), { json: heart.json, grid: heart.grid, g: graph, surface: ui.surface }));
    if (gen !== ui.stageGen) { made.forEach((v) => v.dispose()); return; }
    ui.views = made;
    msg.remove();
    applyHeartOptions();
  } catch (e) {
    console.warn(e);
    msg.textContent = t("heart.nowebgl");
  }
}

function applyHeartOptions() {
  syncControls();
  const section = st.heart === "slice" && st.section === "outside" ? "4ch" : st.section;
  sides().forEach((side, i) => {
    const s = ui.schematics[i];
    if (s) { s.setSim(current[side].sim, current[side].model); s.setOptions({ section, level: st.level, colour: st.colour, conduction: st.conduction, vector: st.vector }); }
    const v = ui.views[i];
    if (v) v.setOptions({ section, level: st.level, torso: st.heart === "torso", conduction: st.conduction, vector: st.vector, model: current[side].model });
  });
  frame();
  saveHash();
}

function setupSplit() {
  const split = $("split"), stage = $("heart-stage");
  const move = (e) => {
    const r = stage.getBoundingClientRect();
    st.split = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    applySplit();
  };
  split.onpointerdown = (e) => {
    split.setPointerCapture(e.pointerId);
    split.onpointermove = move;
    split.onpointerup = () => { split.onpointermove = null; saveHash(); };
  };
  split.onkeydown = (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    st.split = Math.min(1, Math.max(0, st.split + (e.key === "ArrowRight" ? 0.05 : -0.05)));
    applySplit();
    saveHash();
  };
}
// B shows to the right of the divider, A to the left (always left-to-right, whatever the page direction).
function applySplit() {
  const pct = `${(st.split * 100).toFixed(1)}%`;
  $("stage-b").style.clipPath = `inset(0 0 0 ${pct})`;
  $("split").style.left = pct;
  $("split").setAttribute("aria-valuenow", Math.round(st.split * 100));
}

// ---------------------------------------------------------------------------------------------------------
// Everything that moves with time.

const stateBuf = { a: null, b: null };
function frame() {
  if (!current.a) return;
  // The close-up shows one page per rhythm: turn the page when the time leaves it (playing, scrubbing, keys, replay).
  if (st.mode === "closeup" && sides().some((side) => closeupWindow(timeOf(side), current[side].sim.duration)[0] !== ui.drawnWin?.[side])) { draw(); return; }
  $("scrub").value = String(Math.round(st.t));
  $("clock").textContent = `${(st.t / 1000).toFixed(2)} s`;
  for (const c of ui.cursors ?? []) {
    const ms = timeOf(c.side), x = xOf(c.r, ms).toFixed(2);
    c.line.setAttribute("x1", x); c.line.setAttribute("x2", x);
  }
  sides().forEach((side, i) => {
    const ms = timeOf(side), { sim } = current[side];
    ui.schematics[i]?.setTime(ms);
    const v = ui.views[i];
    if (v) {
      stateBuf[side] ??= new Uint8Array(graph.n);
      vertexState(sim, ms, stateBuf[side]);
      const k = Math.min(Math.floor(ms), sim.duration - 1) * 3;
      v.setFrame(stateBuf[side], [sim.vectors[k], sim.vectors[k + 1], sim.vectors[k + 2]], st.colour === "time" ? { sim, t: ms } : null);
    }
  });
  // Clock and caption, per rhythm.
  const since = sides().map((side) => {
    const c = clockLabel(current[side].sim, timeOf(side));
    const text = c ? t(`heart.clock.${c.origin}`, { ms: c.ms }) : "";
    return st.compare ? `${side.toUpperCase()}: ${text || "—"}` : text;
  }).join("   ");
  if ($("since").textContent !== since) $("since").textContent = since;
  const cap = sides().map((side) => { const e = eventAt(current[side].sim, timeOf(side)); return (st.compare ? `${side.toUpperCase()}: ` : "") + caption(e); }).join("\n");
  if ($("caption").textContent !== cap) $("caption").textContent = cap;
  moveApCursors();
  drawVectors();
}

function caption(e) {
  if (!e) return t("heart.cap.rest");
  if (e.type === "vf") return t("heart.cap.vf");
  if (e.type === "P") return t({ retro: "heart.cap.P.retro", flutter: "heart.cap.P.flutter", af: "heart.cap.P.af", atrial: "heart.cap.P.atrial", paced: "heart.cap.P.paced" }[e.origin] ?? "heart.cap.P");
  if (e.type === "QRS") {
    const k = { ectopic: "ventricular", ventricle: "ventricular", vt: "ventricular", junction: "junction", paced: "paced", fusion: "fusion", antidromic: "antidromic" }[e.origin];
    return t(k ? `heart.cap.QRS.${k}` : "heart.cap.QRS");
  }
  if (e.type === "reentry") return t(`heart.cap.reentry.${e.circuit}`);
  if (e.type === "PR") return t("heart.cap.AV");
  return t(`heart.cap.${e.type}`);
}

// Action potentials at the three numbered sites (rhythm A), over the close-up page.
function renderAp() {
  const box = $("ap");
  if (!current.a) return;
  const { sim } = current.a, [t0, t1] = closeupWindow(timeOf("a"), sim.duration);
  const key = `${JSON.stringify(current.a.model)}|${t0}|${st.lang}`;
  if (ui.apCache.get("key") === key && box.childElementCount) return;
  ui.apCache.set("key", key);
  const W = 120, H = 34, y = (mv) => ((20 - mv) / 110) * H, x = (ms) => ((ms - t0) / (t1 - t0)) * W;
  ui.apCursors = [];
  box.replaceChildren(...SITES.map(([lm, label], i) => {
    const pts = apCurve(sim, heart.json.landmarks[lm], t0, t1);
    const cur = el("line", { class: "cursor", y1: 0, y2: H });
    ui.apCursors.push(cur);
    const svg = el("svg", { viewBox: `-14 -2 ${W + 16} ${H + 4}`, class: "ap" },
      el("line", { x1: 0, x2: W, y1: y(0), y2: y(0), class: "zero" }),
      el("text", { x: -2, y: y(20) + 3, class: "mv" }, "+20"), el("text", { x: -2, y: y(-90), class: "mv" }, "−90"),
      el("path", { d: pts.map(([ms, mv], k) => `${k ? "L" : "M"}${x(ms).toFixed(1)} ${y(mv).toFixed(1)}`).join("") }), cur);
    return h("figure", {}, h("figcaption", {}, h("b", {}, `${i + 1}`), ` ${t(label)}`), svg);
  }));
  ui.apWindow = [t0, t1, W];
  moveApCursors();
}
function moveApCursors() {
  if (!ui.apWindow) return;
  const [t0, t1, W] = ui.apWindow, ms = timeOf("a");
  if (ms < t0 || ms >= t1) { renderAp(); return; }
  const x = (((ms - t0) / (t1 - t0)) * W).toFixed(1);
  for (const c of ui.apCursors) { c.setAttribute("x1", x); c.setAttribute("x2", x); }
}

// Frontal and horizontal vector diagrams: reference axes, the loop of the current beat, the vector now (rhythm A).
function drawVectors() {
  const { sim } = current.a, ms = timeOf("a");
  sim._vmax ??= (() => { let m = 0; for (let i = 0; i < sim.vectors.length; i += 3) m = Math.max(m, Math.hypot(sim.vectors[i], sim.vectors[i + 1], sim.vectors[i + 2])); return m || 1; })();
  const gain = 46 / sim._vmax;
  for (const plane of ["frontal", "horizontal"]) {
    const svg = $(`vec-${plane}`);
    if (!svg._axes) {
      const g = el("g", { class: "axes" });
      const lines = plane === "frontal"
        ? Object.entries(HEXAXIAL).map(([l, deg]) => [l, Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)])
        : Object.entries(precordialAxes(axes)).map(([l, [x, y]]) => { const n = Math.hypot(x, y); return [l, x / n, -y / n]; });
      g.append(el("circle", { r: 50, class: "ring" }));
      for (const [l, x, y] of lines) {
        g.append(el("line", { x1: -x * 50, y1: -y * 50, x2: x * 50, y2: y * 50, class: plane === "horizontal" ? "half" : "" }));
        g.append(el("text", { x: x * 56, y: y * 56 + 2 }, l));
      }
      svg._loop = el("path", { class: "loop" });
      svg._arrow = el("line", { class: "vec", "marker-end": `url(#vhead-${plane})` });
      svg.replaceChildren(el("defs", {}, el("marker", { id: `vhead-${plane}`, viewBox: "0 0 10 10", refX: 8, refY: 5, markerWidth: 5, markerHeight: 5, orient: "auto" }, el("path", { d: "M0 0L10 5L0 10z" }))), g, svg._loop, svg._arrow);
      svg._axes = true;
    }
    const { loop, now } = vectorLoop(sim, ms, plane, gain);
    // Screen y grows downwards: frontal "up" (superior) and horizontal "posterior" are drawn upwards.
    const fy = (p) => -p[1];
    svg._loop.setAttribute("d", loop.map((p, k) => `${k ? "L" : "M"}${p[0].toFixed(1)} ${fy(p).toFixed(1)}`).join(""));
    svg._arrow.setAttribute("x1", 0); svg._arrow.setAttribute("y1", 0);
    svg._arrow.setAttribute("x2", now[0].toFixed(1)); svg._arrow.setAttribute("y2", fy(now).toFixed(1));
    svg._arrow.setAttribute("visibility", Math.hypot(...now) > 2 ? "visible" : "hidden");
  }
}

function renderLegend() {
  const items = st.colour === "time"
    ? [h("li", { class: "time-scale" }, h("i", { style: `background: linear-gradient(90deg, ${[0, 50, 100, 160].map((m) => `rgb(${timeColour(m).join(",")})`).join(",")})` }),
        h("span", {}, `0–${TIME_SPAN} ${t("heart.legend.ms")}`))]
    : [["rest", "heart.legend.rest"], ["front", "heart.legend.front"], ["plateau", "heart.legend.plateau"], ["repol", "heart.legend.repol"], ["cs", "heart.conduction"]]
      .map(([c, k]) => h("li", {}, h("i", { class: `lg-${c}` }), h("span", {}, t(k))));
  $("legend").replaceChildren(...items);
}

// Educational panel: why, what it looks like, takeaways, and a real tracing where the atlas has one.
function renderText() {
  $("rhythm-title").textContent = sides().map((s) => localized(byKey[current[s].key].title, st.lang)).join(" vs ");
  $("why").replaceChildren(...sides().flatMap((side) => {
    const r = byKey[current[side].key];
    const english = st.lang !== "en" && !r.why[st.lang];
    const list = (tag, x) => h(tag, {}, ...localized(x, st.lang).map((s) => h("li", {}, s)));
    return [
      h("h2", {}, st.compare ? `${side.toUpperCase()} · ` : "", localized(r.title, st.lang)),
      english ? h("p", { class: "muted small" }, t("heart.textEn")) : "",
      h("h3", {}, t("heart.why")), list("ol", r.why),
      h("h3", {}, t("heart.looks")), list("ul", r.looks),
      h("h3", {}, t("heart.takeaways")), list("ul", r.takeaways),
      r.atlasEcg != null ? h("a", { class: "btn see", href: `ecg.html#ecg=${r.atlasEcg}` }, t("heart.see")) : h("p", { class: "muted" }, t("heart.noatlas")),
    ];
  }));
}

boot();
