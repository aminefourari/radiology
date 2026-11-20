// heart.html wiring: one simulation drives the tracing, the ladder, the caption and the 3D heart.
import { LEADS, eventAt, leadAxes, loadGraph, simulate, vertexState, wrapTime } from "./heartsim.js";
import { applyWhatIf, formatHash, parseHash, toggleWhatIf } from "./heartstate.js";
import { ladderLines } from "./ladder.js";
import { ROW_MM, panels, paperMm, pathData, tracePoints, waveBands } from "./ecgplot.js";
import { applyDir, loadLanguages, loadStrings, localized, saveLang, startLang, t } from "./i18n.js";
import { REPO_URL } from "./report.js";

const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const SPEED_MM = 25, GAIN = 10, MIN_PPM = 3, MAX_PPM = 4.5, LADDER_MM = 30;
const WAVES = ["P", "PR", "QRS", "ST", "T"];

let graph, rhythms, byKey, axes, sim, states, views = [];
const st = { rhythm: "nsr", view: "outside", speed: 0.2, t: 0, whatIf: null, lang: "en" };
const ui = { playing: false, layout: "3x4", waves: [], lead: "II", ppm: MIN_PPM, last: 0, event: undefined, becomes: "nsr", µV: null };
const cache = new Map();

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  n.append(...kids);
  return n;
};
const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  n.append(...kids);
  return n;
};

async function boot() {
  let langs, graphJson;
  try {
    [langs, graphJson, rhythms] = await Promise.all([
      loadLanguages(), fetch("heart/heart-graph.json").then((r) => r.json()), fetch("heart/rhythms.json").then((r) => r.json())]);
  } catch (e) {
    document.body.append(h("p", { class: "bad" }, String(e)));
    return;
  }
  graph = loadGraph(graphJson);
  axes = leadAxes(graph);
  states = new Uint8Array(graph.n);
  byKey = Object.fromEntries(rhythms.map((r) => [r.key, r]));
  const picker = rhythms.filter((r) => !r.hidden).map((r) => r.key);
  Object.assign(st, parseHash(location.hash, picker));
  const hp = new URLSearchParams(location.hash.slice(1));
  st.lang = startLang(langs.map((l) => l.code), hp.get("lang"));

  $("lang-select").replaceChildren(...langs.map((l) => new Option(`${l.flag} ${l.name}`, l.code)));
  $("lang-select").onchange = (e) => { saveLang(e.target.value); setLang(e.target.value); };
  $("rhythm-select").onchange = (e) => { st.rhythm = e.target.value; st.whatIf = parseHash("", picker).whatIf; st.t = 0; load(); };
  $("play").onclick = () => setPlaying(!ui.playing);
  $("replay").onclick = () => { st.t = 0; setPlaying(true); };
  $("speed").value = String(st.speed);
  $("speed").onchange = (e) => { st.speed = +e.target.value; saveHash(); };
  $("scrub").oninput = (e) => { st.t = +e.target.value; frame(); };
  $("scrub").onchange = () => saveHash();
  $("waves").onclick = (e) => {
    const k = e.target.dataset.k;
    if (!k) return;
    ui.waves = k === "all" ? (ui.waves.length === WAVES.length ? [] : [...WAVES]) : WAVES.filter((x) => (x === k) !== ui.waves.includes(x));
    draw();
  };
  $("layout").onclick = (e) => { if (e.target.dataset.layout) { ui.layout = e.target.dataset.layout; draw(); } };
  $("view-select").onclick = (e) => { if (e.target.dataset.view) setView(e.target.dataset.view); };
  $("trace").onclick = (e) => {
    const lead = e.target.closest?.("text")?.dataset.lead;
    if (lead) { ui.lead = lead; draw(); renderChestHint(); }
  };
  for (const box of document.querySelectorAll("[data-w]")) box.onchange = () => { st.whatIf = toggleWhatIf(st.whatIf, box.dataset.w, box.checked); load(); };
  $("av-delay").oninput = (e) => { st.whatIf.avDelay = +e.target.value; $("av-out").textContent = `${e.target.value} ms`; };
  $("av-delay").onchange = () => load();
  $("whatif-reset").onclick = () => { st.whatIf = parseHash("", picker).whatIf; load(); };
  if (REPO_URL) { $("repo-link").hidden = false; $("repo-link").href = REPO_URL; }
  document.addEventListener("keydown", (e) => {
    if (e.target.closest("input, select, textarea, button")) return;
    if (e.key === " ") { e.preventDefault(); setPlaying(!ui.playing); }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { st.t = wrapTime(sim, st.t + (e.key === "ArrowRight" ? 10 : -10)); frame(); }
  });
  new ResizeObserver(() => draw()).observe($("paper"));

  await setLang(st.lang);
  load();
  startViews();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches && !hp.has("t")) setPlaying(true);
}

