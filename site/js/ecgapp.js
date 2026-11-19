// ECG page DOM wiring. Geometry lives in ecgplot.js. The paper is one SVG in millimetre units.
import { measure, panels, paperMm, pathData, tracePoints, waveBands, ROW_MM } from "./ecgplot.js";
import { applyDir, loadLanguages, loadStrings, localized, pickLang, t } from "./i18n.js";
import { REPO_URL } from "./report.js";

const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const MIN_PPM = 3; // px per mm floor; narrower screens scroll sideways
const GROUPS = ["normal", "rhythm", "conduction", "hypertrophy", "ischaemia", "other"];

let langs = [], list = [], ecg = null;
const st = { ecg: null, lang: "en", speed: 25, gain: 10, layout: "3x4", quiz: false, waves: false };
const ui = { calipers: false, ppm: MIN_PPM, drag: null };

async function boot() {
  try {
    [langs, list] = await Promise.all([loadLanguages(), fetch("ecg/index.json").then((r) => r.json())]);
  } catch (e) {
    return showError(e);
  }
  const h = new URLSearchParams(location.hash.slice(1));
  const codes = langs.map((l) => l.code);
  st.lang = codes.includes(h.get("lang")) ? h.get("lang") : pickLang(codes, navigator.languages || [navigator.language]);
  st.ecg = list.some((e) => String(e.id) === h.get("ecg")) ? h.get("ecg") : String(list[0].id);
  if (["25", "50"].includes(h.get("speed"))) st.speed = +h.get("speed");
  if (["5", "10", "20"].includes(h.get("gain"))) st.gain = +h.get("gain");
  if (["3x4", "12x1"].includes(h.get("layout"))) st.layout = h.get("layout");
  st.quiz = h.get("quiz") === "1";
  st.waves = h.get("waves") === "1";

  $("lang-select").replaceChildren(...langs.map((l) => new Option(l.name, l.code)));
  $("lang-select").onchange = (e) => setLang(e.target.value);
  $("ecg-select").onchange = (e) => openEcg(e.target.value);
  $("speed").onchange = (e) => { st.speed = +e.target.value; draw(); };
  $("gain").onchange = (e) => { st.gain = +e.target.value; draw(); };
  $("layout").onclick = (e) => { if (e.target.dataset.layout) { st.layout = e.target.dataset.layout; draw(); } };
  $("calipers").onclick = () => { ui.calipers = !ui.calipers; clearCalipers(); sync(); };
  $("waves").onclick = () => { st.waves = !st.waves; draw(); };
  $("quiz").onchange = (e) => { st.quiz = e.target.checked; $("answer").open = false; renderText(); };
  if (REPO_URL) { $("repo-link").hidden = false; $("repo-link").href = REPO_URL; }
  wireCalipers();
  new ResizeObserver(() => draw()).observe($("paper"));

  await setLang(st.lang);
  await openEcg(st.ecg);
}

async function setLang(lang) {
  st.lang = lang;
  await loadStrings(lang);
  applyDir(lang);
  $("lang-select").value = lang;
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  document.querySelectorAll("[data-t-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.tAria)));
  document.title = t("ecg.title");
  renderText();
}

async function openEcg(id) {
  st.ecg = String(id);
  try {
    ecg = await (await fetch(`ecg/${id}.json`)).json();
  } catch (e) {
    return showError(e);
  }
  $("answer").open = false;
  renderText();
  draw();
}

// Picker: grouped by topic normally; a flat numbered list in quiz mode (groups would give it away).
function buildPicker() {
  const sel = $("ecg-select");
  if (st.quiz) {
    sel.replaceChildren(...list.map((e, i) => new Option(t("ecg.unknown", { n: i + 1 }), e.id)));
  } else {
    sel.replaceChildren(...GROUPS.map((g) => {
      const og = document.createElement("optgroup");
      og.label = t(`ecg.group.${g}`);
      og.append(...list.filter((e) => e.group === g).map((e) => new Option(localized(e.title, st.lang), e.id)));
      return og;
    }).filter((og) => og.children.length));
  }
  sel.value = st.ecg;
}

// Everything language- or quiz-dependent.
function renderText() {
  buildPicker();
  $("quiz").checked = st.quiz;
  if (!ecg) return sync();
  $("ecg-title").textContent = st.quiz ? "" : localized(ecg.title, st.lang);
  const facts = [
    ecg.age != null && `${t("ecg.age")}: ${ecg.age}`,
    ecg.sex && `${t("ecg.sex")}: ${t(`ecg.sex.${ecg.sex}`)}`,
    ecg.axis && `${t("ecg.axis")}: ${ecg.axis}`,
  ].filter(Boolean);
  const items = ecg.statements.map((s) => {
    const li = document.createElement("li");
    li.textContent = `${s.text} (${s.code}${s.likelihood > 0 ? `, ${s.likelihood}%` : ""})`;
    return li;
  });
  const h = document.createElement("strong");
  h.textContent = localized(ecg.title, st.lang);
  const p = document.createElement("p");
  p.textContent = facts.join(" · ");
  const sub = document.createElement("p");
  sub.className = "muted";
  sub.textContent = t("ecg.statements");
  const ul = document.createElement("ul");
  ul.append(...items);
  $("answer-body").replaceChildren(h, p, sub, ul);
  $("credit").textContent = t("ecg.credit", { source: ecg.source.name, license: ecg.source.license });
  $("credit").href = ecg.source.url;
  $("credit-waves").textContent = t("ecg.wavesCredit", { source: ecg.wavesSource.name, license: ecg.wavesSource.license });
  $("credit-waves").href = ecg.wavesSource.url;
  sync();
}

function sync() {
  $("speed").value = st.speed;
  $("gain").value = st.gain;
  document.querySelectorAll("#layout [data-layout]").forEach((b) => b.setAttribute("aria-checked", b.dataset.layout === st.layout));
  $("calipers").setAttribute("aria-pressed", ui.calipers);
  $("waves").setAttribute("aria-pressed", st.waves);
  $("paper").classList.toggle("measuring", ui.calipers);
  $("scale-info").textContent = `${st.speed} mm/s · ${st.gain} mm/mV`;
  const q = new URLSearchParams({ ecg: st.ecg, lang: st.lang, speed: st.speed, gain: st.gain, layout: st.layout });
  if (st.quiz) q.set("quiz", "1");
  if (st.waves) q.set("waves", "1");
  history.replaceState(null, "", `#${q}`);
}

const el = (tag, attrs = {}, text) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (text != null) n.textContent = text;
  return n;
};

