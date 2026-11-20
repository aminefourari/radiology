# How the ECG is made — interactive cardiac electrophysiology

## Intent

The ECG atlas (`ecg.html`) shows real tracings and teaches how to *read* them. It does not show
*why* a tracing looks the way it does. This feature adds a page where a 3D heart depolarises and
repolarises in sync with a 12-lead tracing and a ladder diagram, so a learner can see the cause of
every deflection: why RBBB gives an RSR′ in V1, why AF has no P waves, why AVNRT is narrow and
regular, why VT is wide.

The audience is the atlas's audience: medical students and doctors. **The goal is to stop
memorising patterns and understand where they come from.** Reference look: the owner's screenshot
(tracing grid with a sweep cursor, an A / AV / V ladder under it, playback bar with speed and wave
buttons, a live caption, two 3D heart views, outside and cut, with the wavefront painted on the
muscle, and a numbered "why" panel on the right with "What it looks like on the ECG" and
"See this tracing").

**Success:** a student picks "Right bundle branch block", sets 0.2× speed, watches the left
ventricle activate first and the right ventricle late, sees the late rightward vector make the
R′ in V1, then flips the "cut right bundle" what-if off and on in the normal heart to watch it
appear and disappear.

## Approaches considered

- **A. Simulated beats.** A model drives both the heart animation and the tracing, so they are
  always in sync. It can show rhythms PTB-XL lacks (VT) and lets the learner change things.
  The traces are synthetic.
- **B. Animation over real tracings.** Hand-annotated timing on real atlas ECGs. Authentic, but
  only for rhythms we have, and nothing the learner can change.
- **C. Both (chosen by the owner).** A is the teaching tool. Each rhythm links to a real atlas
  ECG of the same diagnosis where one exists.

Within A, two ways to get the waveform:

