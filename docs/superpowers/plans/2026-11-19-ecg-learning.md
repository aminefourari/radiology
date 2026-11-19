# ECG Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach how to find ECG pathologies: a reading card + clues under every tracing (Study),
and a scored step-by-step checklist on a random ECG (Learn).

**Architecture:** The pipeline adds GE 12SL measurements and derived step answers to each ECG
JSON; hand-written ST answers, clues and overrides live in `pipeline/ecgs.json`. A new DOM-free
`site/js/ecglearn.js` holds step definitions and quiz logic; `ecgapp.js` renders the card, clue
highlighting and the Learn panel.

**Tech Stack:** Python 3.12 + numpy (pipeline), vanilla ES modules + SVG (site), Node test runner, pytest.

**Spec:** `docs/superpowers/specs/2026-11-19-ecg-learning-design.md`

## Global Constraints

- No backend, no build step, no npm dependencies. `site/js` modules other than `*app.js` stay DOM-free.
- Languages en, de, es, ar (rtl), fr, it, nl; every new UI string and data text in all 7 (translations CI enforces it).
- Tracing and numbers stay LTR in Arabic.
- Thresholds (exact): rate < 60 slow, 60–100 normal, > 100 fast; axis normal −30…+90°, left < −30°, right > +90°; PR < 120 short, 120–200 normal, > 200 long, blank → none; QRS wide ≥ 120 ms; QTc (Bazett) long > 450 ms male / unknown, > 460 ms female.
- Rhythm default "no" when SCP codes include any of AFIB, AFLT, PSVT, SVTAC, 2AVB, 3AVB, PACE, BIGU, PVC, PAC; else "yes"; also "pr" = "none" when rhythm is "no".
- Measurements labelled "machine-measured (GE 12SL)"; clues labelled community-reviewed.
- Data credit: PTB-XL+ 12SL features, CC BY 4.0, https://doi.org/10.13026/g6h6-7g88.
- Commits carry no AI attribution. Work in the `ecg-learning` worktree, never in the main checkout (another session uses it).

## Review Focus

1. A measurement is missing (PR blank, axis/QTc null, sex unknown) → the card shows "—", derivation still returns a valid answer (Task 1, Task 3 tests).
2. `localStorage` throws or is empty (private window) → Learn still runs; tally just starts at 0 (Task 5 manual check).
3. Quiz mode on → reading card and clues hidden until "Show interpretation" opens; Learn never shows title, group or clue text before the end (Task 4/5 manual checks).
4. Diagnosis distractors when the ECG's group has no other member (Normal) → all three from other groups, never the correct id, no duplicates (Task 3 test).
5. Phone width 390 px and Arabic → no horizontal page scroll; card and Learn panel readable (Task 4/5 manual checks).

---

### Task 1: Pipeline — measurements and derived answers

**Files:**
- Modify: `pipeline/make_ecg.py`
- Test: `pipeline/test_make_ecg.py`

**Interfaces:**
- Produces (Python): `read_12sl(path: str, ids: set[int]) -> dict[int, dict]` returning measures `{"hr","pr","qrs","qt","qtc","axis","pFound"}` (float/int or `None`; `pFound` bool) from columns `HR__Global, PR_Int_Global, QRS_Dur_Global, QT_Int_Global, QT_IntBazett_Global, R_AxisFrontal_Global, P_Found_Global`.
- Produces: `derive_answers(m: dict, codes: set[str], sex: str|None, st: str, override: dict) -> tuple[dict, dict]` → `(answers, notes)`; answers keys `rate∈{slow,normal,fast}`, `rhythm∈{yes,no}`, `axis∈{normal,left,right}`, `pr∈{short,normal,long,none}`, `qrs∈{narrow,wide}`, `qt∈{normal,long}`, `st∈{normal,elevated,depressed}`; `override` is `{step: {"answer": str, "note": {lang: str}}}`, notes is `{step: {lang: str}}`.
- Produces (ECG JSON, consumed by Tasks 3–5): new fields `measures`, `measuresSource` (`{name:"PTB-XL+ 12SL features (GE Marquette 12SL)", license:"CC BY 4.0", url:"https://doi.org/10.13026/g6h6-7g88"}`), `answers`, `notes`, `clues` (copied from ecgs.json, default `[]`).