// The 3D views load three.js only now, so the page works (tracing, ladder, captions) without WebGL.
async function startViews() {
  const msg = h("p", { class: "loading-msg" }, t("heart.loading"));
  $("heart-main").append(msg);
  try {
    const { createHeartView } = await import("./heartview.js");
    const opts = { glbUrl: "heart/heart.glb", graph, skeletonUrl: "atlas/skeleton.glb" };
    const main = await createHeartView($("heart-main"), opts);
    views = [main];
    if (matchMedia("(min-width: 700px)").matches) views.push(await createHeartView($("heart-fixed"), opts));
    msg.remove();
    await main.setView(st.view);
    syncView();
    frame();
  } catch (e) {
    console.warn(e);
    msg.textContent = t("heart.nowebgl");
    document.querySelector(".fixed-pane").hidden = true;
  }
}

async function setLang(lang) {
  st.lang = lang;
  await loadStrings(lang);
  applyDir(lang);
  $("lang-select").value = lang;
  document.querySelectorAll("[data-t]").forEach((n) => (n.textContent = t(n.dataset.t)));
  document.querySelectorAll("[data-t-aria]").forEach((n) => n.setAttribute("aria-label", t(n.dataset.tAria)));
  document.title = t("heart.title");
  $("rhythm-select").replaceChildren(...rhythms.filter((r) => !r.hidden).map((r) => new Option(localized(r.title, lang), r.key)));
  $("rhythm-select").value = st.rhythm;
  ui.event = undefined;
  renderText();
  renderChestHint();
  if (sim) frame();
}

// (Re)build the simulation for the current rhythm and what-ifs.
function load() {
  let model = byKey[st.rhythm].model;
  ui.becomes = st.rhythm;
  if (st.rhythm === "nsr") ({ model, becomes: ui.becomes } = applyWhatIf(model, st.whatIf));
  const key = JSON.stringify(model);
  if (!cache.has(key)) cache.set(key, simulate(graph, model));
  sim = cache.get(key);
  ui.µV = Object.fromEntries(LEADS.map((l) => [l, sim.leads[l].map((x) => x * 1000)]));
  st.t = wrapTime(sim, st.t);
  $("scrub").max = String(sim.duration - 1);
  $("rhythm-select").value = st.rhythm;
  ui.event = undefined;
  renderText();
  draw();
  saveHash();
}

function saveHash() {
  const hash = formatHash({ ...st, t: ui.playing ? 0 : st.t });
  history.replaceState(null, "", hash || location.pathname + location.search);
}

function setPlaying(on) {
  ui.playing = on;
  $("play").textContent = t(on ? "heart.pause" : "heart.play");
  $("play").setAttribute("aria-pressed", on);
  saveHash();
  if (on) { ui.last = performance.now(); requestAnimationFrame(tick); }
}

function tick(now) {
  if (!ui.playing) return;
  st.t = wrapTime(sim, st.t + (now - ui.last) * st.speed);
  ui.last = now;
  frame();
  requestAnimationFrame(tick);
}

async function setView(view) {
  st.view = view;
  syncView();
  await views[0]?.setView(view);
  renderChestHint();
  frame();
  saveHash();
}

function syncView() {
  for (const b of $("view-select").children) b.setAttribute("aria-checked", b.dataset.view === st.view);
}

// Everything that moves with time: heart colours, vector arrows, cursor, clock, caption.
function frame() {
  if (!sim) return;
  const ms = st.t;
  vertexState(sim, ms, states);
  const i = Math.min(Math.floor(ms), sim.duration - 1) * 3;
  for (const v of views) {
    v.setStates(states);
    v.setVectors([sim.vectors[i], sim.vectors[i + 1], sim.vectors[i + 2]], axes[ui.lead]);
  }
  const x = ((ms / 1000) * SPEED_MM).toFixed(2);
  for (const id of ["cursor", "lcursor"]) { const c = $(id); if (c) { c.setAttribute("x1", x); c.setAttribute("x2", x); } }
  $("scrub").value = String(Math.round(ms));
  $("clock").textContent = `${(ms / 1000).toFixed(2)} s / ${(sim.duration / 1000).toFixed(1)} s`;
  const e = eventAt(sim, ms);
  if (e !== ui.event) { ui.event = e; $("caption").textContent = caption(e); }
}

function caption(e) {
  if (!e) return t("heart.cap.rest");
  if (e.type === "P") return t({ retro: "heart.cap.P.retro", flutter: "heart.cap.P.flutter", af: "heart.cap.P.af" }[e.origin] ?? "heart.cap.P");
  if (e.type === "QRS") return t(["ectopic", "ventricle", "vt"].includes(e.origin) ? "heart.cap.QRS.ventricular" : e.origin === "junction" ? "heart.cap.QRS.junction" : "heart.cap.QRS");
  if (e.type === "reentry") return t(`heart.cap.reentry.${e.circuit}`);
  if (e.type === "PR") return t("heart.cap.AV");
  return t(`heart.cap.${e.type}`);
}

