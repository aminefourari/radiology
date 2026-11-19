// DOM wiring only. Logic worth testing lives in the DOM-free modules.
import { PLANES, WINDOWS, extractSlice, loadCase, pixelAspect, planeSize, sliceCount, windowToGray } from "./volume.js";
import { colorTable, compositeOverlay, visibleIds } from "./overlay.js";
import { anchors, bodyExtent, layoutLabels } from "./labels.js";
import { clampState, formatHash, parseHash } from "./state.js";
import { applyDir, loadLanguages, loadStrings, localized, pickLang, structName, t } from "./i18n.js";
import { REPO_URL, reportUrl } from "./report.js";

const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const ICONS = {
  organs: '<path d="M9 4c-3 0-5 3-5 7s2 9 6 9c2 0 2-2 2-4V8c0-2-1-4-3-4zM15 4c3 0 5 3 5 7s-2 9-6 9"/>',
  segments: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>',
  digestive: '<path d="M7 4h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8"/><path d="M17 16v4"/>',
  urinary: '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>',
  pelvis: '<path d="M4 6c2 0 4 2 5 5h6c1-3 3-5 5-5M4 6c0 7 3 12 8 12s8-5 8-12"/><circle cx="12" cy="13" r="2"/>',
  spine: '<rect x="8" y="3" width="8" height="4" rx="1.5"/><rect x="8" y="10" width="8" height="4" rx="1.5"/><rect x="8" y="17" width="8" height="4" rx="1.5"/>',
  arteries: '<path d="M12 21V11M12 11L6 4M12 11l6-7"/>',
  veins: '<path d="M12 3v10M12 13l-6 7M12 13l6 7"/>',
  brain: '<path d="M12 5c-2-2-6-1-6 2-2 1-2 4 0 5-1 3 2 5 4 4 1 2 4 2 4 0 2 1 5-1 4-4 2-1 2-4 0-5 0-3-4-4-6-2z"/><path d="M12 5v13"/>',
  lobes: '<path d="M4 13c0-5 4-9 8-9s8 4 8 9c0 3-2 5-5 5H9c-3 0-5-2-5-5z"/><path d="M12 4v9M12 13l-6 3M12 13l7 2"/>',
  "deep-nuclei": '<path d="M4 13c0-5 4-9 8-9s8 4 8 9c0 3-2 5-5 5H9c-3 0-5-2-5-5z"/><circle cx="10" cy="12" r="1.8"/><circle cx="14" cy="12" r="1.8"/>',
  "posterior-fossa": '<path d="M5 9c0-3 3-5 7-5s7 2 7 5"/><path d="M6 12c2 3 10 3 12 0M12 12v8"/>',
  "meninges-sinuses": '<path d="M4 14c0-6 4-10 8-10s8 4 8 10"/><path d="M7 14c0-4 2-7 5-7s5 3 5 7"/>',
  ventricles: '<path d="M8 6c-2 2-2 6 0 8l2 2M16 6c2 2 2 6 0 8l-2 2"/><path d="M12 16v4"/>',
  orbit: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/>',
  "glands-airway": '<path d="M9 3v7c0 3-3 4-3 8M15 3v7c0 3 3 4 3 8"/><circle cx="12" cy="18" r="2"/>',
  vessels: '<path d="M8 21V9c0-3 2-5 4-5M16 21V9c0-3-2-5-4-5"/>',
  "skull-face": '<path d="M5 11a7 7 0 0 1 14 0v3l-2 1v4H7v-4l-2-1z"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/>',
  mastication: '<path d="M4 10c2-4 14-4 16 0M5 14c3 4 11 4 14 0"/><path d="M8 10v4M12 9v5M16 10v4"/>',
  larynx: '<path d="M8 3h8l-1 6H9zM9 9l1 12M15 9l-1 12"/>',
  "pharynx-esophagus": '<path d="M10 3v7c0 4 4 5 4 11"/><path d="M14 3v4"/>',
  thyroid: '<path d="M12 10c-1-4-7-5-7 1s5 6 7 2c2 4 7 3 7-2s-6-5-7-1z"/>',
  "neck-muscles": '<path d="M7 4l5 16M17 4l-5 16M9 4h6"/>',
  lungs: '<path d="M11 5v6c0 6-2 9-5 9s-3-4-2-8 4-7 7-7zM13 5v6c0 6 2 9 5 9s3-4 2-8-4-7-7-7z"/>',
  airway: '<path d="M12 3v9M12 12l-5 6M12 12l5 6"/><path d="M10 5h4M10 8h4"/>',
  heart: '<path d="M12 20s-8-5-8-11a4 4 0 0 1 8-1 4 4 0 0 1 8 1c0 6-8 11-8 11z"/>',
  "heart-vessels": '<path d="M12 20s-7-4-7-9a3.5 3.5 0 0 1 7-1"/><path d="M12 10V4c3 0 6 2 6 5"/>',
  "chest-wall": '<path d="M12 4v16M12 7c-4 0-7 1-8 3M12 11c-4 0-7 1-8 3M12 15c-4 0-6 1-7 3M12 7c4 0 7 1 8 3M12 11c4 0 7 1 8 3M12 15c4 0 6 1 7 3"/>',
  "limb-bones": '<path d="M9 4a2 2 0 1 1 3 2l-1 12a2 2 0 1 1-3 2"/><path d="M15 4a2 2 0 1 0-3 2"/>',
  "limb-muscles": '<path d="M9 3c-3 5-3 13 1 18M15 3c3 5 3 13-1 18"/>',
};
const ICON_FALLBACK = '<circle cx="12" cy="12" r="6"/>';
const MARKS = { axial: ["A", "P", "R", "L"], coronal: ["S", "I", "R", "L"], sagittal: ["S", "I", "A", "P"] };
const LINE_H = 20;