- [ ] **Step 1: Write failing tests** in `pipeline/test_make_ecg.py`:
  - `test_derive_thresholds`: hr 59→slow, 60→normal, 100→normal, 101→fast; axis −30→normal, −31→left, 90→normal, 91→right; pr 119→short, 200→normal, 201→long; qrs 119→narrow, 120→wide; qtc 451 male→long, 451 female→normal, 461 female→long, 451 sex None→long.
  - `test_derive_missing_values`: `pr=None` → `"none"`; `axis=None` → `"normal"`; `qtc=None` → `"normal"`.
  - `test_derive_rhythm_codes`: codes `{"AFIB"}` → rhythm `"no"` and pr `"none"` even if pr=180; `{"SR","NORM"}` → `"yes"`.
  - `test_override_wins_and_returns_note`: override `{"axis": {"answer": "left", "note": {"en": "x"}}}` → answers.axis `"left"`, notes `{"axis": {"en": "x"}}`; st passed through.
  - `test_read_12sl` with a 2-row temp CSV: picks requested ids, blanks → `None`, `P_Found_Global` "0" → `False`.
- [ ] **Step 2:** `.venv/bin/pytest pipeline/test_make_ecg.py -q` → new tests FAIL (names undefined).
- [ ] **Step 3:** Implement both functions; in `main()` fetch `features/12sl_features.csv` via `fetch(..., a.plus, PLUS)`, call `read_12sl` once for all ids, and write the new fields. Every entry in `ecgs.json` must have `st` (raise `ValueError` naming the id if missing — content lands in Task 2, so until then default `st` to `"normal"` only behind `--allow-missing-content`).
- [ ] **Step 4:** `.venv/bin/pytest pipeline -q` → all PASS.
- [ ] **Step 5:** Commit `Pipeline: add 12SL measurements and derived reading answers`.

### Task 2: Content audit — swaps, ST answers, clues, overrides

**Files:**
- Modify: `pipeline/ecgs.json`, `site/ecg/*.json` (regenerated), `tests/translations.test.js`

**Interfaces:**
- Consumes: Task 1 (`derive_answers`, `--allow-missing-content`).
- Produces (ecgs.json per entry): `st` (required), `clues: [{text:{7 langs}, leads:[lead names], wave?: "P"|"QRS"|"ST"|"T"}]`, optional `override` as in Task 1.

- [ ] **Step 1: Extend `tests/translations.test.js`** `dataNames()` to include each clue `text` (`ecg <id> clue <i>`) and each override `note` (`ecg <id> override <step>`). Add test `clue leads are valid lead names` (I, II, III, aVR, aVL, aVF, V1–V6). Run `npm test` → PASS (no clues yet).
- [ ] **Step 2: Audit.** Build with `--allow-missing-content`, print each ECG's derived answers next to its codes. For each contradiction with the pathology's teaching point (known: LAFB 157 axis −29°, RVH 2417 axis +53°; also check QT on wide-QRS records 1564, 5212, 2486 and any others), either swap the record (query `ptbxl_database.csv` + `12sl_features.csv` with the existing quality filters: `validated_by_human`, no noise/electrode flags; prefer `strat_fold` 10) or add an `override` with a 7-language note. QT on QRS ≥ 120 ms: override per spec note ("QTc is unreliable when QRS ≥ 120 ms; judge repolarisation, not QTc").
- [ ] **Step 3: Write content** for all 29 entries: `st`, 1–3 clues (Normal: no clues), all 7 languages. Look at each tracing (local server) to confirm the leads named actually show the finding.
- [ ] **Step 4:** `.venv/bin/python pipeline/make_ecg.py` (no flag) succeeds; `npm test` and `.venv/bin/pytest pipeline -q` PASS. Then remove `--allow-missing-content` from `make_ecg.py` and its use.
- [ ] **Step 5:** Commit `ECG content: ST answers, clues and overrides; swap non-textbook records` with each swap listed in the message body (old id → new id, reason).