// Tracing (same paper as the ECG atlas) and the ladder underneath, both in paper mm on one time axis.
function draw() {
  if (!sim) return;
  const duration = sim.duration / 1000;
  const mm = paperMm(duration, SPEED_MM, ui.layout);
  ui.ppm = Math.min(MAX_PPM, Math.max(MIN_PPM, $("paper").clientWidth / mm.w));
  const svg = $("trace");
  svg.setAttribute("viewBox", `0 0 ${mm.w} ${mm.h}`);
  svg.style.width = `${mm.w * ui.ppm}px`;
  svg.style.height = `${mm.h * ui.ppm}px`;
  const waves = sim.events.filter((e) => ui.waves.includes(e.type)).map((e) => ({ k: e.type, on: (e.t0 * sim.fs) / 1000, off: (e.t1 * sim.fs) / 1000 }));
  const bands = el("g", { class: "waves" }), traces = el("g", { class: "traces" }), labels = el("g", { class: "leads" });
  for (const panel of panels(duration, ui.layout)) {
    for (const b of waveBands(waves, sim.fs, panel, SPEED_MM)) bands.append(el("rect", { class: `w-${b.k}`, x: b.x, y: b.y + 1, width: b.w, height: b.h - 2 }));
    traces.append(el("path", { d: pathData(tracePoints(ui.µV[panel.lead], sim.fs, panel, { speed: SPEED_MM, gain: GAIN, ppm: 1 })) }));
    const x = panel.t0 * SPEED_MM, top = panel.row * ROW_MM;
    labels.append(el("text", { x: x + 1, y: top + 4, "data-lead": panel.lead, class: panel.lead === ui.lead ? "hl" : "" }, panel.lead));
    if (panel.t0 > 0) labels.append(el("line", { x1: x, x2: x, y1: top + ROW_MM * 0.3, y2: top + ROW_MM * 0.7 }));
  }
  svg.replaceChildren(gridDefs(), el("rect", { class: "bg", width: mm.w, height: mm.h }), el("rect", { width: mm.w, height: mm.h, fill: "url(#grid5)" }),
    bands, traces, labels, el("line", { id: "cursor", class: "cursor", y1: 0, y2: mm.h }));

  const lad = $("ladder");
  lad.setAttribute("viewBox", `0 0 ${mm.w} ${LADDER_MM}`);
  lad.style.width = svg.style.width;
  lad.style.height = `${LADDER_MM * ui.ppm}px`;
  const row = LADDER_MM / 3, y = (v) => v * row;
  const g = el("g", { class: "rows" });
  for (let r = 1; r < 3; r++) g.append(el("line", { x1: 0, x2: mm.w, y1: y(r), y2: y(r) }));
  ["A", "AV", "V"].forEach((name, r) => g.append(el("text", { x: 1, y: y(r) + 4 }, name)));
  const lines = el("g", { class: "lines" });
  for (const l of ladderLines(sim.events)) {
    const x0 = (l.t0 / 1000) * SPEED_MM, x1 = (l.t1 / 1000) * SPEED_MM;
    lines.append(el("line", { x1: x0, y1: y(l.y0), x2: x1, y2: y(l.y1), class: l.retro ? "retro" : l.blocked ? "blocked" : "" }));
    if (l.blocked) lines.append(el("line", { x1: x1 - 1.2, x2: x1 + 1.2, y1: y(l.y1), y2: y(l.y1), class: "blocked" }));
  }
  lad.replaceChildren(el("rect", { class: "bg", width: mm.w, height: LADDER_MM }), g, lines, el("line", { id: "lcursor", class: "cursor", y1: 0, y2: LADDER_MM }));
  for (const b of $("waves").children) b.setAttribute("aria-pressed", b.dataset.k === "all" ? ui.waves.length === WAVES.length : ui.waves.includes(b.dataset.k));
  for (const b of $("layout").children) b.setAttribute("aria-checked", b.dataset.layout === ui.layout);
  frame();
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

// Title, why panel and what-if row.
function renderText() {
  const r = byKey[ui.becomes] ?? byKey[st.rhythm];
  $("rhythm-title").textContent = localized(byKey[st.rhythm].title, st.lang);
  const see = r.atlasEcg != null
    ? h("a", { class: "btn see", href: `ecg.html#ecg=${r.atlasEcg}` }, t("heart.see"))
    : h("p", { class: "muted" }, t("heart.noatlas"));
  $("why").replaceChildren(
    h("h2", {}, localized(r.title, st.lang)),
    h("h3", {}, t("heart.why")),
    h("ol", {}, ...localized(r.why, st.lang).map((s) => h("li", {}, s))),
    h("h3", {}, t("heart.looks")),
    h("ul", {}, ...localized(r.looks, st.lang).map((s) => h("li", {}, s))),
    see);
  const w = $("whatif");
  w.hidden = st.rhythm !== "nsr";
  if (!w.hidden) {
    for (const box of document.querySelectorAll("[data-w]")) box.checked = st.whatIf[box.dataset.w];
    $("av-delay").value = String(st.whatIf.avDelay);
    $("av-out").textContent = `${st.whatIf.avDelay} ms`;
    $("becomes").textContent = ui.becomes === "nsr" ? "" : t("heart.becomes", { rhythm: localized(byKey[ui.becomes].title, st.lang) });
  }
}

function renderChestHint() {
  $("chest-hint").hidden = st.view !== "chest";
  $("chest-hint").textContent = t("heart.chest.hint", { lead: ui.lead });
}

boot();