function draw() {
  if (!ecg) return;
  const duration = ecg.leads.I.length / ecg.fs;
  const mm = paperMm(duration, st.speed, st.layout);
  ui.ppm = Math.max(MIN_PPM, $("paper").clientWidth / mm.w);
  const svg = $("trace");
  svg.setAttribute("viewBox", `0 0 ${mm.w} ${mm.h}`);
  svg.style.width = `${mm.w * ui.ppm}px`;
  svg.style.height = `${mm.h * ui.ppm}px`;

  const bands = el("g", { class: "waves" }), traces = el("g", { class: "traces" }), labels = el("g", { class: "leads" });
  const scale = { speed: st.speed, gain: st.gain, ppm: 1 }; // ppm 1 → coordinates in paper mm
  for (const panel of panels(duration, st.layout)) {
    if (st.waves) {
      for (const b of waveBands(ecg.waves, ecg.fs, panel, st.speed)) {
        bands.append(el("rect", { class: `w-${b.k}`, x: b.x, y: b.y + 1, width: b.w, height: b.h - 2 }));
        if (b.w > 1) bands.append(el("text", { class: `w-${b.k}`, x: b.x + b.w / 2, y: b.y + b.h - 2 }, b.k));
      }
    }
    traces.append(el("path", { d: pathData(tracePoints(ecg.leads[panel.lead], ecg.fs, panel, scale)) }));
    const x = panel.t0 * st.speed, top = panel.row * ROW_MM;
    labels.append(el("text", { x: x + 1, y: top + 4 }, panel.lead));
    if (panel.t0 > 0) labels.append(el("line", { x1: x, x2: x, y1: top + ROW_MM * 0.3, y2: top + ROW_MM * 0.7 }));
  }
  svg.replaceChildren(
    el("rect", { class: "bg", width: mm.w, height: mm.h }),
    el("rect", { width: mm.w, height: mm.h, fill: "url(#grid5)" }),
    bands, traces, labels, el("g", { id: "cal" }),
  );
  svg.prepend(gridDefs());
  sync();
}

// 1 mm minor and 5 mm major grid as SVG patterns; stays crisp at any zoom.
function gridDefs() {
  const defs = el("defs");
  const p1 = el("pattern", { id: "grid1", width: 1, height: 1, patternUnits: "userSpaceOnUse" });
  p1.append(el("path", { d: "M1 0V1H0", class: "g1" }));
  const p5 = el("pattern", { id: "grid5", width: 5, height: 5, patternUnits: "userSpaceOnUse" });
  p5.append(el("rect", { width: 5, height: 5, fill: "url(#grid1)" }), el("path", { d: "M5 0V5H0", class: "g5" }));
  defs.append(p1, p5);
  return defs;
}

function clearCalipers() {
  $("cal")?.replaceChildren();
  $("readout").textContent = "";
}

function wireCalipers() {
  const svg = $("trace");
  const at = (e) => { const r = svg.getBoundingClientRect(); return { x: (e.clientX - r.left) / ui.ppm, y: (e.clientY - r.top) / ui.ppm }; };
  svg.onpointerdown = (e) => {
    if (!ui.calipers) return;
    svg.setPointerCapture(e.pointerId);
    ui.drag = { a: at(e) };
  };
  svg.onpointermove = (e) => {
    if (!ui.drag) return;
    const { a } = ui.drag, b = at(e), h = svg.viewBox.baseVal.height;
    const m = measure(b.x - a.x, b.y - a.y, { speed: st.speed, gain: st.gain, ppm: 1 });
    const text = t("ecg.measure", { ms: m.ms, bpm: m.bpm ?? "—", mv: m.mv });
    $("readout").textContent = text;
    $("cal").replaceChildren(
      el("path", { d: `M${a.x} 0V${h}M${b.x} 0V${h}M${a.x} ${a.y}H${b.x}V${b.y}` }),
      el("text", { x: Math.min(a.x, b.x) + 1, y: Math.max(4, Math.min(a.y, b.y) - 1.5) }, text),
    );
  };
  svg.onpointerup = svg.onpointercancel = () => (ui.drag = null);
}

function showError(e) {
  console.error(e);
  $("ecg-title").textContent = t("error.load");
}

boot();
