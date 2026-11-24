// FAST ultrasound trainer page: the only DOM code for echo.html.
import { applyDir, loadLanguages, loadStrings, saveLang, startLang, structName, t } from "./i18n.js";
import { REPO_URL } from "./report.js";
import { decodeMaybeGzip, loadCase } from "./volume.js";
import { poseFrame, samplePlane } from "./usgeom.js";
import { bodyOutline, frontSilhouette, skinPoint } from "./usbody.js";
import { FAN, depthTicks, makeTissueLUT, renderFan, scanConvert, scanMap } from "./usrender.js";
import { closeness, fanContents, viewFound } from "./uswindows.js";
import { clampEchoState, formatEchoHash, parseEchoHash } from "./echostate.js";

const $ = (id) => document.getElementById(id);
const ORGANS = ["liver", "spleen", "kidney_right", "kidney_left", "urinary_bladder", "gallbladder"];
let st, langs, windows, vol, meta, outline, sil, lut, tissues, idByKey, byId;
let usMap = null, refMap = null, frontImg = null, dirty = true, anim = null, hashTimer = 0;
const polar = new Uint8Array(FAN.lines * FAN.samples), polarLabels = new Uint8Array(FAN.lines * FAN.samples);

const win = () => windows.find((w) => w.key === st.win);
const frame = () => poseFrame(skinPoint(outline, st.pose.zMm, st.pose.theta), st.pose);
const amounts = () => [0, ...st.fluid];
const changed = () => { dirty = true; clearTimeout(hashTimer); hashTimer = setTimeout(() => history.replaceState(null, "", formatEchoHash(st)), 250); };

async function start() {
  let w;
  [langs, w, tissues] = await Promise.all([loadLanguages(), fetch("echo/windows.json").then((r) => r.json()),
    fetch("echo/tissues.json").then((r) => r.json())]);
  windows = w.windows;
  const base = `cases/${w.case}`;
  const [c, fluidBuf] = await Promise.all([
    loadCase(base, (f) => ($("status").textContent = `${t("echo.loading")} ${Math.round(f * 100)}%`)),
    fetch(`${base}/fluid.bin.gz`).then((r) => r.arrayBuffer()).then(decodeMaybeGzip),
  ]);
  meta = c.meta;
  vol = { ct: c.ct, labels: c.labels, fluid: new Uint8Array(fluidBuf), dims: meta.dims, spacing: meta.spacing };
  ({ lut } = makeTissueLUT(tissues, meta.structures));
  idByKey = Object.fromEntries(meta.structures.map((s) => [s.key, s.id]));
  byId = Object.fromEntries(meta.structures.map((s) => [s.id, s]));
  outline = bodyOutline(vol.ct, vol.dims, vol.spacing);
  sil = frontSilhouette(outline);
  frontImg = organProjection();

  const codes = langs.map((l) => l.code);
  st = clampEchoState(parseEchoHash(location.hash), { windows, outline, langs: codes });
  st.lang = startLang(codes, st.lang);
  $("lang-select").replaceChildren(...langs.map((l) => new Option(`${l.flag} ${l.name}`, l.code)));
  $("lang-select").onchange = (e) => { saveLang(e.target.value); setLang(e.target.value); };
  if (REPO_URL) Object.assign($("repo-link"), { hidden: false, href: REPO_URL });
  bindControls();
  await setLang(st.lang);
  $("status").hidden = true;
  document.querySelector("main.echo").hidden = false;
  requestAnimationFrame(loop);
}

async function setLang(lang) {
  st.lang = lang;
  await loadStrings(lang);
  applyDir(lang);
  $("lang-select").value = lang;
  document.querySelectorAll("[data-t]").forEach((n) => (n.textContent = t(n.dataset.t)));
  document.querySelectorAll("[data-t-aria]").forEach((n) => n.setAttribute("aria-label", t(n.dataset.tAria)));
  document.title = t("echo.title");
  document.querySelectorAll(".fluid-grid select").forEach((s) => {
    s.replaceChildren(...["none", "small", "large"].map((k, i) => new Option(t(`echo.fluid.${k}`), i)));
  });
  syncControls();
  changed();
}

