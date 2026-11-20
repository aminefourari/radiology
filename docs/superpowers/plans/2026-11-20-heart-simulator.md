# Cardiac EP Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Z-Anatomy heart page with a schematic-first simulator: an idealised voxel heart, 78 rhythms, three
tracing modes, compare mode, vector diagrams, action-potential sites, and 3D and torso views.

**Architecture:**
- `heartshape.js` builds the heart in the browser (and in Node for tests) in the existing graph format.
- `heartsim.js` (the existing rhythm engine, extended) turns a rhythm model into leads and events.
- The page renders the slice schematic (`heartschematic.js`, canvas plus SVG), the tracing (`ecgplot.js`) and an
  optional three.js view (`heartview.js`), all driven by one clock.

**Tech Stack:** a static site with ES modules, no build step and no npm deps; three.js 0.170.0 by import map, only for 3D;
the Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-11-20-heart-simulator-design.md`

## Global Constraints

- No backend, no build step, no npm dependencies. three.js 0.170.0 is loaded with `import()` only when the 3D or torso mode opens.
- `site/js` modules other than `*app.js`, `view3d.js`, `heartview.js`, `heartschematic.js` and `heartpicker.js` stay DOM-free.
- Never fake: a rhythm's teaching feature comes from the vector model. A row that fails its criterion is removed and
  listed in the PR.
- Pacing spikes are the only drawn element and are marked as device artefacts in code.
- Languages: en, de, es, ar (rtl), fr, it, nl. Titles in all 7; texts in en, falling back to en.
- Display is radiological / textbook: patient right on the viewer's left.
- Commits carry no AI attribution.

## Review Focus

- **Rhythm switch mid-play:** the clock, cursor and compare pane must reset to valid times, with no `NaN` and no stale wavefronts.
  Test: `heartstate` `parseHash` clamps `t` into `[0, duration)` for the new rhythm.
- **Unknown or old hash keys** (`whatif=`, an unknown `rhythm=`) fall back to NSR without throwing. Test in `heartstate.test.js`.
- **Picker search with no match or diacritics** ("sinus" in de/fr titles): it shows "no match" and Enter does nothing.
  Test: `filterRhythms(list, "zzz")` returns `[]`, and `filterRhythms` ignores case and accents.
- **VF/AF without origin events:** the clock label is `null` (the label is hidden), never "NaN ms". Test: `clockLabel(sim, t)` in heartstate.
- **Small screens:** the schematic canvas resizes to its box without blurring, and the compare split works with a pointer drag.
  Checked manually in the browser at a 375 px width.

---

### Task 1: Idealised heart + engine on voxels (phase a gate)

**Files:**
- Create: `site/js/heartshape.js` (spike exists; finalise it), `tests/heartshape.test.js`
- Modify: `site/js/heartsim.js` (tissue `bachmann`, `links` with a tissue code, scaled front gradients, `VELOCITY[4] = 0.55`, `LEAD_GAIN`, APD), `tests/heartrhythms.test.js`, `tests/heartsim.test.js`, `site/heart/rhythms.json` (add `lafb`, `lpfb`)
- Delete:
  - `site/heart/heart.glb`, `site/heart/heart-graph.json`, `site/heart/LICENSE.txt`;
  - `pipeline/heart_export.py`, `pipeline/heart_landmarks.json`, `pipeline/heartlib.py`, `pipeline/test_heartlib.py`;
  - the `heart` command in `pipeline/make_atlas.py`.

**Interfaces:**
- Produces:
  - `SHAPE`, `VOXEL = 2`, `TORSO`;
  - `tissueAt(p, S) → {wall, cavity}`;
  - `axes(S) → {U, V, W}`, `toRas(ax, p)`, `toLocal(ax, r)`;
  - `buildHeart(S = SHAPE) → {json, grid: {lo, dims, step, index, local, ax}, bachmann}`;
  - `electrodes(centre) → {precordial, limbs}`.

  `json.landmarks` holds sa, avnode, his, apex, tricuspid_ring, cti, vt_scar, vt_exit, pvc, rvot, rv_apex, lv_lateral,
  fascicular, lra, hra, lateral_ra, la_focus, accessory, accessory_ps, site_ra, site_septum and site_lv.
- The graph loads with `loadGraph(json, { radius: 3.5 })`.

- [ ] **Step 1:** Write `tests/heartshape.test.js` with these tests:
  - "no atrial voxel has a ventricular neighbour within 3.5 mm";
  - "each chamber wall is one 26-connected component";
  - "every landmark is a wall voxel of the expected chamber" (sa/hra/lra/lateral_ra/avnode: 0; la_focus: 1; rvot: 2; his/apex/pvc/lv_lateral/fascicular: 3);
  - "build < 5 s" (log the real time).
- [ ] **Step 2:** Add LAFB/LPFB tests to `heartrhythms.test.js`:
  - LAFB: axis ≤ −45, aVL `/^q?R/`, II/III/aVF net negative, QRS < 120;
  - LPFB: axis ≥ 90, I net negative, III/aVF net positive, QRS < 120.

  Change the NSR axis assertion to −30..90 (clinical normal). Make the atlas-link test skip rows without `atlasDx`.
- [ ] **Step 3:** Tune the remaining old criteria (QTc, V3–V4 transition, R V5 ≈ 1.5 mV, P < 0.25 mV, RBBB width and terminal S, LBBB V5,
  VT width) through the `SHAPE`/`TORSO`/APD/gain values. Record each final value next to the constant with the reason.
  Expected: `node --test tests/heartrhythms.test.js tests/heartshape.test.js` all pass.
- [ ] **Step 4:** Delete the Z-Anatomy heart files and the make_atlas `heart` command. Run `npm test` and `.venv/bin/pytest pipeline -q`; both pass.
- [ ] **Step 5:** Commit "Idealised voxel heart replaces the Z-Anatomy heart; LAFB and LPFB".

### Task 2: Engine extensions for the new mechanisms

**Files:** Modify `site/js/heartsim.js`, `tests/heartsim.test.js`

**Interfaces (new optional model keys; each produces events the ladder, caption and clock can read):**
- **Sinus timing:**
  - `sinus.cycles: number[]` (PP sequence, repeating), or `sinus.modulate: {depth, period}` (sinus arrhythmia);
  - `sinus.exitBlock: 0|1 pattern` (SA exit block);
  - `sinus.arrest: [t0, t1]`.
- **Atrial foci:** `atrial: [{site, t}]` (PACs, focal and multifocal sites by landmark name);
  `focus: {site, cycle}` replaces the sinus.
- **Junctional:** `junctional: [{t}]` (PJC), and `escape.site: "junction"` now also sends the atria a retrograde P via `avnode`
  (delay `retroDelay`, default 40 ms).
- **Bundle slowing and per-beat refractoriness:**
  - `slow: {rbb: factor}`: velocity is divided on that line;
  - `cutBeats: [{beats: [k…] | "odd" | "even", cut: [...]}]`;
  - `rateCut: {rrBelow, cut}`: cut when the preceding RR is below it.
- **Pathways:**
  - `accessory: true | "ps"`;
  - `accessoryBeats: 0|1 pattern`;
  - `accessoryRefractory: ms` (pre-excited AF: conducts over the pathway when it has recovered).
- **Ventricular:**
  - `ectopic[].site` accepts any landmark;
  - `fusion: [{t, site}]` gives a ventricular source timed to meet the conducted beat;
  - `run: {site, t, n, cycle}` for NSVT;
  - `reentry.circuit: "vt"` takes `exit` (a landmark) for RVOT/fascicular VT;
  - `polymorphic: {sites: [...], cycle}` (torsades);
  - `vf: {seed}` (ventricular wavelets as AF).
- **Pacing:** `pacing: {mode: "aai"|"vvi"|"ddd"|"biv", rate, av, fail: 0|1 pattern}` adds `{type: "spike", chamber}` events. The leads get
  `SPIKE_MV = 1.2` for 2 ms at each spike (artefact, commented).
- **Repolarisation:** `apd: {apd, slope}` overrides the ventricular APD.
- **Leads:**
  - `leads: "lareversal"` applies the lead algebra after projection;
  - `electrodeShift: {V1: [0, 0, 20], V2: [0, 0, 20]}` moves electrodes (mm, RAS).

- [ ] **Step 1:** In `heartsim.test.js`, one failing test per key on a tiny inline model:
  - `cycles` → the PP sequence equals the input;
  - `exitBlock [1,0]` → every 2nd sinus P is missing;
  - `atrial` → a P at t with `origin: "atrial"`;
  - `slow` → a wider QRS than NSR but < cut;
  - `pacing` → `spike` events precede each QRS, and lead II jumps ≥ 1 mV at the spike;
  - `leads: "lareversal"` → I equals −I(NSR) and aVF is unchanged.
- [ ] **Step 2:** Implement until it passes (`node --test tests/heartsim.test.js`).
- [ ] **Step 3:** Commit "Rhythm engine: foci, SA block, slowing, per-beat cuts, pacing, VF, APD, lead changes".

### Task 3: Rhythm catalogue (phase d), category by category

**Files:** Modify `site/heart/rhythms.json` (fields `key`, `category`, `title{7 langs}`, `why.en`, `looks.en`, `takeaways.en`,
`atlasDx?`, `atlasEcg?`, `model`), `tests/heartrhythms.test.js`, `tests/translations.test.js`

- [ ] **Step 1:** For each spec category, add the rows and the spec's criterion test. Run them; tune `model` values only.
  Remove any row that cannot pass and note it in `docs/superpowers/specs/...` under a "Cut at build time" line.
- [ ] **Step 2:** `translations.test.js`:
  - every rhythm has a title in all 7 languages and en `why`/`looks`/`takeaways`;
  - categories `sinus, atrial, junctional, avblock, bundle, preexcitation, ventricular, paced, other` have i18n labels `heart.cat.<id>` in all languages.
- [ ] **Step 3:** Commit per category: "Rhythms: <category>".

### Task 4: Page shell: picker, tracing modes, playback, clock

**Files:**
- Create: `site/js/heartpicker.js` (DOM)
- Modify: `site/js/heartstate.js`, `site/js/heartapp.js`, `site/heart.html`, `site/style.css`, `site/i18n/*.json`, `tests/heartstate.test.js`

**Interfaces:**
- `heartstate.js`:
  - `parseHash(hash, keys) → {rhythm, compare, mode: "closeup"|"strip"|"12", ladder, heart: "slice"|"3d"|"torso", section: "4ch"|"sax", level, colour: "state"|"time", speed, t, leads: [3]}`;
  - `formatHash(state)`; `filterRhythms(list, query, lang)` (case- and accent-insensitive on the title and key);
  - `clockLabel(sim, t) → {ms, origin: "sinus"|"atrial"|"junction"|"ventricle"|"pacing"} | null`;
  - `closeupWindow(t, duration) → [t0, t1]` (1.2 s around t, clamped).
- `heartpicker.js`: `openPicker(dialog, rhythms, categories, lang, onPick)`.

- [ ] **Step 1:** Write the `heartstate.test.js` failing tests:
  - round-trip `formatHash` / `parseHash`;
  - `whatif=` ignored; an unknown rhythm → `nsr`; `t` clamped;
  - `filterRhythms` matches "lafb", "Fascicular" and "fasciculaire" (fr), and `"zzz"` → [];
  - `clockLabel` on NSR at 463 ms after a P's sinus impulse → `{ms: 463, origin: "sinus"}`; on VF → `null`;
  - `closeupWindow(100, 8000)` → `[0, 1200]`.
- [ ] **Step 2:** Implement `heartstate.js` until it passes.
- [ ] **Step 3:** Rewrite `heart.html` and `heartapp.js`:
  - the toolbar: picker button "Search N rhythms", compare toggle, mode tabs, ladder toggle;
  - the tracing:
    - Close-up at 100 mm/s with three lead selects (default I, V1, V6) and P/QRS/T letters at each wave peak;
    - Strip: lead II, 8 s, 25 mm/s;
    - 12-lead: 3×4;
  - the scale label, wave chips, ladder, playback (speeds 0.1/0.2/0.5/1, Space, ←/→ 10 ms, reduced motion starts paused),
    the clock "N ms after SA node fires", the caption, and the educational panel (why / looks / takeaways / atlas link).

  Reuse `ecgplot.js` (`panels`, `tracePoints`, `pathData`) and `ladder.js`.
- [ ] **Step 4:** Open `python3 -m http.server -d site 8000` and check `heart.html#rhythm=lafb&mode=closeup` in the browser:
  the picker search works, the modes switch, and there are no console errors.
- [ ] **Step 5:** Commit "Heart page: picker, tracing modes, clock".

### Task 5: Schematic slice view

**Files:**
- Create: `site/js/heartschematic.js` (DOM)
- Modify: `site/js/heartshape.js` (DOM-free helpers), `tests/heartshape.test.js`

**Interfaces:**
- `heartshape.js`:
  - `slicePlane(grid, {section: "4ch"|"sax", level, width, height, S}) → {node: Int32Array, alpha: Float32Array, edge: Float32Array, toScreen(p_local) → [x, y]}`.
    It is pixel-to-voxel lookup, with the nearest wall voxel within 1.5 voxels and analytic anti-aliasing from `tissueAt` subsamples.
  - `schematicLayout(json, grid, S, plane) → {labels: [{text, x, y}], lines: {name: [[x, y]…]}, sites: [{n, x, y, v}]}`.
    The lines are the conduction lines projected onto the plane (4ch) or their crossing points (sax).
- `heartschematic.js`: `createSchematic(container, {json, grid, g}) → {setTime(sim, t), setOptions({section, level, colour, conduction, vector}), resize(), dispose()}`.

- [ ] **Step 1:** Write the failing tests:
  - "slicePlane maps only to wall voxels and covers all four chambers in 4ch";
  - "sax at mid level shows LV and RV but no atria";
  - "schematicLayout places SA node inside the RA outline".
- [ ] **Step 2:** Implement the helpers and the renderer:
  - canvas fill from `vertexState` (state colours) or activation time (a colour scale with a ms legend);
  - SVG overlay with chamber labels, conduction lines lit by line-node activation, ✕ on cut lines and an accessory pathway;
  - a wavefront arrow (the mean front direction of the voxels in state 1, projected);
  - numbered sites ①②③.
- [ ] **Step 3:** Browser check: NSR, RBBB (✕ on the right bundle), LAFB, and an AF schematic animating. Commit "Schematic slice view".

### Task 6: Vector diagrams, action-potential plots, compare

**Files:**
- Create: `site/js/heartplots.js` (DOM-free path builders)
- Modify: `heartapp.js`, `heart.html`, `style.css`
- Test: `tests/heartplots.test.js`

**Interfaces:** `heartplots.js`:
- `apCurve(act, repol, t0, t1, kind: "atrial"|"ventricular") → [[t, mV]]`: phase 0 to +20, plateau, phase 3 to −90; −90 at rest.
- `vectorLoop(sim, t, plane: "frontal"|"horizontal", beatStart) → {loop: [[x, y]], now: [x, y]}`: frontal is (−x, −z), horizontal is (−x, y).
- `hexaxial()` and `precordialAxes(g)` give the axis lines.

- [ ] **Step 1:** Write the failing tests:
  - `apCurve` is −90 before act, > 0 within 5 ms after act, and −90 again after repol;
  - the NSR frontal loop's mean angle is within 15° of `axisDeg`.
- [ ] **Step 2:** Implement, and render:
  - three AP panels with cursors;
  - the frontal and horizontal diagrams;
  - compare mode (second picker, stacked tracings with a label per side, schematic A/B with a draggable split using
    `clip-path`, two clock labels).
- [ ] **Step 3:** Browser check: compare `rbbb` vs `nsr` with the split dragged. Commit "Vector diagrams, AP sites, compare".

### Task 7: 3D and torso views

**Files:**
- Rewrite: `site/js/heartview.js`
- Modify: `site/js/heartshape.js` (`surface(grid, S) → {positions, indices, vertexNode}` by surface nets on the tissue field)
- Test: `tests/heartshape.test.js`

**Interfaces:** `createHeartView(container, {json, grid, mode: "3d"|"torso"}) → {setStates(Uint8Array | times), setSection({section, level}), setVector([x, y, z] | null), setConduction(bool), resize(), dispose()}`.

- [ ] **Step 1:** Write the failing test: "surface: every vertexNode is a wall voxel; the mesh has > 2000 triangles".
- [ ] **Step 2:** Implement:
  - the surface, coloured per vertex;
  - clipping planes for 4ch and short axis (at the slider level);
  - conduction-system tubes and the heart-vector arrow;
  - in torso mode, a translucent elliptic cylinder (`TORSO`) with 10 labelled electrode spheres (sprites).

  Compare uses one renderer with two scissor viewports.
- [ ] **Step 3:** Browser check: 3D and torso views of LBBB, with no console errors and three.js not fetched in slice mode
  (check the network panel). Commit "3D and torso heart views".

### Task 8: Docs, final verification, PR

**Files:** `README.md`, `CLAUDE.md` (heart commands no longer need Blender; layout lists the new modules), `site/index.html` tile text if needed.

- [ ] **Step 1:** `npm test` and `.venv/bin/pytest pipeline -q` pass. Then do a browser pass over each category's first rhythm.
- [ ] **Step 2:** Have a fresh reviewer check the whole branch, and fix what it finds.
- [ ] **Step 3:** Commit, push, open the PR listing any rhythms cut at build time, then merge on the owner's word.
