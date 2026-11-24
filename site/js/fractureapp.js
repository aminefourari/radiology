// Fracture & operation atlas: pick a fracture and a type, see it on the 3D bones and in its classifying section,
// then the cited decision, approach (incision + structures at risk in 3D), fixation and aftercare.
// State lives in the hash: #f=<fracture>&type=<code>&ap=<approach>&lang=<code>.
import { applyDir, loadLanguages, loadStrings, localized, saveLang, startLang, t } from "./i18n.js";
import { sectionShapes, typeFragments } from "./fracturegeom.js";

let FRACTURES = []; // shapes.json order
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) k in e && k !== "list" ? (e[k] = v) : e.setAttribute(k, v);
  e.append(...kids.filter((k) => k != null && k !== ""));
  return e;
};

const svgEl = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);

const ui = { lang: "en", f: null, type: null, ap: null, view: null, mesh: new Map(), playing: 0 };
let content = {}, shapes = {}, atlas = null;

function readHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  return { f: h.get("f"), type: h.get("type"), ap: h.get("ap"), lang: h.get("lang") };
}
function writeHash() {
  const h = new URLSearchParams({ f: ui.f, type: ui.type ?? "", ap: ui.ap ?? "", lang: ui.lang });
  history.replaceState(null, "", "#" + h);
}

const fx = () => content[ui.f];
const shape = () => shapes[ui.f];
const refNo = (id) => fx().refs.findIndex((r) => r.id === id) + 1;

function refChips(ids) {
  if (!ids?.length) return null;
  return el("span", { className: "fx-cites" }, ...ids.filter((id) => refNo(id)).map((id) => {
    const n = refNo(id);
    return el("button", { className: "fx-cite", type: "button", title: fx().refs[n - 1].cite, onclick: () => showRef(n) }, String(n));
  }));
}
function showRef(n) {
  const li = $("fx-refs").children[n - 1];
  li.scrollIntoView({ behavior: "smooth", block: "center" });
  li.classList.remove("flash");
  void li.offsetWidth;
  li.classList.add("flash");
}

const MGMT = { op: "fx.op", nonop: "fx.nonop", either: "fx.either" };
const badge = (m) => el("span", { className: `fx-badge ${m}` }, t(MGMT[m] ?? "fx.either"));

// ---------- 3D + section ----------

const sectionDef = () => shape().types[ui.type]?.section ?? shape().section;

function drawSection() {
  const svg = $("fx-svg"), sec = sectionDef();
  svg.replaceChildren();
  $("fx-sec-title").textContent = sec?.label ?? t("fx.section");
  if (!sec || !ui.view) return;
  const t01 = Number($("fx-disp").value) / 100;
  const frags = typeFragments(shape(), ui.type);
  const items = [];
  const boneOf = (f) => f.bone ?? shape().bone;
  const fractured = new Set([shape().bone, ...frags.map(boneOf)]);
  for (const k of [...shape().context.filter((k) => !fractured.has(k)), ...fractured]) {
    if (!ui.mesh.has(k)) continue;
    const mine = frags.map((f, i) => ({ f, i })).filter(({ f }) => boneOf(f) === k);
    for (const s of sectionShapes(...ui.mesh.get(k), mine.map(({ f }) => f), sec, t01)) {
      const g = s.frag >= 0 ? mine[s.frag] : null;
      items.push({ poly: s.poly, ctx: !fractured.has(k), frag: g && g.f.color !== "bone" ? g.i : -1 });
    }
  }
  const outline = [...fractured].filter((k) => ui.mesh.has(k)).flatMap((k) => sectionShapes(...ui.mesh.get(k), [], sec).map((s) => s.poly));
  const all = items.flatMap((s) => s.poly);
  if (!all.length) return;
  const half = (sec.size ?? 80) / 2;
  svg.setAttribute("viewBox", `${-half} ${-half} ${2 * half} ${2 * half}`);
  const path = (poly) => "M" + poly.map(([u, v]) => `${u.toFixed(2)},${(-v).toFixed(2)}`).join("L") + "Z";
  // Intact bone without outline (its pieces are split along the cut planes), the anatomic outline dashed (the
  // reduction target), then the fragments where they have moved to.
  const g = svgEl("g");
  const add = (poly, cls, c) => {
    const p = g.appendChild(svgEl("path"));
    p.setAttribute("d", path(poly));
    p.setAttribute("class", cls);
    if (c) p.style.setProperty("--c", c);
  };
  for (const s of items) if (s.ctx) add(s.poly, "ctx");
  for (const s of items) if (!s.ctx && s.frag < 0) add(s.poly, "bone");
  for (const loop of outline) add(loop, "outline");
  for (const s of items) if (!s.ctx && s.frag >= 0) add(s.poly, "frag", ui.colors[s.frag % ui.colors.length]);
  svg.append(g);
  // Orientation marks: radiological, patient right on the viewer's left for coronal/axial sections.
  for (const [x, y, txt, anchor] of [[-half + 2, half - 3, sec.left ?? "", "start"], [half - 2, half - 3, sec.right ?? "", "end"]]) {
    const tx = svgEl("text");
    Object.entries({ x, y, "text-anchor": anchor, class: "mark", style: `font-size:${(half * 0.06).toFixed(2)}px` }).forEach(([k, v]) => tx.setAttribute(k, v));
    tx.textContent = txt;
    svg.append(tx);
  }
}