### Task 3: Learn logic module

**Files:**
- Create: `site/js/ecglearn.js`, `tests/ecglearn.test.js`
- Modify: `site/js/ecgplot.js`, `tests/ecgplot.test.js`, `site/js/report.js`, `tests/report.test.js`

**Interfaces:**
- Produces (`ecglearn.js`):
  - `STEPS`: ordered array of `{ key, choices: string[], measure: string|null, unit: string, range: string }` for keys `rate, rhythm, axis, pr, qrs, qt, st` (choices exactly the answer values from Task 1; measure `hr, null, axis, pr, qrs, qtc, null`; range strings `"60–100"`, `""`, `"−30…+90"`, `"120–200"`, `"< 120"`, `"≤ 450/460"`, `""`).
  - `NORMAL`: `{rate:"normal", rhythm:"yes", axis:"normal", pr:"normal", qrs:"narrow", qt:"normal", st:"normal"}`.
  - `isNormal(key: string, answer: string) -> boolean`.
  - `formatMeasure(value: number|null, unit: string) -> string` (`null` → `"—"`, axis signed `"+6°"`).
  - `rng(seed: number) -> () => number` (mulberry32).
  - `nextRandom(ids: string[], seen: string[], rand) -> { id: string, seen: string[] }` (unseen only; when all seen, reset to `[]` then pick, never repeating the last id when ids.length > 1).
  - `diagnosisChoices(list: {id, group}[], id: string, rand) -> string[]` (4 ids, shuffled, contains `id` once; one distractor from same group when available).
  - `score(answers: object, picks: object, correctId: string) -> { correct: number, total: 8 }` (`picks.dx` holds the chosen id).
- Produces (`ecgplot.js`): `stSegments(waves) -> {k:"ST", on, off}[]` (each QRS offset to the next T onset after it).
- Produces (`report.js`): `ecgReportUrl(repo, { ecgId, item, lang, shareUrl }) -> string` (title `[ECG <ecgId>] <item>`, label `label-report`, body has `ecg:`, `item:`, `language:`, `view:` lines).

- [ ] **Step 1: Write failing tests:** `isNormal` for each NORMAL entry true and one abnormal false; `formatMeasure(null,"ms")==="—"`, `formatMeasure(6,"°")==="+6°"`, `formatMeasure(-29,"°")==="−29°"`; `nextRandom` over 3 ids from a seeded rng visits all 3 before any repeat and never returns the previous id right after reset; `diagnosisChoices` for a lone-group id has 4 unique ids including it and 3 from other groups, and for a multi-member group includes ≥ 1 same-group distractor; `score` counts 8 checks; `stSegments([{k:"QRS",on:10,off:20},{k:"T",on:40,off:60}])` → `[{k:"ST",on:20,off:40}]`; `ecgReportUrl` title and body lines.
- [ ] **Step 2:** `npm test` → new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `Add ECG learn logic, ST segments and ECG report links`.

### Task 4: Study view — reading card, clues, highlighting

**Files:**
- Modify: `site/ecg.html`, `site/js/ecgapp.js`, `site/style.css`, `site/i18n/*.json`

**Interfaces:**
- Consumes: Task 3 (`STEPS`, `isNormal`, `formatMeasure`, `stSegments`, `ecgReportUrl`), ECG JSON fields from Task 1/2.
- Produces: `draw()` honours `ui.highlight = { leads: string[], wave?: string } | null` — panels whose lead is not in `leads` get class `dim` (CSS opacity 0.25); when `wave` is set, that wave's bands (ST via `stSegments`) are drawn in highlighted panels even if Waves is off. Task 5 reuses this.
- UI string keys (all 7 languages): `read.title`, `read.machine`, `read.clues`, `read.noFindings`, `read.community`, `step.<key>` for the 7 steps + `step.dx`, `choice.<key>.<value>` for every choice, `note.<key>` (one teaching line per step), `ecg.report`, `ecg.measuresCredit` (`"Measurements: {source}, {license}"`).

