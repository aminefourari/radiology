# How the ECG is made — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A page `site/heart.html` where a 3D Z-Anatomy heart depolarises and repolarises in sync with a simulated 12-lead ECG, a ladder diagram and a caption, for 17 rhythms plus what-if toggles.

**Architecture:** An offline pipeline exports the heart mesh (GLB for rendering) and a decimated conduction graph (plain JSON) with hand-placed landmarks. A pure, deterministic JS simulator spreads activation over the graph (Dijkstra with per-tissue velocities), sums the moving fronts into a heart vector, projects it onto the 12 lead axes and emits events. The page renders that one simulation result as heart colours (three.js), tracing (`ecgplot.js`), ladder and caption.

**Tech Stack:** Vanilla ES modules, Node built-in test runner, three.js 0.170.0 (CDN import map, only on `heart.html`), Python 3.12 + Blender for the export, gltfpack 1.3.0.

**Spec:** `docs/superpowers/specs/2026-11-20-heart-electrophysiology-design.md`

## Global Constraints

- No backend, no build step, no npm dependencies. three.js 0.170.0 via the `ct.html` import map, loaded only on `heart.html`.
- `site/js` modules other than `*app.js` and three.js view modules stay DOM-free and Node-tested.
- Languages: en, de, es, ar (rtl), fr, it, nl; translations CI (`tests/translations.test.js`) covers every new string and data text.
- Tracing, ladder and numbers stay LTR inside Arabic (`dir="ltr"` containers, `ltr()` from `ecglearn.js` for inline numbers).
- Heart mesh is Z-Anatomy, CC BY-SA 4.0 from BodyParts3D; `site/heart/LICENSE.txt` copies `site/atlas/LICENSE.txt`'s wording. Never ship Z-Anatomy's non-commercial parts.
- The teaching feature of each rhythm (R′ V1 for RBBB, broad R V6 for LBBB, delta wave, flutter polarity, VT width, septal q) must come from the vector model, never a template. A rhythm that can't pass is cut from launch and named in the PR.
- Simulation is deterministic: seeded rng (`rng` from `ecglearn.js`), no `Math.random` in `heartsim.js`.
- Units: graph positions in RAS mm (same frame as `site/atlas`), time in ms, leads in mV sampled at 500 Hz.
- Commits carry no AI attribution.

## Review Focus

1. Scrubbing past the end or backwards: time wraps into the strip; heart colours, cursor and caption agree at every t → `wrapTime` test, Task 4.
2. Changing rhythm while a what-if is on: what-ifs only exist on NSR; switching away clears them, switching back starts clean → `parseHash`/`applyWhatIf` tests, Tasks 6 and 8.
3. Unknown or stale hash (`#rhythm=foo&view=bar&t=-5`) → falls back to `nsr`, `outside`, t = 0 → `parseHash` test, Task 8.
4. No WebGL (old phone, blocked GPU): tracing, ladder, caption and why panel still work; heart area shows a message → manual check step, Task 9.
5. Reduced motion: page starts paused at t = 0 and never autoplays → manual check step, Task 9.

## File map

| File | Responsibility |
|---|---|
| `pipeline/heart_export.py` | Runs inside Blender: export heart objects to raw GLB + raw mesh JSON |
| `pipeline/heartlib.py` | Pure: build graph (edges, areas, septum bridges), snap/validate landmarks |
| `pipeline/heart_landmarks.json` | Hand-placed landmark points (RAS mm) |
| `pipeline/make_atlas.py` | Gains `heart` subcommand |
| `pipeline/test_heartlib.py` | pytest for heartlib |
| `site/heart/` | `heart.glb`, `heart-graph.json`, `rhythms.json`, `LICENSE.txt` |
| `site/js/heartsim.js` | DOM-free: graph, activation, rhythm engine, heart vector, leads, events, vertex state |
| `site/js/heartmeasure.js` | DOM-free: waveform measuring (peaks, QRS shape, slope, axis) |
| `site/js/ladder.js` | DOM-free: ladder line geometry from events |
| `site/js/heartstate.js` | DOM-free: hash parse/format, what-if application |
| `site/js/heartview.js` | three.js: two views, vertex colours, cuts, chest view |
| `site/js/heartapp.js` | Page wiring |
| `site/heart.html` | Page |
| `tests/heartsim.test.js`, `tests/heartmeasure.test.js`, `tests/ladder.test.js`, `tests/heartstate.test.js`, `tests/heartrhythms.test.js` | Node tests |