// ---- controls ----

function bindControls() {
  $("win").onclick = (e) => {
    const g = e.target.closest("[data-v]")?.dataset.v;
    if (!g) return;
    st.win = windows.find((w) => w.group === g).key;
    syncControls(); changed();
  };
  $("plane").onclick = (e) => { const k = e.target.closest("[data-v]")?.dataset.v; if (k) { st.win = k; syncControls(); changed(); } };
  for (const k of ["rock", "fan", "rot"]) $(k).oninput = (e) => { stopAnim(); st.pose[k] = +e.target.value; syncControls(); changed(); };
  $("depth").oninput = (e) => { st.depth = +e.target.value; syncControls(); changed(); };
  $("gain").oninput = (e) => { st.gain = +e.target.value; syncControls(); changed(); };
  $("labels").onchange = (e) => { st.labels = e.target.checked; changed(); };
  document.querySelectorAll("[data-step]").forEach((b) => (b.onclick = () => {
    const [k, d] = b.dataset.step.split(":");
    nudge({ [k]: +d });
  }));
  document.querySelectorAll(".fluid-grid select").forEach((s) => (s.onchange = () => {
    st.fluid[+s.dataset.site - 1] = +s.value; syncControls(); changed();
  }));
  $("all-pos").onclick = () => { st.fluid = st.fluid.map((v) => v || 1); syncControls(); changed(); };
  $("all-neg").onclick = () => { st.fluid = [0, 0, 0, 0]; syncControls(); changed(); };
  $("showme").onclick = showMe;
  dragOn($("front"), frontPick);
  dragOn($("ring"), ringPick);
  addEventListener("keydown", (e) => {
    if (e.target.closest?.("input, select, textarea")) return; // sliders and selects keep their own keys
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const d = { ArrowUp: { zMm: 5 }, ArrowDown: { zMm: -5 }, ArrowLeft: { theta: -3 }, ArrowRight: { theta: 3 },
      q: { rock: -5 }, e: { rock: 5 }, a: { fan: -5 }, d: { fan: 5 }, r: { rot: 90 } }[k];
    if (d) { e.preventDefault(); nudge(d); }
  });
  addEventListener("hashchange", () => {
    if (formatEchoHash(st) === location.hash) return;
    st = clampEchoState(parseEchoHash(location.hash), { windows, outline, langs: langs.map((l) => l.code) });
    setLang(st.lang || "en");
  });
}

function nudge(d) {
  stopAnim();
  for (const [k, v] of Object.entries(d)) st.pose[k] += v;
  st.pose = clampEchoState({ ...st, pose: st.pose }, { windows, outline, langs: [] }).pose;
  syncControls(); changed();
}

function dragOn(canvas, pick) {
  canvas.onpointerdown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    stopAnim();
    pick(e);
    canvas.onpointermove = (m) => pick(m);
  };
  canvas.onpointerup = canvas.onpointercancel = () => (canvas.onpointermove = null);
}

function canvasPoint(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * canvas.width, ((e.clientY - r.top) / r.height) * canvas.height];
}

