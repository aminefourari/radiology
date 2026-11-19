// ECG page DOM wiring. Geometry lives in ecgplot.js. The paper is one SVG in millimetre units.
import { measure, panels, paperMm, pathData, shownWaves, tracePoints, waveBands, ROW_MM } from "./ecgplot.js";
import { STEPS, diagnosisChoices, formatMeasure, isNormal, ltr, makeStore, nextRandom, score } from "./ecglearn.js";
import { applyDir, loadLanguages, loadStrings, localized, pickLang, t } from "./i18n.js";
import { REPO_URL, ecgReportUrl } from "./report.js";

const $ = (id) => document.getElementById(id);
const SVGNS = "http://www.w3.org/2000/svg";
const MIN_PPM = 3; // px per mm floor; narrower screens scroll sideways
const GROUPS = ["normal", "rhythm", "conduction", "hypertrophy", "ischaemia", "other"];

let langs = [], list = [], ecg = null;
const st = { ecg: null, lang: "en", speed: 25, gain: 10, layout: "3x4", quiz: false, waves: false, learn: false };
// Learn mode: { step 0..7 (7 = diagnosis), picks, dx: [ids], done }. Session data lives in localStorage when allowed.
let learn = null;
const store = makeStore(() => localStorage);
const ui = { calipers: false, ppm: MIN_PPM, drag: null, highlight: null }; // highlight: { leads, wave? } from a clue

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
  st.learn = h.get("learn") === "1";

  $("lang-select").replaceChildren(...langs.map((l) => new Option(l.name, l.code)));
  $("lang-select").onchange = (e) => setLang(e.target.value);
  $("ecg-select").onchange = (e) => openEcg(e.target.value);
  $("speed").onchange = (e) => { st.speed = +e.target.value; draw(); };
  $("gain").onchange = (e) => { st.gain = +e.target.value; draw(); };
  $("layout").onclick = (e) => { if (e.target.dataset.layout) { st.layout = e.target.dataset.layout; draw(); } };
  $("calipers").onclick = () => { ui.calipers = !ui.calipers; clearCalipers(); sync(); };
  $("waves").onclick = () => { st.waves = !st.waves; draw(); };
  $("learn-btn").onclick = () => (st.learn ? exitLearn() : startLearn());
  $("quiz").onchange = (e) => { st.quiz = e.target.checked; $("answer").open = false; ui.highlight = null; renderText(); draw(); };
  $("answer").ontoggle = () => renderReading();
  if (REPO_URL) { $("repo-link").hidden = false; $("repo-link").href = REPO_URL; }
  wireCalipers();
  new ResizeObserver(() => draw()).observe($("paper"));

  await setLang(st.lang);
  await openEcg(st.ecg);
  if (st.learn) beginLearn(); // reload keeps you in Learn on the same ECG
}

// ---------- Learn ----------
async function startLearn() {
  const { id, seen } = nextRandom(list.map((e) => String(e.id)), store.get("ecgLearnSeen", []), Math.random);
  store.set("ecgLearnSeen", seen);
  st.learn = true;
  learn = { done: false, picks: {}, step: 0, dx: [] }; // placeholder so nothing is revealed while loading
  await openEcg(id);
  beginLearn();
}

function beginLearn() {
  st.learn = true;
  learn = { step: 0, picks: {}, dx: diagnosisChoices(list.map((e) => ({ id: String(e.id), group: e.group })), st.ecg, Math.random), done: false, answered: false };
  ui.highlight = null;
  renderText();
  renderLearn();
  draw();
}

function exitLearn() {
  st.learn = false;
  learn = null;
  ui.highlight = null;
  renderText();
  renderLearn();
  draw();
}

// Age and sex: shown in Learn too, since the QTc limit depends on sex.
const patientFacts = () => [
  ecg.age != null && `${t("ecg.age")}: ${ecg.age}`,
  ecg.sex && `${t("ecg.sex")}: ${t(`ecg.sex.${ecg.sex}`)}`,
].filter(Boolean);

// Leads (and wave) that show the answer for a step.
function stepHighlight(key) {
  const ALL = ["I", "II", "III", "aVR", "aVL", "aVF", "V1", "V2", "V3", "V4", "V5", "V6"];
  if (key === "axis") return { leads: ["I", "II", "aVF"], wave: "QRS" };
  if (key === "qrs") return { leads: ALL, wave: "QRS" };
  if (key === "qt") return { leads: ALL, wave: "T" };
  if (key === "st") {
    const leads = [...new Set(ecg.clues.filter((c) => c.wave === "ST").flatMap((c) => c.leads))];
    return { leads: leads.length ? leads : ALL, wave: "ST" };
  }
  return { leads: ["II"], wave: key === "pr" ? "P" : undefined };
}