- **Vector projection (chosen, builder's call stated to the owner).** Activation spreads over the
  heart mesh. The moving wavefront adds up to one heart vector. Each lead is that vector projected
  on the lead's axis. This is the model taught in class, so the "why" is true by construction.
- **Templates (limited fallback).** Hand-shaped P/QRS/T templates per lead, timed by the same
  model. Allowed only to smooth a wave's *shape* (e.g. P-wave roundness, ST level). **The feature a
  rhythm exists to explain** (R′ in V1 for RBBB, broad R in V6 for LBBB, the delta wave, the
  flutter sawtooth's polarity, VT width, the septal q) **must come from the vector model.** If it
  can't, that rhythm is cut from launch and listed as such in the PR, not faked. Any template use
  is documented in `heartsim.js`. (Builder-check decision.)
- **Build order follows from this:** an early spike proves the vector model on NSR, RBBB, LBBB,
  WPW and flutter on the real mesh before the page is built around it.

## Goals

- One page, `site/heart.html`, linked from `ecg.html` (header) and the landing page.
- A 3D anatomical heart with depolarisation and repolarisation painted on it, in sync with the
  12-lead tracing, the ladder diagram and a caption.
- 15 rhythms at launch (list below), each with a numbered "why", "What it looks like on the ECG",
  and a link to a real atlas ECG where one exists.
- What-if toggles on the normal heart that break one thing at a time.
- All text in the 7 site languages; translations CI covers it.

## Non-goals

- Ischaemia, infarction, ST changes, electrolyte or drug effects (later project).
- A realistic biophysical model (no ion channels or monodomain/bidomain equations).
- Learner-defined arbitrary rhythms, scoring or quizzes on this page (the ECG atlas has Learn).
- Arrhythmia mechanisms beyond what the 15 rhythms need.

## Anti-goals (a failure even if it works)

- **Teaching something false.** A rhythm whose simulated tracing breaks a textbook criterion
  (e.g. RBBB with QRS < 120 ms or no terminal R′ in V1) must not ship. The Acceptance checks
  below are tests, not wishes.
- Heart and tracing out of sync: they must be read from the same simulation at the same time.
- Making the ECG atlas pages heavier: three.js and the heart model load only on `heart.html`.
- Shipping Z-Anatomy's non-commercial parts (see CLAUDE.md).

## Constraints

- Static site, no build step, no npm deps. three.js 0.170.0 from the existing import map pattern
  (copy the `ct.html` import map into `heart.html`).
- `site/js` modules other than the `*app.js` files and three.js view modules stay DOM-free and are
  tested with Node's test runner.
- 7 languages, Arabic RTL; tracing, ladder and numbers stay LTR, display stays radiological where
  it applies (heart views: patient's left on viewer's right in the anterior view).
- Works at phone width (stacked layout, one heart view).
- Credit: heart mesh is Z-Anatomy (CC BY-SA 4.0) from BodyParts3D; same licence note as `site/atlas/`.

## The page

```
[Rhythm ▾]  ▶ ⟲  ───●──────── 4.05 s / 8 s   speed [0.2× ▾]   [P][PR][QRS][ST][T][All]
┌ tracing: 12 leads, 3×4 (12×1 on request), sweep cursor ───────────────┐  ┌ Why ─────────────┐
│ I    aVR   V1   V4                                                     │  │ 1. …             │
│ II   aVL   V2   V5                                                     │  │ 2. …             │
│ III  aVF   V3   V6                                                     │  │ What it looks    │
├ ladder: A ─ AV ─ V rows, slanted lines per impulse, ⊥ where blocked ──┤  │ like on the ECG  │
└────────────────────────────────────────────────────────────────────────┘  │ • …              │
 Caption (aria-live): "Flutter wave: the front is going round the tricuspid ring…"   │ See this tracing →│
┌ heart: outside (anterior) ┐ ┌ heart: [Outside|Four-chamber|Short-axis|Chest] ┐  └──────────────────┘
└───────────────────────────┘ └────────────────────────────────────────────────┘
 What-if (normal heart only): [Cut right bundle] [Cut left bundle] [Cut left anterior fascicle]
                              [AV delay ───●───] [Block AV node] [Accessory pathway] [Extra beat from LV]
```

- **Tracing.** Same paper look and code as the atlas (`ecgplot.js`: `panels`, `tracePoints`,
  `pathData`; one SVG in mm). The cursor sweeps at the playback time. Wave buttons highlight
  P / PR / QRS / ST / T bands, reusing `waveBands` with bands taken from the simulation's own
  events (it knows exactly when each wave starts and ends).
- **Ladder diagram.** Rows A, AV, V under the tracing, same time axis. Each impulse is a slanted
  line; blocked impulses end in a short bar; re-entry shows as a loop between rows (AVNRT: down
  the slow pathway, up the fast one; AVRT: down the node, up the accessory pathway).
- **Playback.** Play/pause, replay, scrubber, speed 0.1×, 0.2×, 0.5×, 1×. Scrubbing updates heart,
  cursor, ladder and caption. `prefers-reduced-motion`: start paused. Space toggles play, ←/→ steps 10 ms.
- **Caption.** One sentence for what is happening now, from the event the time falls in
  (e.g. "AV node delay: too little muscle to show on the ECG, so the line is flat — the PR
  segment"). `aria-live="polite"`, updated only when the event changes.
- **Heart views.** Left: fixed anterior outside view. Right: a selectable view. **Four-chamber**
  and **short-axis** are clipping-plane cuts. **Chest** shows the heart inside a translucent thorax
  (ribs and sternum from the atlas skeleton, loaded only when this view opens) with the 10
  electrode positions, the current heart-vector arrow and the axis of the selected lead. That view
  shows why V1 sees the right ventricle and V6 the lateral wall. Both views can be orbited.
  On phones only the selectable view shows.
- **Colour.** Resting muscle tissue colour; depolarising front bright yellow/white; depolarised
  (plateau) warm; repolarising fades back via blue. Conduction system (SA node, AV node, His,
  bundle branches, fascicles, accessory pathway when present) drawn as tubes on top, lit as the
  impulse passes. Colours are tokens with a light/dark theme like the rest of the site.
- **Why panel.** Per rhythm: 3–6 numbered points on the mechanism, 2–5 bullets for the ECG
  features, and "See this tracing →" to `ecg.html#ecg=<id>` (same hash keys `ecgapp.js` reads)
  when the atlas has that diagnosis.
- **URL hash** keeps rhythm, view, speed and time (`#rhythm=rbbb&view=4ch`), so links work.

## Rhythms at launch

| Key | Rhythm | Mechanism the model must show | Atlas link (`ecgs.json` dx) |
|-----|--------|-------------------------------|-----------------------------|
| `nsr` | Normal sinus rhythm | SA → atria → AV delay → His → bundles → ventricles, septum left→right first | `normal` |
| `sbrad` | Sinus bradycardia | as NSR, cycle 1.4 s | `sbrad` |
| `stach` | Sinus tachycardia | as NSR, cycle 0.5 s | `stach` |
| `1avb` | First-degree AV block | AV delay 300 ms, every P conducted | `1avb` |
| `mob1` | Mobitz I (Wenckebach) | AV delay grows each beat, then one P blocked (4:3) | `2avb` |
| `mob2` | Mobitz II | fixed PR, sudden block below the node (in His) | `2avb` |
| `3avb` | Complete heart block | atria at 75/min, ventricles from a ventricular escape at 35/min, no relation | `3avb` |
| `lafb` | Left anterior fascicular block | anterior fascicle cut; LV activated from the posterior fascicle upward and leftward | `lafb` |
| `rbbb` | Right bundle branch block | RBB cut; RV activated late from the LV through the septum | `rbbb` |
| `lbbb` | Left bundle branch block | LBB cut; septum right→left, LV activated late | `lbbb` |
| `wpw` | WPW (pre-excitation) | left lateral accessory pathway: early ventricular start = delta wave, short PR | `wpw` |
| `avnrt` | AVNRT (typical) | re-entry in the AV node: down slow, up fast; atria and ventricles at once; P hidden / pseudo-r′ in V1 | `psvt` |
| `avrt` | Orthodromic AVRT | down the node, up the accessory pathway; narrow QRS, retrograde P after QRS | `psvt` |
| `aflt` | Typical atrial flutter | counter-clockwise loop round the tricuspid ring through the cavotricuspid isthmus, 300/min, 2:1 conduction; negative sawtooth in II/III/aVF | `aflt` |
| `afib` | Atrial fibrillation | many wandering wavelets in the atria; AV node conducts irregularly | `afib` |
| `pvc` | Premature ventricular beat | one early beat from an LV focus, wide, compensatory pause | `pvc` |
| `vt` | Monomorphic VT | re-entry around an LV scar at 180/min; wide QRS; atria keep their own rate (AV dissociation) | none (no PTB-XL VT) |

(17 rows: NSR is the baseline the what-ifs act on; "15 rhythms" in the owner conversation counted
the pathologies; LAFB was added so the "cut left anterior fascicle" what-if has a destination.)

What-ifs apply to NSR only and do not change the rhythm key. Each names what the heart now has
so the why panel can say "This is now a right bundle branch block": cut RBB → `rbbb`, cut LBB →
`lbbb`, cut LAF → `lafb`, AV delay > 200 ms → `1avb` (slider 120–400 ms), accessory pathway →
`wpw`, extra beat → `pvc`. **Block AV node** gives complete heart block *at the node*, so the
escape is junctional: narrow QRS at ~45/min. The `3avb` rhythm entry keeps the block below the
His with a wide ventricular escape at 35/min, and its why panel contrasts the two levels.

## Simulation model

Pure, deterministic, DOM-free: `site/js/heartsim.js`. Same inputs give the same output, so tests
and scrubbing are exact.

**Heart model data** (`site/heart/heart.glb` + `site/heart/heart.json`):

- Produced by a new `pipeline/make_atlas.py heart` step that exports from Z-Anatomy the four
  chambers (`right_atrium`, `left_atrium`, `right_ventricle`, `left_ventricle`), the valve
  leaflets and the papillary muscles as one GLB, in the same RAS mm frame as the atlas, at
  higher detail than `vessels.glb` (budget around 60k triangles, meshopt-compressed with gltfpack
  like the atlas). The simulation graph is a decimated copy of the same meshes
  (about 4–8k vertices) with a map from render vertices to graph vertices.
- **Simulation graph lives outside the GLB**, so Node tests can read it with no decoder:
  `site/heart/heart-graph.json` (uncompressed: vertex positions, edges with tissue type, chamber
  ids, per-vertex area, landmark vertex ids). The browser maps render vertices to graph vertices
  by nearest vertex after loading (gltfpack reorders vertices, so no precomputed map).
- `heart.json` holds hand-placed landmarks in that frame, kept in
  `pipeline/heart_landmarks.json` and validated by the pipeline (each point within 3 mm of the
  mesh surface it belongs to): SA node, AV node (compact node, slow- and fast-pathway entries),
  His bundle, left and right bundle branches and fascicles as polylines, Purkinje entry
  patches on the endocardium, tricuspid ring polyline, cavotricuspid isthmus, accessory pathway
  site, PVC focus, VT scar region, and the chest electrode positions (V1–V6, RA, LA, LL) used for
  the lead axes.
- Whether the Z-Anatomy chamber meshes are wall surfaces or blood-pool shapes, and how the
  septum is represented, is the first thing the builder checks. If the septum isn't a shared
  surface, the builder adds graph edges across it (LV septal face ↔ RV septal face) so septal
  activation crosses it at muscle velocity.

**Activation.** Per impulse, multi-source Dijkstra over the graph from that impulse's entry
points and start times, with conduction velocity per tissue (atrium ~1 mm/ms, AV node ~0.05,
His/bundles/Purkinje ~2–3, ventricular muscle ~0.5, accessory pathway ~1; the builder tunes
within textbook ranges). Atria and ventricles are insulated except via AV node → His, or the
accessory pathway. Each vertex gets an activation time; repolarisation time = activation + APD,
with APD shorter where activation is later (and at the apex/epicardium), so repolarisation runs
roughly in reverse and the T wave is concordant in the normal heart.

**Rhythm engine.** A rhythm is data: a list of impulse sources (SA node at a cycle length, an
ectopic focus, an escape focus), conduction rules (AV delay per beat, Wenckebach increment,
block ratio, which bundles are cut, accessory pathway on/off), and re-entry circuits. Re-entry
(flutter round the tricuspid ring, AVNRT in the node, AVRT through the pathway, VT round the scar)
is a source that moves along a circuit polyline with a fixed cycle length and re-excites tissue
once it has recovered. AF is a seeded series of short-lived wavelets at random atrial points, plus
irregular AV-node conduction (concealed conduction approximated by a refractory period and a
seeded jitter). Simulate an 8 s strip per rhythm at 1 ms resolution, then loop.

**Leads.** Heart vector `H(t)` = sum over graph vertices currently in the depolarising front of
(area × unit activation direction), minus the same for the repolarising front, with lower weight
for the atria. Frontal leads use the hexaxial axes (I 0°, II 60°, III 120°, aVR −150°,
aVL −30°, aVF 90°); precordial leads use the unit vector from the heart centre to each electrode.
`lead(t) = H(t) · axis`, scaled to mV, smoothed (a short low-pass) and sampled at 500 Hz.

**Events.** The simulation also emits a time-ordered event list (P start/end, AV delay, His,
QRS start/end, ST, T start/end, blocked impulse, re-entry turn) used for the caption, wave bands
and ladder. Captions come from event types, so wording is per type, not per rhythm.

**Performance.** Precompute the whole strip on rhythm change (Dijkstra per impulse over ≤ 8k
vertices is milliseconds). Per frame, only update vertex colours (one attribute write) and the
cursor. Target: rhythm change < 300 ms, 60 fps on a mid-range laptop, 30 fps on a phone.

## Acceptance checks (tests)

**Intervals** (PR, QRS width, QT, rates, AV relation) come from the events: QRS width *is* the
ventricular activation span, so that is not circular. **Morphology** (sign of a deflection, q / r /
R′ / S, delta slurring, sawtooth polarity) is measured on the lead waveforms inside the event
windows by a small DOM-free measuring helper (`site/js/heartmeasure.js`: peaks, zero crossings,
upstroke slope within a window), tested on its own with hand-made signals. That way an RBBB with
no visible R′ in V1 fails. Thresholds are those the ECG atlas teaches:

- **NSR:** rate 60–100; P upright in I and II; PR 120–200 ms; QRS < 120 ms; QRS positive in I, II,
  aVF; negative in aVR; V1 rS (small r, deep S), V6 qR (small q), transition V3–V4; T upright in
  I, II, V5–V6; QTc 350–450 ms; axis −30…+90°.
- **RBBB:** QRS ≥ 120 ms; terminal R′ in V1 (rsR′); wide terminal S in I and V6.
- **LBBB:** QRS ≥ 120 ms; no septal q in I, V5, V6; broad R in V6; QS or rS in V1.
- **1AVB:** PR > 200 ms, every P conducted. **Mobitz I:** PR grows then a P is not followed by a
  QRS. **Mobitz II:** constant PR before a non-conducted P. **3AVB:** no fixed P–QRS relation,
  ventricular rate < atrial rate, wide escape QRS.
- **LAFB:** axis −45° or more negative; qR in aVL; rS in II, III, aVF; QRS < 120 ms.
- **Junctional escape (Block AV node what-if):** QRS < 120 ms, rate 40–60, P unrelated.
- **WPW:** PR < 120 ms; slurred QRS upstroke (delta); QRS ≥ 110 ms.
- **AVNRT:** regular narrow QRS at 150–250/min; atrial and ventricular activation start within
  40 ms of each other. **AVRT:** regular narrow QRS; retrograde P 70–150 ms after QRS onset.
- **Flutter:** atrial cycle 200 ms; negative atrial deflections in II, III, aVF; 2:1 conduction.
- **AF:** no repeating P wave; RR intervals irregular (coefficient of variation > 10%).
- **PVC:** QRS ≥ 120 ms, not preceded by a premature P, compensatory pause.
- **VT:** regular, ≥ 120/min, QRS ≥ 140 ms, atrial rate independent of ventricular rate.
- Determinism: two runs give identical samples. Event bands cover their deflections.

Morphology tests run on a small fixture mesh in Node where possible; the full checks run on the
real `heart.json` graph (shipped data), so CI catches a landmark change that breaks a rhythm.

## Files

- `site/heart.html`, `site/js/heartapp.js` (DOM, page wiring), `site/js/heartview.js` (three.js:
  views, colours, clipping, chest view), `site/js/heartsim.js` (DOM-free: graph, activation,
  rhythms, leads, events), `site/js/heartmeasure.js` (DOM-free: waveform measuring for tests and
  captions), `site/js/ladder.js` (DOM-free: ladder geometry), `site/heart/`
  (`heart.glb`, `heart-graph.json`, `heart.json`, `rhythms.json`, `LICENSE.txt`).
- `site/heart/rhythms.json`: per rhythm the model parameters, `atlasDx`, and the translated
  `title`, `why` (list) and `looks` (list), all 7 languages. Caption and UI strings go in
  `site/i18n/*.json` under `heart.*`.
- `tests/heartsim.test.js`, `tests/heartmeasure.test.js`, `tests/ladder.test.js`; `tests/translations.test.js` extends to
  `rhythms.json`.
- `pipeline/make_atlas.py heart` + `pipeline/heart_landmarks.json`; pipeline test for the
  landmark validation helper.
- "See this tracing" links to the first example of the rhythm's `atlasDx` in `pipeline/ecgs.json`
  (`#ecg=` takes a PTB-XL record id), resolved at build time into `rhythms.json` by a test-checked
  field, so a broken link fails CI.
- Links: header of `ecg.html`, landing page card, CLAUDE.md layout and commands, README credit.

## Left to the builder

- Exact velocities, APD gradient, vector weights and filter, within textbook ranges, tuned until
  the acceptance checks pass. Any lead/wave that needs the template fallback is documented in
  `heartsim.js`.
- Landmark placement (checked visually on the four-chamber cut).
- Wording of captions, why points and ECG bullets: accurate, short, plain.
- Visual details of the page in the site's existing style; one renderer with two scissor
  viewports or two renderers, whichever is simpler.
- Strip length per rhythm if 8 s doesn't show the pattern (Mobitz I needs a full cycle; AF needs
  enough beats to look irregular).