function syncControls() {
  const w = win();
  document.querySelectorAll("#win [data-v]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === w.group)));
  $("plane").hidden = w.group !== "pelvic";
  document.querySelectorAll("#plane [data-v]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.v === w.key)));
  for (const k of ["rock", "fan", "rot"]) { $(k).value = Math.round(st.pose[k]); $(`${k}-v`).textContent = `${Math.round(st.pose[k])}°`; }
  $("depth").value = st.depth; $("depth-v").textContent = `${st.depth / 10} cm`;
  $("gain").value = st.gain; $("gain-v").textContent = `${st.gain > 0 ? "+" : ""}${st.gain} dB`;
  $("labels").checked = st.labels;
  document.querySelectorAll(".fluid-grid select").forEach((s) => (s.value = st.fluid[+s.dataset.site - 1]));
  $("sim-badge").hidden = !st.fluid.some((v) => v > 0);
  $("win-title").textContent = w.title[st.lang] || w.title.en;
  for (const k of ["where", "see", "mistakes"]) $(`t-${k}`).textContent = w[k];
  const us = $("us");
  $("depth-scale").innerHTML = depthTicks(st.depth, us.width, us.height).map(({ cm, frac }) => `<span style="top:${frac * 100}%">${cm}</span>`).join("");
}

// ---- probe animation ("Show me") ----

const shortest = (a, b) => ((((b - a) + 180) % 360) + 360) % 360 - 180;
function showMe() {
  const w = win(), from = { ...st.pose }, to = w.target, t0 = performance.now();
  st.depth = w.depth;
  anim = (now) => {
    const k = Math.min(1, (now - t0) / 600), s = k * k * (3 - 2 * k);
    st.pose = {
      zMm: from.zMm + (to.zMm - from.zMm) * s, theta: from.theta + shortest(from.theta, to.theta) * s,
      rock: from.rock + (to.rock - from.rock) * s, fan: from.fan + (to.fan - from.fan) * s,
      rot: (((from.rot + shortest(from.rot, to.rot) * s) % 360) + 360) % 360,
    };
    if (k >= 1) { st.pose = { ...to }; anim = null; }
    syncControls(); changed();
  };
}
const stopAnim = () => (anim = null);

// ---- drawing ----

function loop(now) {
  if (anim) anim(now);
  if (dirty) { dirty = false; draw(); }
  requestAnimationFrame(loop);
}

function draw() {
  const f = frame(), w = win();
  renderFan(vol, f, { depthMm: st.depth, gainDb: st.gain, amounts: amounts(), lut, tissues }, polar, st.labels ? polarLabels : null);
  const us = $("us"), ctx = us.getContext("2d");
  if (!usMap || usMap.depthMm !== st.depth) usMap = scanMap(st.depth, us.width, us.height);
  const img = ctx.createImageData(us.width, us.height);
  scanConvert(polar, usMap, img.data);
  ctx.putImageData(img, 0, 0);
  drawLabels();
  const contents = fanContents(vol, f, st.depth, amounts());
  const found = viewFound(contents, w, idByKey), near = closeness(st.pose, w.target);
  $("meter-bar").style.width = `${Math.round((found ? 1 : near) * 100)}%`;
  $("found").textContent = found ? t("echo.found") : t("echo.closeness", { pct: Math.round(near * 100) });
  $("found").classList.toggle("ok", found);
  $("marker-dir").textContent = t("echo.marker", { dir: t(`echo.dir.${dirWord(f.m)}`) });
  drawFront(f);
  drawRing(f);
  drawRef(f);
}

function dirWord([x, y, z]) {
  const a = [Math.abs(x), Math.abs(y), Math.abs(z)], i = a.indexOf(Math.max(...a));
  return [x > 0 ? "right" : "left", y > 0 ? "ant" : "post", z > 0 ? "head" : "feet"][i];
}

// Structure outlines and names in the fan, from the label volume (nearest sample per pixel).
function drawLabels() {
  const cv = $("us-labels"), ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!st.labels) return;
  const { W, H, line, sample, fl, fs } = usMap, S = FAN.samples, lab = polarLabels;
  const px = new Uint8Array(W * H), sum = new Map();
  for (let p = 0; p < W * H; p++) {
    if (line[p] < 0) continue;
    const v = lab[(line[p] + (fl[p] > 0.5 ? 1 : 0)) * S + sample[p] + (fs[p] > 0.5 ? 1 : 0)];
    px[p] = v;
    if (v) { const s = sum.get(v) || [0, 0, 0]; s[0]++; s[1] += p % W; s[2] += (p / W) | 0; sum.set(v, s); }
  }
  const out = ctx.createImageData(W, H), total = W * H;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x, v = px[p];
    if (!v || (px[p - 1] === v && px[p + 1] === v && px[p - W] === v && px[p + W] === v)) continue;
    const s = byId[v];
    if (!s || sum.get(v)[0] < total * 0.002) continue;
    const c = s.color.match(/\w\w/g).map((h) => parseInt(h, 16));
    out.data.set([c[0], c[1], c[2], 200], p * 4);
  }
  ctx.putImageData(out, 0, 0);
  ctx.font = "600 13px IBM Plex Sans, system-ui, sans-serif";
  ctx.textAlign = "center";
  for (const [v, [n, sx, sy]] of sum) {
    const s = byId[v];
    if (!s || n < total * 0.015) continue;
    const name = structName(s, st.lang);
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.75)"; ctx.strokeText(name, sx / n, sy / n);
    ctx.fillStyle = s.color; ctx.fillText(name, sx / n, sy / n);
  }
}