function renderLearn() {
  const box = $("learn");
  box.hidden = !st.learn;
  $("learn-btn").textContent = t(st.learn ? "learn.exit" : "learn.button");
  $("learn-btn").setAttribute("aria-pressed", st.learn);
  if (!st.learn || !learn) return box.replaceChildren();
  const seen = store.get("ecgLearnSeen", []);
  const sc = score(ecg.answers, learn.picks, st.ecg);
  const head = h("div", { class: "row-head" },
    h("h2", {}, t("learn.session", { n: Math.max(1, seen.indexOf(st.ecg) + 1 || seen.length), total: list.length })),
    learn.done ? "" : h("span", { class: "muted" }, t("learn.score", { correct: sc.correct, total: Object.keys(learn.picks).length })));
  if (learn.done) {
    const tally = store.get("ecgLearnTally", { done: 0, correct: 0, total: 0 });
    const next = h("button", { class: "btn" }, t("learn.nextEcg"));
    next.onclick = startLearn;
    const exit = h("button", { class: "btn" }, t("learn.exit"));
    exit.onclick = exitLearn;
    const pickedTitle = localized(list.find((e) => String(e.id) === learn.picks.dx).title, st.lang);
    const right = learn.picks.dx === st.ecg;
    return box.replaceChildren(head,
      h("p", { class: right ? "ok" : "bad" }, right ? `✓ ${t("learn.correct")}: ${pickedTitle}` : `✗ ${t("learn.wrong", { answer: localized(ecg.title, st.lang) })}`),
      h("p", { class: "big" }, t("learn.score", { correct: sc.correct, total: sc.total }), " · ", h("strong", {}, localized(ecg.title, st.lang))),
      h("p", { class: "muted" }, t("learn.tally", tally)),
      h("div", { class: "pair" }, next, exit));
  }
  const isDx = learn.step === STEPS.length;
  const step = STEPS[learn.step];
  const key = isDx ? "dx" : step.key;
  const correct = isDx ? st.ecg : ecg.answers[key];
  const label = (v) => (isDx ? localized(list.find((e) => String(e.id) === v).title, st.lang) : t(`choice.${key}.${v}`));
  const picked = learn.picks[key];
  const buttons = (isDx ? learn.dx : step.choices).map((v) => {
    const b = h("button", { class: "btn choice", "aria-pressed": picked === v }, label(v));
    if (picked) b.disabled = true;
    if (picked && v === correct) b.classList.add("right");
    if (picked === v && v !== correct) b.classList.add("wrong");
    b.onclick = () => answer(key, v);
    return b;
  });
  const kids = [head, h("p", { class: "muted" }, patientFacts().join(" · ")), h("p", { class: "q" }, `${learn.step + 1}/${STEPS.length + 1} · ${t(`learn.question.${key}`)}`), h("div", { class: "choices" }, ...buttons)];
  if (picked && !isDx) {
    kids.push(h("p", { class: picked === correct ? "ok" : "bad" }, picked === correct ? `✓ ${t("learn.correct")}` : `✗ ${t("learn.wrong", { answer: label(correct) })}`));
    if (step.measure) kids.push(h("p", { dir: "auto" }, t("learn.measured", { value: ltr(formatMeasure(ecg.measures[step.measure], step.unit)), range: ltr(step.range) })));
    if (ecg.notes[key]) kids.push(h("p", { class: "override" }, localized(ecg.notes[key], st.lang)));
    kids.push(h("p", { class: "muted" }, t(`note.${key}`)));
    const show = h("button", { class: "btn" }, t("learn.showOnTracing"));
    show.onclick = () => { ui.highlight = stepHighlight(key); draw(); };
    const next = h("button", { class: "btn" }, t("learn.next"));
    next.onclick = () => { learn.step++; ui.highlight = null; renderLearn(); draw(); };
    kids.push(h("div", { class: "pair" }, show, next));
  }
  box.replaceChildren(...kids);
}

function answer(key, v) {
  if (learn.picks[key]) return;
  learn.picks[key] = v;
  if (key === "dx") {
    learn.done = true;
    const sc = score(ecg.answers, learn.picks, st.ecg);
    const tally = store.get("ecgLearnTally", { done: 0, correct: 0, total: 0 });
    store.set("ecgLearnTally", { done: tally.done + 1, correct: tally.correct + sc.correct, total: tally.total + sc.total });
    renderText(); // reveals title, reading card and clues
  }
  renderLearn();
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
  renderLearn();
}