---

### Task 1: Export the heart and build the graph

**Files:**
- Create: `pipeline/heart_export.py`, `pipeline/heartlib.py`, `pipeline/heart_landmarks.json`, `pipeline/test_heartlib.py`, `site/heart/LICENSE.txt`
- Modify: `pipeline/make_atlas.py` (add `heart` to the command dispatch at line ~198)
- Output: `site/heart/heart.glb`, `site/heart/heart-graph.json`

**Interfaces:**
- Produces `site/heart/heart-graph.json`:
  ```json
  {"pos": [x,y,z,...], "chamber": [0..4,...], "area": [...], "edges": [[a,b,tissue],...],
   "landmarks": {"sa": v, "avnode": v, "slow": v, "fast": v, "his": [v...], "rbb": [v...], "lbb": [v...],
                 "laf": [v...], "lpf": [v...], "purkinje_rv": [v...], "purkinje_lv": [v...],
                 "tricuspid_ring": [v...], "cti": [v...], "accessory": [va, vv], "pvc": v,
                 "vt_scar": [v...], "junction": v},
   "electrodes": {"V1": [x,y,z], ..., "V6": [...], "RA": [...], "LA": [...], "LL": [...]},
   "centre": [x,y,z]}
  ```
  `chamber`: 0 RA, 1 LA, 2 RV, 3 LV, 4 conduction system. `tissue` codes: 0 atrium, 1 avnode, 2 his, 3 bundle/purkinje, 4 ventricle, 5 accessory. Conduction polylines (His, bundles, fascicles) are extra chamber-4 vertices joined by tissue-3 edges; their ends join Purkinje patch vertices.
- Python: `build_graph(verts: np.ndarray, tris: np.ndarray, chamber: np.ndarray) -> dict` (edges from triangles, tissue from chamber, area = ⅓ of adjacent triangle areas); `bridge_septum(graph, max_mm=6.0) -> int` adds tissue-4 edges between RV and LV vertices closer than `max_mm`, returns count; `snap_landmarks(graph, landmarks: dict, tol_mm=3.0) -> dict` (name → vertex ids; raises `ValueError` naming the landmark when the nearest vertex is farther than `tol_mm`).