let anim = 0;
function animateDisplacement() {
  cancelAnimationFrame(anim);
  const input = $("fx-disp"), t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 700);
    input.value = String(Math.round(100 * (1 - (1 - k) ** 3)));
    applyDisplacement();
    if (k < 1) anim = requestAnimationFrame(step);
  };
  input.value = "0";
  anim = requestAnimationFrame(step);
}
function applyDisplacement() {
  ui.view?.setDisplacement(Number($("fx-disp").value) / 100);
  drawSection();
}

function legend() {
  const frags = shape().types[ui.type]?.fragments ?? [];
  $("fx-legend").replaceChildren(...frags.map((f, i) => f.name && el("span", { className: "fx-key" },
    el("i", { style: `background:${f.color === "bone" ? "#e2d5bb" : ui.colors[i % ui.colors.length]}` }), f.name)).filter(Boolean));
}

async function show3d() {
  if (!ui.view) return;
  const sh = shape();
  ui.view.setShape({ bone: sh.bone, context: sh.context, fade: sh.fade, fragments: typeFragments(sh, ui.type) });
  ui.view.setSection(sectionDef());
  const ap = fx().approaches.find((a) => a.id === ui.ap);
  await ui.view.setApproach(ap ? { incisions: sh.approaches?.[ap.id]?.incisions, risk: ap.atRisk.map((r) => r.key) } : null);
  legend();
  animateDisplacement();
}

// ---------- text ----------

function renderTypes() {
  const list = $("fx-types");
  list.replaceChildren(...fx().types.map((ty) => el("li", {},
    el("button", { type: "button", className: "fx-type", "aria-pressed": String(ty.code === ui.type), onclick: () => pickType(ty.code) },
      el("b", {}, ty.code), el("span", {}, localized(ty.title, ui.lang)), badge(ty.management)))));
  const ty = fx().types.find((x) => x.code === ui.type);
  const ap = ty?.approach && fx().approaches.find((a) => a.id === ty.approach);
  $("fx-type-detail").replaceChildren(...(ty ? [
    el("h3", {}, `${fx().classification.name} ${ty.code} — ${localized(ty.title, ui.lang)} `, badge(ty.management)),
    el("p", {}, ty.summary),
    el("p", { className: "fx-rec" }, el("b", {}, t("fx.recommendation") + ": "), ty.recommendation, " ", refChips(ty.refs)),
    ap ? el("p", {}, el("button", { type: "button", className: "btn small", onclick: () => pickApproach(ap.id) }, `${t("fx.suggested")}: ${ap.name}`)) : null,
  ] : []));
}

const list = (items) => el("ul", {}, ...items.map((x) => (typeof x === "string" ? el("li", {}, x) : el("li", {}, x.text, " ", refChips(x.refs)))));

function renderStatic() {
  const f = fx();
  $("fx-class").textContent = `${localized(f.title, ui.lang)} · ${f.classification.name}`;
  $("fx-workup").replaceChildren(...f.workup.map((w) => el("li", {}, w)));
  $("fx-decide").replaceChildren(...f.decide.map((d) => el("li", {}, d.text, " ", refChips(d.refs))));
  const a = f.after;
  $("fx-after").replaceChildren(
    ...[["fx.weightBearing", a.weightBearing], ["fx.rehab", a.rehab], ["fx.followUp", a.followUp]].filter(([, v]) => v)
      .map(([k, v]) => el("p", {}, el("b", {}, t(k) + ": "), v)),
    el("h4", {}, t("fx.complications")), list(a.complications ?? []),
    el("h4", {}, t("fx.pitfalls")), list(a.pitfalls ?? []),
    refChips(a.refs));
  $("fx-refs").replaceChildren(...f.refs.map((r) => el("li", {},
    el("span", { className: `fx-kind ${r.kind}` }, t(`fx.kind.${r.kind}`)), " ",
    r.url ? el("a", { href: r.url, target: "_blank", rel: "noopener" }, r.cite) : r.cite)));
  $("fx-reviewed").textContent = t("fx.reviewed", { date: f.reviewed });
  document.title = `${localized(f.title, ui.lang)} — ${t("fx.title")}`;
}