async function openEcg(id) {
  st.ecg = String(id);
  try {
    ecg = await (await fetch(`ecg/${id}.json`)).json();
  } catch (e) {
    return showError(e);
  }
  $("answer").open = false;
  ui.highlight = null;
  renderText();
  draw();
}

// Picker: grouped by topic normally; a flat numbered list in quiz mode (groups would give it away).
function buildPicker() {
  const sel = $("ecg-select");
  sel.hidden = st.learn;
  if (st.quiz || st.learn) {
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
  const hide = st.learn ? !learn?.done : st.quiz;
  $("ecg-title").textContent = hide ? "" : localized(ecg.title, st.lang);
  $("answer").hidden = st.learn && !learn?.done;
  $("quiz").closest("label").hidden = st.learn;
  const facts = [...patientFacts(), ecg.axis && `${t("ecg.axis")}: ${ecg.axis}`].filter(Boolean);
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
  $("credit-measures").textContent = t("ecg.measuresCredit", { source: ecg.measuresSource.name, license: ecg.measuresSource.license });
  $("credit-measures").href = ecg.measuresSource.url;
  renderReading();
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
  if (st.learn) q.set("learn", "1");
  history.replaceState(null, "", `#${q}`);
}

const h = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  n.append(...kids);
  return n;
};

const reportLink = (item) =>
  REPO_URL ? h("a", { class: "report", href: ecgReportUrl(REPO_URL, { ecgId: ecg.id, item, lang: st.lang, shareUrl: location.href }), target: "_blank", rel: "noopener" }, t("ecg.report")) : "";

// Study view: the reading card (same steps as Learn) and the clues. Hidden in quiz mode until the answer is opened.
function renderReading() {
  const box = $("reading");
  if (!ecg) return;
  box.hidden = st.learn ? !learn?.done : st.quiz && !$("answer").open;
  const rows = STEPS.map((s) => {
    const ans = ecg.answers[s.key];
    const value = s.measure ? formatMeasure(ecg.measures[s.measure], s.unit) : "";
    const ok = isNormal(s.key, ans);
    const note = ecg.notes[s.key] ? h("p", { class: "override" }, localized(ecg.notes[s.key], st.lang)) : "";
    return h("details", { class: "step" },
      h("summary", {},
        h("span", { class: "name" }, t(`step.${s.key}`)),
        h("span", { class: "val", dir: "ltr" }, value),
        h("span", { class: "range", dir: "ltr" }, s.range),
        h("span", { class: ok ? "ok" : "bad" }, `${ok ? "✓" : "✗"} ${t(`choice.${s.key}.${ans}`)}`)),
      note, h("p", {}, t(`note.${s.key}`)));
  });
  const clues = ecg.clues.length
    ? ecg.clues.map((c, i) => {
        const on = ui.highlight?.clue === i;
        const b = h("button", { class: "clue", "aria-pressed": on },
          h("span", {}, localized(c.text, st.lang)), h("span", { class: "chips", dir: "ltr" }, ...c.leads.map((l) => h("i", {}, l))));
        b.onclick = () => { ui.highlight = on ? null : { clue: i, leads: c.leads, wave: c.wave }; renderReading(); draw(); };
        return h("div", { class: "clue-row" }, b, reportLink(`clue ${i + 1}: ${c.text.en}`));
      })
    : [h("p", { class: "muted" }, t("read.noFindings"))];
  box.replaceChildren(
    h("div", { class: "row-head" }, h("h2", {}, t("read.title")), h("span", { class: "muted" }, t("read.machine"))),
    ...rows,
    h("h2", { class: "clues-title" }, t("read.clues")),
    ...clues,
    h("p", { class: "muted" }, t("read.community"), " ", reportLink("reading card")),
  );
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
  const hl = ui.highlight;
  for (const panel of panels(duration, st.layout)) {
    const dim = hl && !hl.leads.includes(panel.lead);
    const shown = shownWaves(ecg.waves, { all: st.waves, highlight: hl?.wave, dim });
    if (shown.length) {
      for (const b of waveBands(shown, ecg.fs, panel, st.speed)) {
        bands.append(el("rect", { class: `w-${b.k}`, x: b.x, y: b.y + 1, width: b.w, height: b.h - 2 }));
        if (b.w > 1) bands.append(el("text", { class: `w-${b.k}`, x: b.x + b.w / 2, y: b.y + b.h - 2 }, b.k));
      }
    }
    traces.append(el("path", { d: pathData(tracePoints(ecg.leads[panel.lead], ecg.fs, panel, scale)), class: dim ? "dim" : "" }));
    const x = panel.t0 * st.speed, top = panel.row * ROW_MM;
    labels.append(el("text", { x: x + 1, y: top + 4, class: dim ? "dim" : hl ? "hl" : "" }, panel.lead));
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
