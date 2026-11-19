// DOM wiring only. Logic worth testing lives in the DOM-free modules.
import { PLANES, WINDOWS, extractSlice, loadCase, pixelAspect, planeSize, sliceCount, windowToGray } from "./volume.js";
import { colorTable, compositeOverlay, visibleIds } from "./overlay.js";
import { anchors, bodyExtent, layoutLabels } from "./labels.js";
import { SYSTEMS, clampState, formatHash, parseHash } from "./state.js";
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
};
const SYSTEM_COLOR = { organs: "#c98bd6", segments: "#f2a65a", digestive: "#f4cf7a", urinary: "#e7d36a", pelvis: "#bfc8d6", spine: "#9ec5e8", arteries: "#e85a5a", veins: "#5b8def" };
const MARKS = { axial: ["A", "P", "R", "L"], coronal: ["S", "I", "R", "L"], sagittal: ["S", "I", "A", "P"] };
const LINE_H = 20;

let langs = [], cases = [], data = null;
let st = { case: null, lang: "en", plane: "axial", slice: 0, sys: ["organs"], zoom: 1 };
const ui = { hidden: new Set(), pan: { x: 0, y: 0 }, move: false, win: "soft", opacity: 0.45, labels: true, outline: false, selected: 0, geo: null };

// ---------- boot ----------
async function boot() {
  try {
    [langs, cases] = await Promise.all([loadLanguages(), fetch("cases/index.json").then((r) => r.json())]);
  } catch (e) {
    showError(e);
    return;
  }
  const codes = langs.map((l) => l.code);
  const fromHash = clampState(parseHash(location.hash), { cases: cases.map((c) => c.id), langs: codes, dims: null });
  st = { ...fromHash, lang: fromHash.lang || pickLang(codes, navigator.languages || [navigator.language]) };
  buildStatic();
  await setLang(st.lang);
  await openCase(st.case, fromHash.slice);
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
  buildSystems();
  buildPlanes();
  buildWindows();
  if (data) buildCaseUi();
  update();
}

async function openCase(id, slice) {
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
  st = clampState({ ...st, case: id, slice }, { cases: cases.map((c) => c.id), langs: langs.map((l) => l.code), dims: data.meta.dims });
  st.lang ||= "en";
  ui.hidden.clear();
  ui.selected = 0;
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
  $("lang-select").replaceChildren(...langs.map((l) => new Option(l.name, l.code)));
  $("lang-select").onchange = (e) => setLang(e.target.value);
  if (cases.length > 1) {
    $("case-select").hidden = false;
    $("case-select").onchange = (e) => openCase(e.target.value, null);
  }
  $("sys-all").onclick = () => { st.sys = [...SYSTEMS]; update(); };
  $("sys-none").onclick = () => { st.sys = []; update(); };
  $("zoom-in").onclick = () => setZoom(st.zoom * 1.25);
  $("zoom-out").onclick = () => setZoom(st.zoom / 1.25);
  $("zoom-fit").onclick = () => { ui.pan = { x: 0, y: 0 }; setZoom(1); };
  $("move").onclick = () => { ui.move = !ui.move; update(); };
  $("focus").onclick = () => toggleFocus(true);
  $("prev").onclick = () => step(-1);
  $("next").onclick = () => step(1);
  $("slider").oninput = (e) => { st.slice = Number(e.target.value); update(); };
  $("win-select").onchange = (e) => { ui.win = e.target.value; update(); };
  $("btn-structures").onclick = () => $("dlg-structures").showModal();
  $("btn-settings").onclick = () => $("dlg-settings").showModal();
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
  $("system-bar").replaceChildren(...SYSTEMS.map((k) => {
    const b = document.createElement("button");
    b.className = "sys";
    b.dataset.sys = k;
    b.style.setProperty("--c", SYSTEM_COLOR[k]);
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg><span></span>`;
    b.querySelector("span").textContent = t(`system.${k}`);
    b.onclick = () => { st.sys = st.sys.includes(k) ? st.sys.filter((s) => s !== k) : SYSTEMS.filter((s) => s === k || st.sys.includes(s)); update(); };
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
  $("win-select").replaceChildren(...Object.keys(WINDOWS).map((k) => new Option(t(`win.${k}`), k)));
  $("win-select").value = ui.win;
}

function buildCaseUi() {
  const { meta } = data;
  const entry = cases.find((c) => c.id === st.case);
  $("case-title").textContent = localized(entry?.title, st.lang);
  $("case-select").replaceChildren(...cases.map((c) => new Option(localized(c.title, st.lang) || c.id, c.id)));
  $("case-select").value = st.case;
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
  for (const sys of SYSTEMS) {
    const items = meta.structures.filter((s) => s.system === sys);
    if (!items.length) continue;
    const h = document.createElement("h3");
    h.textContent = t(`system.${sys}`);
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
  if (!st.sys.includes(s.system)) st.sys = SYSTEMS.filter((k) => k === s.system || st.sys.includes(k));
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
  if (st.zoom <= 1) ui.pan = { x: 0, y: 0 };
  update();
}

function toggleFocus(on) {
  document.body.classList.toggle("focus", on);
  $("focus").setAttribute("aria-pressed", String(on));
  let exit = document.querySelector(".exit-focus");
  if (on && !exit) {
    exit = Object.assign(document.createElement("button"), { className: "btn small exit-focus", textContent: t("ctl.exitFocus") });
    exit.onclick = () => toggleFocus(false);
    $("viewer").append(exit);
  } else if (!on && exit) exit.remove();
  update();
}

let hashTimer = 0;
function syncHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => history.replaceState(null, "", formatHash(st)), 150);
}

function onHashChange() {
  const next = clampState(parseHash(location.hash), { cases: cases.map((c) => c.id), langs: langs.map((l) => l.code), dims: data?.meta.dims ?? null });
  if (next.case !== st.case) return openCase(next.case, next.slice);
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
  $("zoom-val").textContent = `${Math.round(st.zoom * 100)}%`;
  $("move").setAttribute("aria-pressed", String(ui.move));
  $("viewer").classList.toggle("moving", ui.move);
  if (!data) return;
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
    if (!data || e.target.closest(".popup, .exit-focus")) return;
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