let langs = [], cases = [], data = null;
let st = { case: null, lang: "en", plane: "axial", slice: 0, sys: [], zoom: 1 };
const caseSystems = () => (data ? data.meta.systems.map((s) => s.key) : []);
const ctx = () => ({
  cases: cases.map((c) => c.id), langs: langs.map((l) => l.code), dims: data?.meta.dims ?? null,
  systems: data ? caseSystems() : null, defaultSystems: data?.meta.defaultSystems ?? null,
});
const ui = { hidden: new Set(), pan: { x: 0, y: 0 }, move: false, win: "soft", opacity: 0.45, labels: true, outline: false, selected: 0, geo: null };

// ---------- boot ----------
async function boot() {
  try {
    [langs, cases] = await Promise.all([loadLanguages(), fetch("cases/index.json", { cache: "no-cache" }).then((r) => r.json())]);
  } catch (e) {
    showError(e);
    return;
  }
  const codes = langs.map((l) => l.code);
  const raw = parseHash(location.hash);
  const fromHash = clampState(raw, ctx());
  st = { ...fromHash, lang: fromHash.lang || pickLang(codes, navigator.languages || [navigator.language]) };
  buildStatic();
  await setLang(st.lang);
  await openCase(st.case, raw);
  addEventListener("hashchange", onHashChange);
}

