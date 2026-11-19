# ECG Atlas — Learning to find the pathology

## Intent

The ECG atlas shows 29 real 12-lead ECGs and, on request, the answer ("complete left bundle
branch block"). Nothing teaches the part in between: what to look at, what to measure, and which
finding gives the diagnosis away. This feature adds that, for medical students and doctors who
want to *find* the pathology themselves instead of reading it.

It has two parts, chosen by the owner:

- **Study view (default).** Under the tracing: a **reading card** that walks the same systematic
  method for every ECG (rate → rhythm → axis → PR → QRS → QT → ST/T → conclusion), showing the
  measured value, the normal range and a normal/abnormal verdict for each step. Below it, the
  **clues** for this ECG's pathology: short findings, each tied to the leads where they show, and
  lit up on the tracing on tap.
- **Learn mode.** A **Learn** button starts a scored checklist on a **random ECG** each time. The
  diagnosis is hidden. The learner answers one multiple-choice question per step of the same
  method, gets feedback after each answer, picks the diagnosis last, and sees a score. "Next ECG"
  picks another random one.

**Success:** a student opens Learn, works through an unknown tracing step by step, and when they
get a step wrong the feedback shows them on the tracing why.

## Goals

- One reading method, identical in Study and Learn, so Learn practises what Study teaches.
- Every step answer that can be measured comes from the data, not from hand-written content.
- Clues point at the tracing (lead highlighting), not just text.
- Learn picks ECGs at random without repeats until all have been seen in the session.
- Everything in all 7 languages, enforced by the existing translations CI.

## Non-goals

- Accounts, saved progress across devices, leaderboards.
- Grading the learner's own caliper measurements or free-text answers.
- Automatic ST-segment interpretation (too error-prone; ST answers are hand-written per ECG).
- New ECG sources beyond PTB-XL / PTB-XL+.

## Anti-goals (a failure even if it works)

- **Teaching a wrong criterion or a contradictory answer.** If the machine measurement disagrees
  with the cardiologist's diagnosis (see "Data reality" below), the learner must never be marked
  wrong for reading the tracing correctly.
- Giving the answer away in Learn mode: no title, no group name, no clue text before the end.
- Presenting machine measurements as ground truth without saying they are machine-measured.

## Data reality (found during design)

PTB-XL+ ships GE 12SL measurements for every record (`features/12sl_features.csv`, CC BY 4.0):
`HR__Global`, `PR_Int_Global` (blank when no P waves), `QRS_Dur_Global`, `QT_Int_Global`,
`QT_IntBazett_Global`, `R_AxisFrontal_Global`, `P_Found_Global`. Spot checks match the diagnoses
(sinus brady 41 bpm, 1st-degree AV block PR 226 ms, LBBB QRS 148 ms, AF no P waves).

But some current picks are not textbook: **LAFB (157) axis −29°** (LAFB needs ≤ −45°) and **RVH
(2417) axis +53°** (no right axis deviation). So:

1. The builder audits all 29 ECGs: derive every step answer, and where the measured answers
   contradict the pathology's teaching point, **swap the record** for a clearer PTB-XL example of
   the same pathology (same quality filters as today: human-validated, no noise flags).
2. Where no clearer record exists, a per-ECG **override** in `pipeline/ecgs.json` replaces the
   derived answer, and the feedback says why (e.g. "machine-measured −29°, read by the cardiologist
   as left axis deviation").

## Approaches considered

- **A. Guided walkthrough with checking on every ECG.** Strongest active learning, but every ECG
  would be a quiz; the owner wanted browsing to stay a quick reference.
- **B. Reading card + clues, no checking.** Fast reference, but passive.
- **C. Findings checklist with a score.** Active, game-like.

**Chosen: B as the default view, C behind a Learn button on a random ECG** (the owner's pick).
B gives the reference; C gives practice on unseen tracings. Both share the same step definitions,
so building C on top of B is mostly a different presentation of the same data.

## The reading method (shared)

| # | Step | Learn question and choices | Answer source | Normal range shown |
|---|------|----------------------------|---------------|--------------------|
| 1 | Rate | Rate? `< 60` · `60–100` · `> 100` | `HR__Global` | 60–100 bpm |
| 2 | Rhythm | Is there a P wave before every QRS? `Yes` · `No` | derived from SCP codes (below), overridable | — |
| 3 | Axis | Axis? `Normal` · `Left` · `Right` | `R_AxisFrontal_Global`: normal −30…+90°, left < −30°, right > +90° | −30° to +90° |
| 4 | PR | PR interval? `Short` · `Normal` · `Long` · `No consistent PR` | `PR_Int_Global`: < 120, 120–200, > 200 ms; blank or rhythm "No" → no consistent PR | 120–200 ms |
| 5 | QRS | QRS? `Narrow` · `Wide` | `QRS_Dur_Global`: wide ≥ 120 ms | < 120 ms |
| 6 | QT | QTc? `Normal` · `Long` | `QT_IntBazett_Global`: long > 450 ms (male) / > 460 ms (female) | ≤ 450 / 460 ms |
| 7 | ST/T | ST segment? `Normal` · `Elevated` · `Depressed` | hand-written per ECG in `ecgs.json` | — |
| 8 | Diagnosis | Which diagnosis? 4 choices | the ECG's title; 3 distractors (below) | — |

QT with a wide QRS (bundle branch block, paced): Bazett QTc reads long because the QRS itself is
long. The builder overrides QT to the honest teaching answer for those ECGs with a note
("QTc is unreliable when QRS ≥ 120 ms; judge repolarisation, not QTc"). Unknown sex uses 450 ms.

Rhythm default: "No" when the SCP codes include any of AFIB, AFLT, PSVT, SVTAC, 2AVB, 3AVB, PACE,
BIGU, PVC, PAC; otherwise "Yes". (PVC/PAC/bigeminy: not every QRS has its own preceding P.)
Overridable per ECG like every other derived answer.

Distractors for step 8: one from the same group (if the group has another ECG), the rest from
other groups, never the correct title, shuffled.

Each step also carries a one-line teaching note (translated UI string), e.g. PR: "Long PR
(> 200 ms) with every P conducted = first-degree AV block."

## Study view (B)

```
[ tracing — leads not in the active clue dimmed ]
Reading                                   machine-measured (GE 12SL)
 1 Rate     83 bpm          60–100         ✓ normal
 3 Axis     +6°             −30…+90°       ✓ normal
 4 PR       120 ms          120–200        ✓ normal
 5 QRS      82 ms           < 120          ✓ normal
 …
Clues
 › ST elevation in V1–V4          [V1 V2 V3 V4]
 › Q waves in V1–V3               [V1 V2 V3]
```

- Tapping a clue highlights its leads: other leads drop to low opacity; if the clue names a wave
  (`P`, `QRS`, `ST`, `T`), that wave's band is shaded in the highlighted leads (reusing the
  existing wave bands; ST = from QRS offset to T onset). Tapping again clears it.
- In **quiz mode** the reading card and clues stay hidden until "Show interpretation" is opened
  (measured values like PR 226 ms would give the answer away).
- The existing interpretation panel (dataset statements) stays.

## Learn mode (C)

```
Learn · ECG 7 of 29 this session                    Score 4/5
[ tracing, title hidden ]
Step 5/8 · QRS width?     ( Narrow )  ( Wide )
✗ Wide — measured 148 ms (≥ 120 ms). [Show on tracing]
                                                   [Next step ›]
```

- **Learn** button in the controls row. It picks a random ECG not yet seen this session (resets
  when all 29 are done), hides the title and picker labels, collapses Study content, and shows the
  checklist one step at a time.
- After each answer: correct/incorrect, the measured value and threshold, the teaching note, and
  "Show on tracing" (highlights the relevant leads/wave as in Study).
- After step 8: score (x/8), the diagnosis, and its clues (as in Study), with **Next ECG** and
  **Exit**.
- Session tally (ECGs done, total score) kept in `localStorage`, wrapped in try/catch. It's a
  per-viewer convenience only.
- Calipers and Waves stay usable during Learn.
- The URL hash gains `learn=1` so reload keeps you in Learn; the ECG id in the hash is not
  meaningful to a learner, so no extra hiding needed.

## Data and pipeline

- `make_ecg.py` reads `data/ptbxl-plus/features/12sl_features.csv` (downloaded and cached like the
  other files) and writes into each `site/ecg/<id>.json`:
  - `measures`: `{hr, pr, qrs, qt, qtc, axis, pFound}` (numbers or `null`), and `measuresSource`.
  - `answers`: derived step answers after applying overrides from `ecgs.json`, e.g.
    `{rate: "normal", rhythm: "yes", axis: "left", pr: "normal", qrs: "wide", qt: "normal", st: "elevated"}`,
    with optional `notes` per overridden step (7 languages).
- `pipeline/ecgs.json` gains per ECG: `st` (required), `clues` (list of
  `{text: {7 langs}, leads: [...], wave: "P|QRS|ST|T"?}`), and optional `override`
  (`{step: {answer, note: {7 langs}}}`).
- Answer derivation is a pure Python function with a test per threshold boundary.

## Viewer code

- New DOM-free module `site/js/ecglearn.js`: step definitions, `verdict(step, measures, sex)`,
  `distractors(list, ecg, rng)`, `nextRandom(ids, seen, rng)`, `score(answers, picks)`. Tested in
  `tests/ecglearn.test.js` with a seeded rng.
- `ecgapp.js` gains the reading card, clue highlighting (a `highlight` state passed into `draw()`)
  and the Learn panel.
- New UI strings (step names, choices, teaching notes, Learn labels) in all 7 languages.
- `tests/translations.test.js` extends to clue texts and override notes.

## Content

- The builder writes the clue sets (typically 1–3 clues per ECG) and ST answers for all 29 ECGs,
  in 7 languages, from standard criteria and from what the specific tracing shows (checked by
  looking at it). Normal ECG gets "no abnormal findings" with no clues.
- Each ECG gets a **Report a problem** link (reusing `reportUrl` in `report.js`, with ECG id,
  step/clue and language) so wrong clues or answers come back as GitHub issues, like CT labels.
- The page says plainly that measurements are machine-made (GE 12SL) and that clues are
  community-reviewed teaching notes.

## Constraints

- Static site, no build, no npm deps; `site/js` modules other than the `*app.js` files stay
  DOM-free.
- 7 languages, RTL for Arabic (tracing and numbers stay LTR, as today).
- Translations CI must pass: every new string and data name in every language.
- Credit PTB-XL+ 12SL features in the footer and README.

## Left to the builder

- Exact wording of teaching notes and clues (accurate, short, plain).
- Which replacement records to use in the audit (document each swap in the PR).
- Visual details of the reading card and Learn panel, in the existing dark/mono style and
  working at phone width.