function renderApproach() {
  const f = fx();
  $("fx-aps").replaceChildren(...f.approaches.map((a) => el("button", {
    type: "button", className: "btn small", role: "radio", "aria-checked": String(a.id === ui.ap), onclick: () => pickApproach(a.id === ui.ap ? null : a.id),
  }, a.name)));
  const a = f.approaches.find((x) => x.id === ui.ap);
  if (!a) { $("fx-ap").replaceChildren(el("p", { className: "fx-hint" }, t("fx.pickApproach"))); return; }
  const name = (k) => atlas.structures.find((s) => s.key === k)?.en?.replace(/ \(right\)$/, "") ?? k;
  $("fx-ap").replaceChildren(
    el("p", {}, el("b", {}, t("fx.when") + ": "), a.when, " ", refChips(a.refs)),
    ...[["fx.position", a.position], ["fx.incision", a.incision], ["fx.interval", a.interval]].map(([k, v]) => el("p", {}, el("b", {}, t(k) + ": "), v)),
    el("h4", {}, t("fx.atRisk")),
    el("ul", { className: "fx-risk" }, ...a.atRisk.map((r) => el("li", {}, el("b", {}, name(r.key)), " — ", r.why))),
    el("h4", {}, t("fx.steps")), el("ol", {}, ...a.steps.map((s) => el("li", {}, s))),
    el("h4", {}, t("fx.implants")), list(a.implants),
    el("h4", {}, t("fx.checks")), list(a.checks));
}

// ---------- actions ----------

function pickType(code) {
  ui.type = code;
  writeHash();
  renderTypes();
  show3d();
}
function pickApproach(id) {
  ui.ap = id;
  writeHash();
  renderApproach();
  show3d();
}

async function pickFracture(id, type, ap) {
  ui.f = id;
  const f = fx();
  ui.type = f.types.some((x) => x.code === type) ? type : f.types[0].code;
  ui.ap = f.approaches.some((a) => a.id === ap) ? ap : null;
  writeHash();
  for (const b of $("fx-pick").children) b.setAttribute("aria-checked", String(b.dataset.v === id));
  renderStatic();
  renderTypes();
  renderApproach();
  if (ui.view) {
    const sh = shape(), bones = [sh.bone, ...sh.context, ...Object.values(sh.types).flatMap((ty) => ty.fragments.map((f) => f.bone).filter(Boolean))];
    for (const k of bones) if (!ui.mesh.has(k)) { const m = ui.view.worldMesh(k); ui.mesh.set(k, [m.pos, m.idx]); }
    ui.view.setCamera(shape().camera);
  }
  await show3d();
}

function togglePlay() {
  const btn = $("fx-play");
  if (ui.playing) { clearInterval(ui.playing); ui.playing = 0; btn.setAttribute("aria-pressed", "false"); return; }
  btn.setAttribute("aria-pressed", "true");
  const next = () => { const ts = fx().types, i = ts.findIndex((x) => x.code === ui.type); pickType(ts[(i + 1) % ts.length].code); };
  next();
  ui.playing = setInterval(next, 2600);
}

async function setLang(lang) {
  ui.lang = lang;
  await loadStrings(lang);
  applyDir(lang);
  $("lang-select").value = lang;
  document.querySelectorAll("[data-t]").forEach((e) => (e.textContent = t(e.dataset.t)));
  document.querySelectorAll("[data-t-aria]").forEach((e) => e.setAttribute("aria-label", t(e.dataset.tAria)));
  $("fx-pick").replaceChildren(...FRACTURES.map((id) => el("button", {
    type: "button", className: "btn small", role: "radio", "data-v": id, "aria-checked": String(id === ui.f), onclick: () => pickFracture(id),
  }, localized(content[id].title, lang))));
  if (ui.f) { renderStatic(); renderTypes(); renderApproach(); writeHash(); }
}

async function main() {
  const h = readHash();
  const get = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u); return r.json(); });
  const langs = await loadLanguages();
  let index;
  [shapes, index] = await Promise.all([get("fracture/shapes.json"), get("atlas/index.json")]);
  FRACTURES = Object.keys(shapes);
  content = await Promise.all(FRACTURES.map((id) => get(`fracture/${id}.json`)));
  atlas = index;
  content = Object.fromEntries(FRACTURES.map((id, i) => [id, content[i]]));
  const sel = $("lang-select");
  sel.replaceChildren(...langs.map((l) => new Option(`${l.flag} ${l.name}`, l.code)));
  sel.onchange = () => { saveLang(sel.value); setLang(sel.value); };
  await setLang(startLang(langs.map((l) => l.code), h.lang));

  $("fx-disp").oninput = applyDisplacement;
  $("fx-play").onclick = togglePlay;
  $("fx-reset").onclick = () => ui.view?.setCamera(shape().camera);

  const { createFractureView, FRAG_COLORS } = await import("./fractureview.js");
  ui.colors = FRAG_COLORS;
  document.querySelector("main.fx").hidden = false;
  $("status").hidden = true;
  ui.view = await createFractureView($("fx-view"), index);
  await pickFracture(FRACTURES.includes(h.f) ? h.f : FRACTURES[0], h.type, h.ap);
}

main().catch((e) => { $("status").textContent = t("fx.error") + " " + e.message; console.error(e); });
