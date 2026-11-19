// ECG page DOM wiring. Geometry lives in ecgplot.js.
import { measure, panels, paperMm, tracePoints, ROW_MM } from "./ecgplot.js";
import { applyDir, loadLanguages, loadStrings, localized, pickLang, t } from "./i18n.js";
import { REPO_URL } from "./report.js";

const $ = (id) => document.getElementById(id);
const MIN_PPM = 3; // px per mm floor; narrower screens scroll sideways

let langs = [], list = [], ecg = null;
const st = { ecg: null, lang: "en", speed: 25, gain: 10, layout: "3x4", quiz: false };
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

  $("lang-select").replaceChildren(...langs.map((l) => new Option(l.name, l.code)));
  $("lang-select").onchange = (e) => setLang(e.target.value);
  $("ecg-select").onchange = (e) => openEcg(e.target.value);
  $("speed").onchange = (e) => { st.speed = +e.target.value; draw(); };
  $("gain").onchange = (e) => { st.gain = +e.target.value; draw(); };
  $("layout").onclick = (e) => { if (e.target.dataset.layout) { st.layout = e.target.dataset.layout; draw(); } };
  $("calipers").onclick = () => { ui.calipers = !ui.calipers; clearOverlay(); sync(); };
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

// Everything language- or quiz-dependent.
function renderText() {
  $("ecg-select").replaceChildren(...list.map((e, i) =>
    new Option(st.quiz ? t("ecg.unknown", { n: i + 1 }) : localized(e.title, st.lang), e.id)));
  $("ecg-select").value = st.ecg;
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
  sync();
}

function sync() {
  $("speed").value = st.speed;
  $("gain").value = st.gain;
  document.querySelectorAll("#layout [data-layout]").forEach((b) => b.setAttribute("aria-checked", b.dataset.layout === st.layout));
  $("calipers").setAttribute("aria-pressed", ui.calipers);
  $("paper").classList.toggle("measuring", ui.calipers);
  $("scale-info").textContent = `${st.speed} mm/s · ${st.gain} mm/mV`;
  const q = new URLSearchParams({ ecg: st.ecg, lang: st.lang, speed: st.speed, gain: st.gain, layout: st.layout });
  if (st.quiz) q.set("quiz", "1");
  history.replaceState(null, "", `#${q}`);
}

function draw() {
  if (!ecg) return;
  const n = ecg.leads.I.length, duration = n / ecg.fs;
  const mm = paperMm(duration, st.speed, st.layout);
  ui.ppm = Math.max(MIN_PPM, $("paper").clientWidth / mm.w);
  const w = Math.round(mm.w * ui.ppm), h = Math.round(mm.h * ui.ppm), dpr = devicePixelRatio || 1;
  for (const c of [$("trace"), $("overlay")]) {
    c.width = w * dpr; c.height = h * dpr;
    c.style.width = `${w}px`; c.style.height = `${h}px`;
    c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  const g = $("trace").getContext("2d");
  g.fillStyle = "#fff7f4";
  g.fillRect(0, 0, w, h);
  for (let i = 0; i * ui.ppm <= w || i * ui.ppm <= h; i++) {
    g.strokeStyle = i % 5 ? "#f6cfcf" : "#e69a9a";
    g.lineWidth = i % 5 ? 0.5 : 1;
    g.beginPath();
    const p = Math.round(i * ui.ppm) + 0.5;
    if (p <= w) { g.moveTo(p, 0); g.lineTo(p, h); }
    if (p <= h) { g.moveTo(0, p); g.lineTo(w, p); }
    g.stroke();
  }
  const scale = { speed: st.speed, gain: st.gain, ppm: ui.ppm };
  g.strokeStyle = "#111";
  g.lineWidth = 1.2;
  g.lineJoin = "round";
  g.fillStyle = "#111";
  g.font = `600 ${Math.max(11, ui.ppm * 3.2)}px "IBM Plex Mono", monospace`;
  for (const panel of panels(duration, st.layout)) {
    const pts = tracePoints(ecg.leads[panel.lead], ecg.fs, panel, scale);
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let k = 2; k < pts.length; k += 2) g.lineTo(pts[k], pts[k + 1]);
    g.stroke();
    const x = panel.t0 * st.speed * ui.ppm, top = panel.row * ROW_MM * ui.ppm;
    g.fillText(panel.lead, x + 4, top + ui.ppm * 4);
    if (panel.t0 > 0) { g.fillRect(x - 0.5, top + ROW_MM * ui.ppm * 0.3, 1.5, ROW_MM * ui.ppm * 0.4); }
  }
  sync();
}

function clearOverlay() {
  const c = $("overlay");
  c.getContext("2d").clearRect(0, 0, c.width, c.height);
  $("readout").textContent = "";
}

function wireCalipers() {
  const c = $("overlay");
  const at = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  c.onpointerdown = (e) => {
    if (!ui.calipers) return;
    c.setPointerCapture(e.pointerId);
    ui.drag = { a: at(e) };
  };
  c.onpointermove = (e) => {
    if (!ui.drag) return;
    const { a } = ui.drag, b = at(e), g = c.getContext("2d");
    clearOverlay();
    g.strokeStyle = "#1565c0"; g.fillStyle = "#1565c0"; g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(a.x, 0); g.lineTo(a.x, c.clientHeight);
    g.moveTo(b.x, 0); g.lineTo(b.x, c.clientHeight);
    g.moveTo(a.x, a.y); g.lineTo(b.x, a.y); g.lineTo(b.x, b.y);
    g.stroke();
    const m = measure(b.x - a.x, b.y - a.y, { speed: st.speed, gain: st.gain, ppm: ui.ppm });
    const text = t("ecg.measure", { ms: m.ms, bpm: m.bpm ?? "—", mv: m.mv });
    $("readout").textContent = text;
    g.font = '600 13px "IBM Plex Mono", monospace';
    g.fillText(text, Math.min(a.x, b.x) + 4, Math.max(14, Math.min(a.y, b.y) - 6));
  };
  c.onpointerup = c.onpointercancel = () => (ui.drag = null);
}

function showError(e) {
  console.error(e);
  $("ecg-title").textContent = t("error.load");
}

boot();