- [ ] **Step 1:** Add a `<section id="reading">` after the tracing: a table of steps (name, measured value LTR, range, ✓/✗ + answer label, teaching note as `title`/expandable), then clue buttons (text + lead chips) and a "Report a problem" link per clue using `ecgReportUrl`. Hidden while quiz mode is on and the interpretation is closed.
- [ ] **Step 2:** Clue tap toggles `ui.highlight` and redraws; tapping the active clue clears it.
- [ ] **Step 3:** Add the strings to all 7 language files and the measures credit line in the footer.
- [ ] **Step 4: Verify.** `npm test` PASS (translations job included). Serve `site/` and check in a browser: card values for 3948 show PR 226 ms ✗ long; clue tap dims other leads and shades the named wave; quiz mode hides the card; 390 px Arabic has no horizontal page scroll, numbers LTR.
- [ ] **Step 5:** Commit `ECG study view: reading card and clue highlighting`.

### Task 5: Learn mode

**Files:**
- Modify: `site/ecg.html`, `site/js/ecgapp.js`, `site/style.css`, `site/i18n/*.json`

**Interfaces:**
- Consumes: Task 3 (`STEPS`, `nextRandom`, `diagnosisChoices`, `score`), Task 4 (`ui.highlight`, step/choice strings).
- UI string keys (all 7): `learn.button`, `learn.exit`, `learn.next`, `learn.nextEcg`, `learn.session` (`"ECG {n} of {total} this session"`), `learn.score` (`"Score {correct}/{total}"`), `learn.correct`, `learn.wrong`, `learn.measured` (`"Measured {value} ({range})"`), `learn.showOnTracing`, `learn.question.<key>` for 7 steps + `learn.question.dx`.

- [ ] **Step 1:** **Learn** button in the controls. Entering Learn: pick via `nextRandom` (seen list from `localStorage["ecgLearnSeen"]`, try/catch, fall back to in-memory), force title/picker hidden as in quiz mode, hide `#reading` and `#answer`, show `#learn` panel; hash gets `learn=1`.
- [ ] **Step 2:** One step at a time: question + choice buttons → on pick, disable choices, show correct/wrong, measured value + range (`formatMeasure`), any override note, teaching note, and "Show on tracing" (sets `ui.highlight` to the step's leads: rate/rhythm/pr → `["II"]`, axis → `["I","aVF"]`, qrs/qt → all leads with wave `QRS`/`T`, st → leads from the ECG's clues with wave `ST`). Step 8 uses `diagnosisChoices` with localized titles.
- [ ] **Step 3:** End screen: `score(...)`, diagnosis title, clue list (reuse Task 4 rendering), **Next ECG** and **Exit**. Session tally `{done, correct, total}` in `localStorage["ecgLearnTally"]` (try/catch).
- [ ] **Step 4: Verify.** `npm test` PASS. In a browser: three Next ECG presses give three different ECGs; no title, group or clue text visible before step 8 is answered; reload with `learn=1` stays in Learn; with `localStorage` blocked (`page.addInitScript` overriding it to throw) Learn still works; 390 px Arabic fits.
- [ ] **Step 5:** Commit `ECG learn mode: scored checklist on a random ECG`.

### Task 6: Docs, credits, PR

**Files:**
- Modify: `README.md`, `CONTRIBUTING.md`, `CLAUDE.md`, `site/img/ecg.jpg` (retake if the page look changed)

- [ ] **Step 1:** README: describe Study and Learn in the ECG paragraph; add the 12SL measurements to credits. CONTRIBUTING "Adding an ECG": `st`, `clues`, `override` fields and the audit rule. CLAUDE.md layout: `ecglearn.js`.
- [ ] **Step 2:** Full check: `npm test`, `.venv/bin/pytest pipeline -q` PASS.
- [ ] **Step 3:** Commit `Docs: ECG learning`, push `ecg-learning`, open a PR to `main`, wait for CI (viewer, translations, pipeline) to pass.