- [ ] **Step 1: Write failing tests** in `pipeline/test_heartlib.py`: on two unit-square triangles, `build_graph` gives 5 unique edges and areas summing to the mesh area; `bridge_septum` on two parallel squares 4 mm apart (chambers 2 and 3) adds ≥ 1 edge and none at 8 mm; `snap_landmarks` returns the nearest id at 1 mm and raises `ValueError` containing `"sa"` at 5 mm.
- [ ] **Step 2: Run** `.venv/bin/pytest pipeline/test_heartlib.py -q` → FAIL (module missing).
- [ ] **Step 3: Implement `pipeline/heartlib.py`** with numpy only (KD-free brute force is fine at ≤ 8k vertices).
- [ ] **Step 4: Run** the tests → PASS.
- [ ] **Step 5: Write `pipeline/heart_export.py`** (Blender, modelled on `atlas_export.py`'s frame conversion): export objects for `right_atrium`, `left_atrium`, `right_ventricle`, `left_ventricle`, valve leaflets and papillary muscles into `<out>/heart_raw.glb` (decimate to 60k triangles total) and `<out>/heart_graph_raw.json` (`verts`, `tris`, `chamber`, decimated to 4–8k vertices). Record in a comment whether chambers are walls or blood-pool surfaces.
- [ ] **Step 6: Add `make_atlas.py heart`**: run Blender with `heart_export.py`, gltfpack `-cc -kn -vp 16` to `site/heart/heart.glb`, then `build_graph` → `bridge_septum` → add conduction polylines and electrodes from `heart_landmarks.json` → `snap_landmarks` → write `site/heart/heart-graph.json` (positions rounded to 0.1 mm).
- [ ] **Step 7: Place landmarks** in `pipeline/heart_landmarks.json` (RAS mm); electrodes at standard chest positions relative to the atlas skeleton (V1 4th right intercostal space parasternal, etc.). Run `make_atlas.py heart` until it completes with no `ValueError`.
- [ ] **Step 8: Run** `.venv/bin/pytest pipeline -q` → PASS. Check `site/heart/heart.glb` < 2 MB and `heart-graph.json` < 1.5 MB.
- [ ] **Step 9: Commit** `git add pipeline/heart_export.py pipeline/heartlib.py pipeline/heart_landmarks.json pipeline/test_heartlib.py pipeline/make_atlas.py site/heart && git commit -m "Heart mesh and conduction graph for the electrophysiology page"`

### Task 2: Activation and repolarisation

**Files:** Create `site/js/heartsim.js`, `tests/heartsim.test.js`

**Interfaces:**
- Produces:
  - `VELOCITY = [1.0, 0.05, 2.5, 3.0, 0.5, 1.0]` (mm/ms by tissue code).
  - `loadGraph(json) -> Graph` `{n, pos: Float32Array, area: Float32Array, chamber: Uint8Array, start: Int32Array, nbr: Int32Array, len: Float32Array, tissue: Uint8Array, landmarks, electrodes, centre}` (CSR adjacency).
  - `activate(g, sources: {v:number, t:number}[], {cut = new Set(), velocity = VELOCITY, allow = null} = {}) -> Float32Array` activation time per vertex, `Infinity` if unreached. `cut`: set of vertex ids that don't conduct. `allow`: optional `Uint8Array` mask of chambers the impulse may enter.
  - `repolarise(g, act: Float32Array, {apd = 260, slope = 0.6} = {}) -> Float32Array` repolarisation time = act + apd − slope·(act − min act), only where act finite.
- Test helper (in the test file): `gridGraph(nx, ny, mm, tissue)` returns a graph JSON on a flat grid.

- [ ] **Step 1: Failing tests:** on a 21×1 grid at 1 mm, tissue 4: activating from vertex 0 at t=0 gives vertex 20 ≈ 40 ms (±1); a cut vertex at 10 leaves 11–20 `Infinity`; two sources at 0 and 20 meet in the middle; `allow` excluding a chamber leaves it unreached; `repolarise` makes the last-activated vertex repolarise earlier relative to its activation than the first (APD shorter), and the last vertex's repol time is still later than its activation.
- [ ] **Step 2: Run** `node --test tests/heartsim.test.js` → FAIL.
- [ ] **Step 3: Implement** `loadGraph`, `activate` (binary-heap Dijkstra, edge cost = len / velocity[tissue]), `repolarise`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `"Heart simulator: activation and repolarisation"`

### Task 3: Heart vector, leads and waveform measuring

**Files:** Modify `site/js/heartsim.js`; create `site/js/heartmeasure.js`, `tests/heartmeasure.test.js`; extend `tests/heartsim.test.js`

**Interfaces:**
- Produces in `heartsim.js`:
  - `LEADS = ["I","II","III","aVR","aVL","aVF","V1","V2","V3","V4","V5","V6"]` (same order and names as atlas ECG JSON).
  - `leadAxes(g) -> {[lead]: [x,y,z]}`. Frontal leads at angle θ (I 0°, II 60°, III 120°, aVR −150°, aVL −30°, aVF 90°): axis = `[-cos θ, 0, -sin θ]` (RAS: patient left is −x, inferior is −z). Precordial: unit vector from `g.centre` to the electrode.
  - `heartVector(g, wavefronts: {act: Float32Array, repol: Float32Array, weight: number}[], t: number, {front = 12} = {}) -> [x,y,z]`: for each vertex with `act ∈ [t − front, t)`, add `weight · area · d̂`, where d̂ is the unit direction of local activation (from the vertex's earliest-activated neighbour towards it); for `repol ∈ [t − front, t)`, subtract the same using repol order. Atrial wavefronts get weight 0.15, ventricular 1.
  - `leadSignals(g, wavefronts, duration, {fs = 500, gain}) -> {[lead]: Float32Array}`, lowpass = 3-point moving average twice; `gain` scales so the NSR R in V5 ≈ 1.5 mV (set the default once Task 4 runs).
- Produces in `heartmeasure.js` (all take a `Float32Array` and sample indices):
  - `peaks(sig, i0, i1, min = 0.05) -> {i, v}[]` local extrema with |v| ≥ min, in order.
  - `qrsShape(sig, i0, i1) -> string`: letters from the peaks in order, upper case when |v| ≥ 0.5 × the largest |v| in the window: positive = r/R, a negative before the first positive = q/Q, a negative after a positive = s/S, a second positive = r′/R′; all negative = "QS". E.g. `"rS"`, `"qR"`, `"rsR′"`.
  - `netArea(sig, i0, i1) -> number` (mV·s).
  - `maxUpslope(sig, i0, i1) -> number` and `upstrokeMs(sig, i0, i1, fs) -> number` (time from onset to 80 % of the first positive peak).
  - `axisDeg(leads, i0, i1) -> number` = `atan2(netArea(aVF), netArea(I))` in degrees.

- [ ] **Step 1: Failing tests (heartmeasure):** a hand-built signal with +0.2, −1.0 extrema gives `qrsShape` `"rS"`; −0.1, +1.2 gives `"qR"`; +0.3, −0.4, +0.9 gives `"rsR′"`; all-negative gives `"QS"`; equal areas in I and aVF give `axisDeg` 45; a slow-rising ramp has a larger `upstrokeMs` than a steep one.
- [ ] **Step 2: Failing tests (heartsim):** `leadAxes` I = `[-1,0,0]`, aVF ≈ `[0,0,-1]`; on a 41×1 grid activated left→right in RAS −x direction (towards patient left), `heartVector` mid-activation has negative x and lead I signal is positive while aVR is negative; a front moving the opposite way flips signs.
- [ ] **Step 3: Run** `node --test tests/heartmeasure.test.js tests/heartsim.test.js` → FAIL.
- [ ] **Step 4: Implement** both.
- [ ] **Step 5: Run** → PASS. **Step 6: Commit** `"Heart vector, 12 leads and waveform measuring"`

### Task 4: Rhythm engine and the vector-model spike (gate)

Prove NSR, RBBB, LBBB, WPW and flutter on the real graph before anything else is built on top.

**Files:** Modify `site/js/heartsim.js`; create `tests/heartrhythms.test.js`, `site/heart/rhythms.json` (model params only for now; texts in Task 7)

**Interfaces:**
- Rhythm model (the `model` field of each `rhythms.json` entry):
  ```
  { duration: ms, sinus: {cycle} | null, avDelay: ms, wenckebach: {inc, every} | null,
    block: {level: "node"|"his", pattern: [1,1,1,0]} | null, cut: ["rbb"|"lbb"|"laf"],
    accessory: bool, reentry: {circuit: "flutter"|"avnrt"|"avrt"|"vt", cycle, conduct: n} | null,
    ectopic: [{site: "pvc", t}], escape: {site: "junction"|"ventricle", cycle} | null,
    af: {seed, wavelets, avRefractory} | null }
  ```
- `simulate(g, model) -> Sim` `{duration, fs: 500, wavefronts: {act, repol, weight, kind: "atrial"|"ventricular", beat}[], leads: {[lead]: Float32Array}, events: Event[]}`.
- `Event = {type, t0, t1, beat}`; `type` ∈ `"P","PR","AV","His","QRS","ST","T","blocked","reentry","pre"` (pre = pre-excitation/delta). Events sorted by `t0`.
- `wrapTime(sim, t) -> number` in `[0, duration)`, also for negative t.
- `vertexState(sim, t, out: Uint8Array) -> Uint8Array` per graph vertex: 0 rest, 1 front (act ∈ [t−12, t)), 2 depolarised, 3 repolarising (repol ∈ [t−40, t)); uses the latest wavefront that reached the vertex before t.
- `eventAt(sim, t) -> Event | null` (the innermost event covering t; used for captions).

Mechanisms (spec "Simulation model"): sinus impulses start at `sa` in atria only; after `avDelay` (plus Wenckebach increments) a ventricular wavefront starts at `his`, travels bundles to Purkinje patches, then ventricle; `cut` removes the bundle vertices; `accessory` starts an extra ventricular source at `accessory[1]` 20 ms after the atrial front reaches `accessory[0]`; re-entry is a source moving along its circuit polyline once per `cycle` (flutter: `tricuspid_ring` through `cti`, counter-clockwise seen from the ventricle so atrial septum activates caudo-cranially; every `conduct`-th turn passes the node).

- [ ] **Step 1: Failing tests** in `tests/heartrhythms.test.js` loading `site/heart/heart-graph.json` and `rhythms.json` models: the spec's Acceptance checks for **NSR, RBBB, LBBB, WPW, flutter**, plus determinism (two `simulate` calls give identical leads), `wrapTime(sim, -1) === sim.duration - 1`, `wrapTime(sim, sim.duration + 5) === 5`, and every QRS event window contains the lead II peak of that beat. Intervals come from events; morphology from `heartmeasure.js` on the leads within event windows.
- [ ] **Step 2: Run** `node --test tests/heartrhythms.test.js` → FAIL.
- [ ] **Step 3: Implement** `simulate`, `wrapTime`, `vertexState`, `eventAt` for those five rhythms.
- [ ] **Step 4: Tune** velocities, APD slope, Purkinje patches and landmark placement (back in Task 1's JSON, rerun `make_atlas.py heart`) until the five pass. Templates only for shape, per Global Constraints.
- [ ] **Step 5: Gate.** If a teaching feature still fails after tuning, stop and report to the owner which one and why, before Task 5. Otherwise run → PASS.
- [ ] **Step 6: Commit** `"Rhythm engine; NSR, bundle blocks, WPW and flutter pass the ECG criteria"`

### Task 5: The remaining rhythms

**Files:** Modify `site/js/heartsim.js`, `site/heart/rhythms.json`, `tests/heartrhythms.test.js`

**Interfaces:** Consumes Task 4. Adds models for `sbrad`, `stach`, `1avb`, `mob1`, `mob2`, `3avb`, `lafb`, `avnrt`, `avrt`, `afib`, `pvc`, `vt`, and the junctional-escape variant used by the "Block AV node" what-if (internal key `3avb_node`, not listed in the picker).

- [ ] **Step 1: Failing tests:** each remaining Acceptance check from the spec, with its exact thresholds (e.g. LAFB `axisDeg ≤ -45`, `qrsShape(aVL)` starts with `q`, II/III/aVF `"rS"`; AF RR coefficient of variation > 0.10; VT QRS ≥ 140 ms and rate ≥ 120; AVNRT atrial and ventricular starts within 40 ms; AVRT retrograde P 70–150 ms after QRS onset; `3avb_node` QRS < 120 ms at 40–60/min).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS (or the rhythm is cut per Global Constraints and removed from `rhythms.json`, with a note in the commit).
- [ ] **Step 5: Commit** `"Rhythm engine: AV blocks, fascicular block, re-entry, AF, PVC, VT"`

### Task 6: Ladder geometry and page state

**Files:** Create `site/js/ladder.js`, `site/js/heartstate.js`, `tests/ladder.test.js`, `tests/heartstate.test.js`

**Interfaces:**
- `ladderLines(events: Event[]) -> {row: "A"|"AV"|"V", t0, t1, y0, y1, blocked: boolean, retro: boolean}[]` with y in row units (A 0–1, AV 1–2, V 2–3). Atrial activation → A segment; AV conduction → slanted AV segment from `t0` at y 1 to `t1` at y 2; blocked → AV segment ending at y 1.5 with `blocked: true`; retrograde (AVRT/AVNRT up-limb) → `retro: true` running from y 2 to y 1.
- `parseHash(hash: string, rhythmKeys: string[]) -> {rhythm, view, speed, t, whatIf: {cutRbb, cutLbb, cutLaf, avDelay, blockNode, accessory, extraBeat}}`; defaults `nsr`, `outside`, 0.2, 0, all off / avDelay 160. Unknown rhythm → `nsr`; view ∉ `outside|4ch|sax|chest` → `outside`; speed ∉ `0.1|0.2|0.5|1` → 0.2; t < 0 or NaN → 0; what-if keys ignored unless rhythm is `nsr`.
- `formatHash(state) -> string` (omits defaults).
- `applyWhatIf(baseModel, whatIf) -> {model, becomes: string}`; `becomes` is the rhythm key the change produces (`rbbb`, `lbbb`, `lafb`, `1avb` when avDelay > 200, `3avb_node`, `wpw`, `pvc`), or `"nsr"` when nothing changed. Several on at once: `becomes` lists the first in that order (the why panel names only one).

- [ ] **Step 1: Failing tests:** Mobitz I events give AV segments with growing `t1 − t0` and one `blocked`; AVNRT gives `retro` segments; `parseHash("#rhythm=foo&view=bar&t=-5&speed=3")` gives defaults; `parseHash("#rhythm=rbbb&cutLbb=1")` has all what-ifs off; `formatHash(parseHash(x))` round-trips a non-default state; `applyWhatIf` with `cutRbb` gives `becomes: "rbbb"` and a model whose `cut` contains `"rbb"`; avDelay 250 gives `"1avb"`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `"Ladder diagram geometry and heart page state"`

### Task 7: Teaching text in 7 languages

**Files:** Modify `site/heart/rhythms.json`, `site/i18n/*.json`, `tests/translations.test.js`; extend `tests/heartrhythms.test.js`

**Interfaces:** Each `rhythms.json` entry gains `title`, `why` (3–6 points), `looks` (2–5 bullets) as `{lang: string | string[]}` for all 7 languages, and `atlasEcg` (PTB-XL id: the first example of that dx in `pipeline/ecgs.json`, or `null` for VT and `3avb_node`). UI strings under `heart.*` in `site/i18n/*.json`: page title, controls, view names, what-if labels, "This is now: {rhythm}", "See this tracing", "3D view needs WebGL", and one caption per event type `heart.cap.<type>` (with per-circuit variants `heart.cap.reentry.<circuit>`).

- [ ] **Step 1: Failing tests:** translations test adds `rhythms.json` titles, every `why`/`looks` item, same item count across languages; rhythms test asserts each non-null `atlasEcg` equals the first example id of its dx in `ecgs.json` and the file `site/ecg/<id>.json` exists.
- [ ] **Step 2: Run** `node --test tests/translations.test.js tests/heartrhythms.test.js` → FAIL.
- [ ] **Step 3: Write the content**: accurate, short, plain; mechanism points match what the model actually does for that rhythm.
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `"Heart page: rhythm explanations and captions in 7 languages"`

### Task 8: Three.js heart view

**Files:** Create `site/js/heartview.js`

**Interfaces:**
- `createHeartView(container: HTMLElement, {glbUrl, graph: Graph, fixed: boolean}) -> Promise<{setStates(states: Uint8Array): void, setView(name: "outside"|"4ch"|"sax"|"chest"): Promise<void>, setVectors(heart: [x,y,z], leadAxis: [x,y,z] | null): void, resize(): void, dispose(): void}>`.
- Maps render vertices to graph vertices by nearest graph vertex after load (no precomputed map). Colour per state from CSS tokens `--heart-rest`, `--heart-front`, `--heart-plateau`, `--heart-repol` read once. Conduction system drawn as tubes along the landmark polylines, lit when any of their vertices is in state 1 or 2. `4ch` and `sax` use `renderer.clippingPlanes` set from the graph's long axis (`centre` → apex = LV vertex farthest from `avnode`). `chest` lazily loads `site/atlas/skeleton.glb` (ribs and sternum only, 25 % opacity) and shows electrode spheres plus arrows for the heart vector and the selected lead axis.
- Reuse the import-map / `GLTFLoader` + `MeshoptDecoder` setup from `view3d.js` (copy the few lines; don't import `view3d.js`, it is CT-specific). No AO pass (two views per frame).

- [ ] **Step 1: Implement.** **Step 2: Manual check** after Task 9 (no Node test: three.js module).
- [ ] **Step 3: Commit** `"Heart page: 3D views"`

### Task 9: The page

**Files:** Create `site/heart.html`, `site/js/heartapp.js`; modify `site/style.css`, `site/ecg.html` (header link), `site/index.html` (tile linking `heart.html`, with `home.heart` string), `CLAUDE.md` (layout + `make_atlas.py heart` command), `README.md` (credit)

**Interfaces:** Consumes everything above. Uses `ecgplot.js` `panels`, `paperMm`, `tracePoints`, `pathData` for the 3×4 tracing and `waveBands`-style shading from the sim's events; `ladderLines` for an SVG ladder sharing the tracing's time axis; `parseHash`/`formatHash`; `applyWhatIf`; i18n via `i18n.js` like `ecgapp.js`.

- [ ] **Step 1: Build the page** per the spec layout: rhythm select, play/pause, replay, scrubber, speed, P/PR/QRS/ST/T/All buttons, tracing + ladder (`dir="ltr"`), 3×4 / 12×1 layout toggle (as in the ECG atlas settings), clicking a lead label selects it for the chest view's lead-axis arrow (default II), caption (`aria-live="polite"`, updated only when `eventAt` returns a different event), two heart views (only the selectable one under 700 px width), why panel with "See this tracing →" to `ecg.html#ecg=<atlasEcg>`, what-if row shown only on NSR. Animation loop: `t = wrapTime(sim, t + dt·speed)`; per frame `vertexState` → `setStates`, `heartVector` → `setVectors`, cursor position. Space toggles play; ←/→ step 10 ms. `prefers-reduced-motion: reduce` → start paused. WebGL failure (`createHeartView` rejects) → heart area shows `heart.nowebgl`, everything else works.
- [ ] **Step 2: Run** `npm test` and `.venv/bin/pytest pipeline -q` → PASS.
- [ ] **Step 3: Manual check** with `python3 -m http.server -d site 8000`, open `http://localhost:8000/heart.html`: (a) RBBB at 0.2×: LV lights before RV, cursor reaches V1's R′ as the RV front moves rightward; (b) scrub backward across the strip end: heart, cursor, caption agree; (c) NSR → cut right bundle → "This is now: right bundle branch block"; switch to AF → what-ifs gone; back to NSR → clean; (d) `#rhythm=foo&view=bar` loads NSR outside; (e) Arabic: layout RTL, tracing and ladder LTR; (f) 375 px width: one heart view, no horizontal scroll; (g) DevTools "Disable WebGL" (or `chrome://flags`): message shown, tracing still plays; (h) reduced-motion emulation: starts paused; (i) `ecg.html` network panel shows no three.js or heart files.
- [ ] **Step 4: Commit** `"How the ECG is made: interactive heart page"`