// Coronal projection of the main organs, for the front view (patient's right on the viewer's left).
function organProjection() {
  const [X, Y, Z] = vol.dims, ids = new Set(ORGANS.map((k) => idByKey[k]).filter(Boolean));
  meta.structures.filter((s) => s.key.startsWith("heart_")).forEach((s) => ids.add(s.id));
  const proj = new Uint8Array(X * Z);
  for (let z = 0; z < Z; z++) for (let y = 0; y < Y; y++) for (let x = 0; x < X; x++) {
    const v = vol.labels[z * X * Y + y * X + x];
    if (v && ids.has(v)) proj[z * X + x] = v;
  }
  return proj;
}

function frontGeom(cv) {
  const [X, , Z] = vol.dims, [sx, , sz] = vol.spacing;
  const s = Math.min(cv.width / (X * sx), cv.height / (Z * sz));
  const ox = (cv.width - X * sx * s) / 2, oy = (cv.height - Z * sz * s) / 2;
  // radiological: patient's right (+x) on the viewer's left
  return { s, toPx: (x, z) => [ox + (X * sx - x) * s, oy + (Z * sz - z) * s], toMm: (px, py) => [X * sx - (px - ox) / s, Z * sz - (py - oy) / s] };
}

let frontBg = null;
function drawFront(f) {
  const cv = $("front"), ctx = cv.getContext("2d"), g = frontGeom(cv);
  if (!frontBg) frontBg = frontBackground(cv, g);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.drawImage(frontBg, 0, 0);
  probeGlyph(ctx, g.toPx(f.p[0], f.p[2]), [-f.m[0], -f.m[2]], [-f.b[0], -f.b[2]]);
}

// Body silhouette and organ projection, drawn once.
function frontBackground(cv, g) {
  const bg = document.createElement("canvas");
  bg.width = cv.width; bg.height = cv.height;
  const ctx = bg.getContext("2d"), [X, , Z] = vol.dims, [sx, , sz] = vol.spacing;
  ctx.fillStyle = "#26313f";
  ctx.beginPath();
  for (let iz = 0; iz < Z; iz++) if (sil.left[iz]) ctx.lineTo(...g.toPx(sil.left[iz], iz * sz));
  for (let iz = Z - 1; iz >= 0; iz--) if (sil.right[iz]) ctx.lineTo(...g.toPx(sil.right[iz], iz * sz));
  ctx.fill();
  const step = 2;
  for (let z = 0; z < Z; z += step) for (let x = 0; x < X; x += step) {
    const v = frontImg[z * X + x];
    if (!v) continue;
    ctx.fillStyle = byId[v].color + "99";
    const [px, py] = g.toPx(x * sx, z * sz);
    ctx.fillRect(px - step * sx * g.s, py, step * sx * g.s + 0.5, step * sz * g.s + 0.5);
  }
  return bg;
}

function frontPick(e) {
  const cv = $("front"), [x, z] = frontGeom(cv).toMm(...canvasPoint(cv, e));
  const iz = Math.max(0, Math.min(vol.dims[2] - 1, Math.round(z / vol.spacing[2])));
  const cx = outline.cx[iz], half = Math.max(1, (sil.right[iz] - sil.left[iz]) / 2);
  st.pose.zMm = z;
  st.pose.theta = (-Math.asin(Math.max(-1, Math.min(1, (x - cx) / half))) * 180) / Math.PI;
  st.pose = clampEchoState(st, { windows, outline, langs: [] }).pose;
  syncControls(); changed();
}