async function setLang(lang) {
  st.lang = lang;
  await loadStrings(lang);
  applyDir(lang);
  $("lang-select").value = lang;
  document.querySelectorAll("[data-t]").forEach((el) => (el.textContent = t(el.dataset.t)));
  document.querySelectorAll("[data-t-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.tAria)));
  document.title = t("app.title");
  buildPlanes();
  buildRegions();
  if (data) buildCaseUi();
  update();
}

// wanted: the plane/slice/sys a link asked for, or null to start the case at its defaults.
async function openCase(id, wanted) {
  const prevCase = data?.meta.id;
  $("loading").hidden = false;
  $("loading-text").textContent = t("loading", { pct: 0 });
  try {
    data = await loadCase(`cases/${id}`, (f) => {
      $("loading-bar").style.width = `${Math.round(f * 100)}%`;
      $("loading-text").textContent = t("loading", { pct: Math.round(f * 100) });
    });
  } catch (e) {
    showError(e);
    return;
  }
  const w = wanted ?? { plane: "axial", slice: null, sys: null };
  st = clampState({ ...st, case: id, plane: w.plane, slice: w.slice, sys: w.sys }, ctx());
  st.lang ||= "en";
  ui.hidden.clear();
  ui.selected = 0;
  ui.pan = { x: 0, y: 0 };
  if (id !== prevCase || !data.meta.windows.includes(ui.win)) ui.win = data.meta.windows[0]; // each region opens in its own first window
  $("loading").hidden = true;
  buildCaseUi();
  update();
}

function showError(e) {
  console.error(e);
  $("loading").hidden = false;
  $("loading-text").textContent = t("error.load");
  $("loading-bar").parentElement.hidden = true;
}

// ---------- static UI ----------
function buildStatic() {
  $("lang-select").replaceChildren(...langs.map((l) => new Option(`${l.flag} ${l.name}`, l.code)));
  $("lang-select").onchange = (e) => setLang(e.target.value);
  $("sys-toggle").onclick = () => { st.sys = st.sys.length ? [] : caseSystems(); update(); };
  $("zoom-in").onclick = () => setZoom(st.zoom * 1.25);
  $("zoom-out").onclick = () => setZoom(st.zoom / 1.25);
  $("zoom-fit").onclick = () => { ui.pan = { x: 0, y: 0 }; setZoom(1); };
  $("move").onclick = () => { ui.move = !ui.move; update(); };
  $("focus").onclick = () => toggleFocus(!document.body.classList.contains("focus"));
  $("prev").onclick = () => step(-1);
  $("next").onclick = () => step(1);
  $("slider").oninput = (e) => { st.slice = Number(e.target.value); update(); };
  $("win-select").onchange = (e) => { ui.win = e.target.value; update(); };
  $("btn-structures").onclick = () => $("dlg-structures").showModal();
  document.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => b.closest("dialog").close()));
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => e.target === d && d.close()));
  $("opacity").oninput = (e) => { ui.opacity = Number(e.target.value); update(); };
  $("labels-on").onchange = (e) => { ui.labels = e.target.checked; update(); };
  $("outline").onchange = (e) => { ui.outline = e.target.checked; update(); };
  if (REPO_URL) { $("repo-link").hidden = false; $("repo-link").href = REPO_URL; }
  bindViewer();
  new ResizeObserver(() => data && update()).observe($("viewer"));
}

function buildSystems() {
  const keys = caseSystems();
  $("system-bar").replaceChildren(...data.meta.systems.map(({ key, icon, color, names }) => {
    const b = document.createElement("button");
    b.className = "sys";
    b.dataset.sys = key;
    b.style.setProperty("--c", color);
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[icon] ?? ICON_FALLBACK}</svg><span></span>`;
    b.querySelector("span").textContent = localized(names, st.lang);
    b.onclick = () => { st.sys = st.sys.includes(key) ? st.sys.filter((s) => s !== key) : keys.filter((s) => s === key || st.sys.includes(s)); update(); };
    return b;
  }));
}

function buildRegions() {
  const bar = $("region-bar");
  bar.hidden = cases.length < 2;
  bar.replaceChildren(...cases.map((c) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.dataset.case = c.id;
    b.textContent = t(`region.${c.region}`);
    b.onclick = () => { if (c.id !== st.case) openCase(c.id, null); };
    return b;
  }));
}

function buildPlanes() {
  $("plane-group").replaceChildren(...PLANES.map((p) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.setAttribute("role", "radio");
    b.dataset.plane = p;
    b.textContent = t(`plane.${p}`);
    b.onclick = () => setPlane(p, null);
    return b;
  }));
}

function buildWindows() {
  $("win-select").replaceChildren(...data.meta.windows.filter((k) => WINDOWS[k]).map((k) => new Option(t(`win.${k}`), k)));
  $("win-select").value = ui.win;
}

function buildCaseUi() {
  const { meta } = data;
  const entry = cases.find((c) => c.id === st.case);
  $("case-title").textContent = localized(entry?.title, st.lang);
  buildSystems();
  buildWindows();
  $("credit").textContent = t("footer.credit", { source: meta.source.name, license: meta.source.license });
  $("credit").href = meta.source.url;

  $("levels").replaceChildren(...meta.keyLevels.map((k) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = localized(k.names, st.lang);
    b.onclick = () => setPlane("axial", k.axial);
    return b;
  }));
  $("levels").parentElement.hidden = !meta.keyLevels.length;

  const list = $("structure-list");
  list.replaceChildren();
  for (const sys of meta.systems) {
    const items = meta.structures.filter((s) => s.system === sys.key);
    if (!items.length) continue;
    const h = document.createElement("h3");
    h.textContent = localized(sys.names, st.lang);
    list.append(h);
    for (const s of items) {
      const row = document.createElement("div");
      row.className = "struct";
      row.style.setProperty("--c", s.color);
      const cb = Object.assign(document.createElement("input"), { type: "checkbox", checked: !ui.hidden.has(s.id) });
      cb.setAttribute("aria-label", structName(s, st.lang));
      cb.onchange = () => { cb.checked ? ui.hidden.delete(s.id) : ui.hidden.add(s.id); update(); };
      const sw = Object.assign(document.createElement("span"), { className: "sw" });
      const name = Object.assign(document.createElement("button"), { textContent: structName(s, st.lang), title: t("jump") });
      name.onclick = () => { $("dlg-structures").close(); jumpTo(s); };
      row.append(cb, sw, name, reportLink(s) || document.createElement("span"));
      list.append(row);
    }
  }
}

function reportLink(s) {
  if (!REPO_URL) return null;
  const a = Object.assign(document.createElement("a"), { textContent: t("report"), target: "_blank", rel: "noopener" });
  a.href = reportUrl(REPO_URL, { caseId: st.case, structureKey: s.key, structureName: structName(s, "en"), lang: st.lang, plane: st.plane, slice: st.slice, shareUrl: location.href });
  return a;
}

// ---------- state changes ----------
function setPlane(plane, slice) {
  st.plane = plane;
  st.slice = slice ?? Math.floor(sliceCount(data.meta.dims, plane) / 2);
  ui.pan = { x: 0, y: 0 };
  ui.selected = 0;
  update();
}

function jumpTo(s) {
  if (!st.sys.includes(s.system)) st.sys = caseSystems().filter((k) => k === s.system || st.sys.includes(k));
  ui.hidden.delete(s.id);
  setPlane(st.plane, s.best[st.plane]);
  ui.selected = s.id;
  update();
}

function step(d) {
  const n = sliceCount(data.meta.dims, st.plane);
  st.slice = Math.min(n - 1, Math.max(0, st.slice + d));
  update();
}

function setZoom(z) {
  st.zoom = Math.min(8, Math.max(0.25, z));
  if (st.zoom <= 1) { ui.pan = { x: 0, y: 0 }; ui.move = false; }
  update();
}

function toggleFocus(on) {
  document.body.classList.toggle("focus", on);
  $("focus").setAttribute("aria-pressed", String(on));
  update();
}

let hashTimer = 0;
function syncHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => history.replaceState(null, "", formatHash(st)), 150);
}

function onHashChange() {
  const raw = parseHash(location.hash);
  // A link to another case: open it with the link's own plane/slice/systems, not this case's.
  if (raw.case && raw.case !== st.case && cases.some((c) => c.id === raw.case)) {
    if (raw.lang && raw.lang !== st.lang) setLang(raw.lang);
    return openCase(raw.case, raw);
  }
  const next = clampState({ ...raw, case: st.case }, ctx());
  if (next.lang && next.lang !== st.lang) setLang(next.lang);
  Object.assign(st, next, { lang: next.lang || st.lang });
  update();
}

// ---------- render ----------
let frame = 0;
function update() {
  syncControls();
  syncHash();
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(render);
}

function syncControls() {
  document.querySelectorAll(".sys").forEach((b) => b.setAttribute("aria-pressed", String(st.sys.includes(b.dataset.sys))));
  document.querySelectorAll("#plane-group .btn").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.plane === st.plane)));
  document.querySelectorAll("#region-bar .btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.case === st.case)));
  $("zoom-fit").hidden = st.zoom === 1 && !ui.pan.x && !ui.pan.y;
  $("move").hidden = st.zoom <= 1;
  $("move").setAttribute("aria-pressed", String(ui.move));
  $("viewer").classList.toggle("moving", ui.move);
  if (!data) return;
  $("sys-toggle").textContent = t(st.sys.length ? "ctl.none" : "ctl.all");
  const n = sliceCount(data.meta.dims, st.plane);
  Object.assign($("slider"), { max: n - 1, value: st.slice });
  $("slice-val").textContent = `${t(`plane.${st.plane}`)} ${st.slice + 1} / ${n}`;
  const [w, h] = planeSize(data.meta.dims, st.plane);
  $("plane-info").textContent = `${t(`plane.${st.plane}`)} ${w} × ${h}`;
  const [top, bottom, left, right] = MARKS[st.plane];
  Object.assign($("mk-top"), { textContent: top });
  Object.assign($("mk-bottom"), { textContent: bottom });
  Object.assign($("mk-left"), { textContent: left });
  Object.assign($("mk-right"), { textContent: right });
}

const off = document.createElement("canvas");
function render() {
  if (!data) return;
  const { meta, ct, labels } = data;
  const canvas = $("canvas"), viewer = $("viewer");
  const cw = viewer.clientWidth, ch = viewer.clientHeight, dpr = devicePixelRatio || 1;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const [w, h] = planeSize(meta.dims, st.plane);
  const ctSlice = extractSlice(ct, meta.dims, st.plane, st.slice);
  const labSlice = extractSlice(labels, meta.dims, st.plane, st.slice);
  const img = new ImageData(w, h);
  const win = WINDOWS[ui.win];
  windowToGray(ctSlice, win.c, win.w, img.data);
  const table = colorTable(meta.structures, new Set(st.sys), ui.hidden);
  compositeOverlay(img.data, labSlice, table, ui.opacity, ui.outline ? "outline" : "fill", w, h);
  if (ui.selected) highlight(img.data, labSlice, ui.selected);
  off.width = w; off.height = h;
  off.getContext("2d").putImageData(img, 0, 0);

  const [mc, mr] = pixelAspect(meta.spacing, st.plane);
  const fit = Math.min(cw / (w * mc), ch / (h * mr)) * 0.94;
  const s = fit * st.zoom;
  const dw = w * mc * s, dh = h * mr * s;
  const dx = (cw - dw) / 2 + ui.pan.x, dy = (ch - dh) / 2 + ui.pan.y;
  ui.geo = { dx, dy, sx: mc * s, sy: mr * s, w, h, ctSlice, labSlice };

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, dx, dy, dw, dh);

  drawLabels(labSlice, table, cw, ch);
  placePopup();
}

function highlight(rgba, lab, id) {
  for (let i = 0; i < lab.length; i++) if (lab[i] === id) { rgba[i * 4] = rgba[i * 4] * 0.5 + 127; rgba[i * 4 + 1] = rgba[i * 4 + 1] * 0.5 + 127; rgba[i * 4 + 2] = rgba[i * 4 + 2] * 0.5 + 127; }
}

function drawLabels(labSlice, table, cw, ch) {
  const svg = $("labels");
  svg.replaceChildren();
  const { dx, dy, sx, sy, w, h, ctSlice } = ui.geo;
  const body = bodyExtent(ctSlice, w, h, -500); // labels go in the dark space beside the body
  const marginL = dx + body.left * sx, marginR = cw - (dx + body.right * sx);
  const room = Math.min(marginL, marginR);
  const auto = ui.labels && room >= 110;
  $("hint").hidden = auto;
  if (!auto) return;
  const byId = new Map(data.meta.structures.map((s) => [s.id, s]));
  const raw = anchors(labSlice, w, h, visibleIds(table));
  // Merge children into their displayed parent when the child's own system is off.
  const screen = new Map();
  for (const [id, a] of raw) {
    if (a.area < 6) continue; // ponytail: hide specks; tap still names them
    const s = byId.get(id);
    const shownId = st.sys.includes(s.system) ? id : s.parent;
    if (!shownId || screen.has(shownId)) continue;
    screen.set(shownId, { x: dx + (a.x + 0.5) * sx, y: dy + (a.y + 0.5) * sy, area: a.area });
  }
  const placed = layoutLabels(screen, cw, ch, LINE_H);
  $("hint").hidden = !!placed;
  if (!placed) return;
  const maxChars = Math.max(8, Math.floor((room - 28) / 7));
  for (const l of placed) {
    const s = byId.get(l.id);
    const left = l.side === "left";
    const tx = left ? marginL - 14 : cw - marginR + 14;
    const name = structName(s, st.lang);
    const text = el("text", { x: left ? tx - 6 : tx + 6, y: l.y + 4, "text-anchor": left ? "end" : "start" });
    text.textContent = name.length > maxChars ? name.slice(0, maxChars - 1) + "…" : name;
    svg.append(
      el("line", { x1: tx, y1: l.y, x2: l.ax, y2: l.ay, stroke: s.color }),
      el("circle", { cx: tx, cy: l.y, r: 2.5, stroke: s.color, fill: s.color }),
      el("circle", { cx: l.ax, cy: l.ay, r: 5, stroke: s.color }),
      text,
    );
  }
}

function el(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

// ---------- pointer ----------
function pixelAt(clientX, clientY) {
  const g = ui.geo;
  if (!g) return null;
  const r = $("viewer").getBoundingClientRect();
  const c = Math.floor((clientX - r.left - g.dx) / g.sx), row = Math.floor((clientY - r.top - g.dy) / g.sy);
  if (c < 0 || row < 0 || c >= g.w || row >= g.h) return null;
  return { c, row, i: row * g.w + c, x: clientX - r.left, y: clientY - r.top };
}

function bindViewer() {
  const v = $("viewer");
  let drag = null;
  let wheelAcc = 0;
  v.addEventListener("wheel", (e) => {
    if (!data || !e.deltaY) return;
    e.preventDefault();
    // Mouse wheels send ~100 px per notch, trackpads many small deltas: one slice per ~40 px.
    wheelAcc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
    const n = Math.trunc(wheelAcc / 40);
    if (n) { wheelAcc -= n * 40; step(n); }
  }, { passive: false });
  v.addEventListener("pointerdown", (e) => {
    if (!data || e.target.closest(".popup")) return;
    v.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, pan: { ...ui.pan }, slice: st.slice, moved: false, panning: ui.move || e.button === 1 || e.shiftKey || (st.zoom > 1 && e.pointerType === "mouse") };
  });
  v.addEventListener("pointermove", (e) => {
    const p = pixelAt(e.clientX, e.clientY);
    $("hu-readout").textContent = p ? `HU ${ui.geo.ctSlice[p.i]}` : "HU —";
    if (!drag) return;
    const ddx = e.clientX - drag.x, ddy = e.clientY - drag.y;
    if (Math.hypot(ddx, ddy) > 5) drag.moved = true;
    if (!drag.moved) return;
    if (drag.panning) { ui.pan = { x: drag.pan.x + ddx, y: drag.pan.y + ddy }; update(); }
    else {
      const n = sliceCount(data.meta.dims, st.plane);
      const next = Math.min(n - 1, Math.max(0, drag.slice + Math.round(ddy / 4)));
      if (next !== st.slice) { st.slice = next; update(); }
    }
  });
  const end = (e) => {
    if (drag && !drag.moved) select(pixelAt(e.clientX, e.clientY));
    drag = null;
  };
  v.addEventListener("pointerup", end);
  v.addEventListener("pointercancel", () => (drag = null));
  v.addEventListener("keydown", (e) => {
    const k = { ArrowUp: 1, ArrowRight: 1, PageUp: 10, ArrowDown: -1, ArrowLeft: -1, PageDown: -10 }[e.key];
    if (k && data) { e.preventDefault(); step(k); }
    if (e.key === "+" || e.key === "=") setZoom(st.zoom * 1.25);
    if (e.key === "-") setZoom(st.zoom / 1.25);
    if (e.key === "Escape") { ui.selected = 0; toggleFocus(false); }
  });
}

let popupAt = null;
function select(p) {
  const id = p ? ui.geo.labSlice[p.i] : 0;
  const table = colorTable(data.meta.structures, new Set(st.sys), ui.hidden);
  ui.selected = id && table[id * 4 + 3] ? id : 0;
  popupAt = ui.selected ? { x: p.x, y: p.y } : null;
  update();
}

function placePopup() {
  const pop = $("popup");
  const s = ui.selected && data.meta.structures.find((x) => x.id === ui.selected);
  if (!s || !popupAt) { pop.hidden = true; return; }
  const shown = st.sys.includes(s.system) ? s : data.meta.structures.find((x) => x.id === s.parent) || s;
  pop.hidden = false;
  pop.style.setProperty("--c", shown.color);
  const strong = document.createElement("strong");
  strong.textContent = structName(shown, st.lang);
  const acts = Object.assign(document.createElement("div"), { className: "acts" });
  const close = Object.assign(document.createElement("button"), { className: "btn small", textContent: t("ctl.close") });
  close.onclick = () => { ui.selected = 0; popupAt = null; update(); };
  const rep = reportLink(shown);
  acts.append(close, ...(rep ? [rep] : []));
  pop.replaceChildren(strong, acts);
  const v = $("viewer");
  pop.style.left = `${Math.min(popupAt.x + 12, v.clientWidth - pop.offsetWidth - 8)}px`;
  pop.style.top = `${Math.min(popupAt.y + 12, v.clientHeight - pop.offsetHeight - 8)}px`;
}

boot();