function ringGeom(cv, iz) {
  const s = Math.min(cv.width, cv.height) / 2 / 220; // 220 mm from the centre fits most trunks
  const cx = outline.cx[iz], cy = outline.cy[iz];
  // radiological axial view: patient's right on the viewer's left, anterior at the top
  return { toPx: (x, y) => [cv.width / 2 - (x - cx) * s, cv.height / 2 - (y - cy) * s], cx, cy, s };
}

function drawRing(f) {
  const cv = $("ring"), ctx = cv.getContext("2d"), iz = Math.round(st.pose.zMm / outline.step), g = ringGeom(cv, iz);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = "#26313f"; ctx.strokeStyle = "#8a97a8";
  ctx.beginPath();
  for (let k = 0; k <= outline.nTheta; k++) {
    const p = skinPoint(outline, st.pose.zMm, -180 + (k * 360) / outline.nTheta).p;
    ctx.lineTo(...g.toPx(p[0], p[1]));
  }
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#8a97a8"; ctx.font = "11px IBM Plex Mono, monospace"; ctx.textAlign = "center";
  ctx.fillText("A", cv.width / 2, 11); ctx.fillText("R", 8, cv.height / 2); ctx.fillText("L", cv.width - 8, cv.height / 2);
  probeGlyph(ctx, g.toPx(f.p[0], f.p[1]), [-f.m[0], -f.m[1]], [-f.b[0], -f.b[1]]);
}

function ringPick(e) {
  const cv = $("ring"), [px, py] = canvasPoint(cv, e), iz = Math.round(st.pose.zMm / outline.step), g = ringGeom(cv, iz);
  const dx = -(px - cv.width / 2) / g.s, dy = -(py - cv.height / 2) / g.s; // back to world mm offsets
  st.pose.theta = (Math.atan2(-dx, dy) * 180) / Math.PI;
  syncControls(); changed();
}

// Probe as a short bar along the marker direction with a beam tick; m and b are screen-space directions
// (already flipped to the view's axes by the caller, y down).
function probeGlyph(ctx, [x, y], m, b) {
  const n = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
  const [mx, my] = n(m), [bx, by] = n(b);
  ctx.strokeStyle = "#f0b54a"; ctx.lineWidth = 4; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x - mx * 9, y - my * 9); ctx.lineTo(x + mx * 9, y + my * 9); ctx.stroke();
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + bx * 22, y + by * 22); ctx.stroke();
  ctx.fillStyle = "#f0b54a"; ctx.beginPath(); ctx.arc(x + mx * 12, y + my * 12, 3, 0, 7); ctx.fill(); // marker end
}

// CT through the beam's own plane, laid out like the ultrasound image, with the fan drawn on it.
function drawRef(f) {
  const cv = $("ref"), ctx = cv.getContext("2d");
  if (!refMap || refMap.depthMm !== st.depth) refMap = scanMap(st.depth, cv.width, cv.height);
  const { mmPerPx: s, topMm: top } = refMap, R = FAN.radiusMm;
  const apex = f.p.map((v, i) => v - R * f.b[i]);
  const u = f.m.map((v) => -v); // screen right = away from the marker
  const origin = apex.map((v, i) => v + (top + s / 2) * f.b[i] - ((cv.width / 2 - 0.5) * s) * u[i]);
  const vals = samplePlane(vol.ct, vol.dims, vol.spacing, origin, u, f.b, cv.width, cv.height, s, new Float32Array(cv.width * cv.height));
  const img = ctx.createImageData(cv.width, cv.height);
  for (let p = 0; p < vals.length; p++) {
    const g = Math.max(0, Math.min(255, ((vals[p] - 40 + 200) / 400) * 255));
    const inFan = refMap.line[p] >= 0;
    img.data.set(inFan ? [g, g, g, 255] : [g * 0.45, g * 0.45, g * 0.5, 255], p * 4);
  }
  ctx.putImageData(img, 0, 0);
}

start().catch((e) => { $("status").textContent = String(e); throw e; });
