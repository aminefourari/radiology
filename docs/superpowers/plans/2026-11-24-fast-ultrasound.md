# FAST Ultrasound Trainer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new `echo.html` page where a virtual curvilinear probe on a real chest-to-pelvis CT makes a live,
physics-based ultrasound image of the four FAST windows, with simulated free fluid at four sites.

**Architecture:** The pipeline builds one new TotalSegmentator case (`make_case.py`) and a fluid volume
(`make_fluid.py`). In the browser, DOM-free modules do the geometry (`usgeom.js`), skin surface
(`usbody.js`), ultrasound physics and scan conversion (`usrender.js`), view checks (`uswindows.js`) and
URL state (`echostate.js`). `echoapp.js` is the only DOM file. Window texts, target poses and tissue
properties are JSON under `site/echo/`.

**Tech Stack:** Python 3.12 + numpy/scipy/nibabel (pipeline, pytest). Plain ES modules, Canvas 2D, Node's
built-in test runner. No new dependencies, no three.js on this page.

**Spec:** `docs/superpowers/specs/2026-11-24-fast-ultrasound-design.md`

## Global Constraints

- No backend, no build step, no npm dependencies. `echo.html` must never load three.js.
- All `site/js/us*.js` and `echostate.js` stay DOM-free (Node-testable). Only `echoapp.js` touches the DOM.
- Volumes RAS+ `[x,y,z]`, on disk C-order `[z][y][x]`, little-endian, gzipped. `meta.dims = [X,Y,Z]`.
  World coordinates in this plan are **mm in the case grid**: `pos = index * spacing` (no origin offset).
- Display is radiological and never mirrored for RTL. The probe marker shows on the **left of the image**;
  marker points to the patient's head (longitudinal) or the patient's right (transverse).
- UI strings in all 7 languages (en, de, es, ar, fr, it, nl; `tests/translations.test.js` enforces every
  en key). Window **titles** in all 7; window teaching texts in English only (others fall back).
- Credit line: TotalSegmentator dataset, CC BY 4.0. The fluid is shown and credited as **simulated**.
- Fluid only in voxels that no organ label claims and whose HU is soft tissue or fat; never in bone, air,
  lung or inside an organ.
- Shadows, enhancement, interface lines and fluid must come from the physics model, never per-view drawing.
- Commits carry no AI attribution. Branch: `echo-fast` (already created from `origin/main`).

## Review Focus

- Probe dragged to a level the case doesn't cover, or onto a slice where the body outline is missing → the
  probe clamps to the nearest valid level, no NaN pose (Task 4 test `skinPoint clamps`).
- Fan reaching outside the volume → black (no echo), not air reverberation (Task 5 test `outside volume`).
- Arabic (rtl) layout → the ultrasound image, outline and reference CT are not mirrored, marker still on
  image left (Task 8 CSS `direction: ltr` on the image panes, checked by hand in Step 6).
- A hand-edited or old share link with out-of-range or garbage values → clamped to valid state, never a
  throw (Task 6 test `garbage hash`).
- Fast drags on a phone → at most one render per animation frame; depth change rebuilds the scan-conversion
  map once (Task 8 Step 6, measured: a frame under 16 ms on desktop, no queue build-up).

## Data shapes used across tasks

```js
// Pose parameters (what the student controls, and what the hash stores)
// zMm: probe level in world mm along z; theta: degrees round the body, 0 = anterior midline,
//   +90 = patient's LEFT flank, -90 = patient's RIGHT flank, ±180 = back;
// rock, fan in degrees (rock ±60, fan ±80); rot in degrees 0..359 (0 = marker to head, 90 = marker to patient right).
{ zMm, theta, rock, fan, rot }

// Probe frame in world mm (from poseFrame): skin point p, unit beam b (into body),
// unit marker m (in image plane, ⟂ b), unit elevation e = b × m.
{ p: [x,y,z], b: [x,y,z], m: [x,y,z], e: [x,y,z] }
```

---

### Task 1: Pick and build the chest-to-pelvis case

**Files:**
- Modify: `pipeline/make_case.py:26` (REGION_ORDER), `pipeline/make_case.py:117` (budget), `pipeline/caselib.py:74`
- Create: `pipeline/cases/<id>.json`
- Modify: `site/i18n/*.json` (7 files: `region.trunk`)
- Test: `pipeline/test_make_case.py`
- Generated (committed): `site/cases/<id>/{ct,labels}.bin.gz`, `meta.json`, `site/cases/index.json`

**Interfaces:**
- Produces: case `<id>` (call it `TRUNK_ID` below; record the real id in `site/echo/windows.json`, Task 7)
  with structures including `liver`, `spleen`, `kidney_right`, `kidney_left`, `urinary_bladder`,
  `gallbladder`, `heart_myocardium`, `heart_atrium_left/right`, `heart_ventricle_left/right`, the lung lobes,
  ribs, `sternum`, `aorta`, `inferior_vena_cava`, `stomach`, `colon`, `small_bowel`, and `meta.region = "trunk"`.
  Case file gains `"sex": "M" | "F"` (from `meta.csv` `gender`), read by Task 2.

- [ ] **Step 1: Choose the case.** In `data/ts/Totalsegmentator_dataset_v300/meta.csv` (`;`-separated) take
  rows with `study_type == "ct polytrauma"` and `pathology == "no_pathology"`, slice thickness ≤ 3 mm.
  For each, load `segmentations/{heart,liver,spleen,kidney_left,kidney_right,urinary_bladder}.nii.gz` and keep
  those where all six are non-empty and none touches the first/last axial slice (organ fully in field).
  Prefer arms up (no humerus voxels at the liver's z range) and a visibly filled bladder. Do this in a scratch
  script, not in the repo. Write the chosen id and why in the commit message.

- [ ] **Step 2: Write the failing test** in `pipeline/test_make_case.py`:

```python
def test_trunk_region_and_budget(tmp_path):
    # same fake dataset as the end-to-end test, region "trunk", budgetMB 1
    ...
    meta = json.loads((case / "meta.json").read_text(encoding="utf-8"))
    assert meta["region"] == "trunk"
    with pytest.raises(AssertionError, match="over budget"):
        validate_case(str(case), budget_bytes=10)
```

- [ ] **Step 3: Run** `.venv/bin/pytest pipeline/test_make_case.py -q` → FAIL (`'trunk' is not in list`).

- [ ] **Step 4: Implement.** Add `"trunk"` to `REGION_ORDER` after `"abdomen-pelvis"`. Let a case file carry an
  optional `"budgetMB"` that `make_case.py` passes to `validate_case(case_dir, budget_bytes=...)` (default stays 25 MB).
  Add `"region.trunk"` to all 7 i18n files (en "Chest, abdomen & pelvis").

- [ ] **Step 5: Run** the pytest again → PASS. Run `npm test` → translations still PASS.

- [ ] **Step 6: Write `pipeline/cases/<id>.json`**: `region: "trunk"`, title in 7 languages
  (en "Chest, abdomen & pelvis · trauma CT, normal"), `tasks: ["total", "heartchambers_highres"]`,
  `systems` covering organs, heart, lungs, urinary, digestive, chest-wall, spine, arteries, veins,
  `windows: ["soft", "lung", "bone"]`, `sex`, `yRange` to drop the table, a `zRange` from ~2 cm above the heart
  to ~2 cm below the bladder, and 4–5 `keyLevels` (four chambers, hepatorenal, renal hila, bladder) in 7 languages.
  Add `budgetMB` only if the build exceeds 25 MB after cropping; keep it ≤ 32.

- [ ] **Step 7: Build** `.venv/bin/python pipeline/make_case.py data/ts/Totalsegmentator_dataset_v300/<id> <id> --device mps`
  → prints dims and structure count, `validate_case` passes. Open `ct.html#case=<id>` with
  `python3 -m http.server -d site 8000` and check the case appears under the trunk region and the heart chambers,
  kidneys and bladder are labelled.

- [ ] **Step 8: Commit** (case file, i18n, pipeline change, generated case).

---

### Task 2: Simulated free fluid (pipeline)

**Files:**
- Create: `pipeline/fluidlib.py`, `pipeline/make_fluid.py`, `pipeline/test_fluidlib.py`
- Generated (committed): `site/cases/<id>/fluid.bin.gz`

**Interfaces:**
- Consumes: case dir from Task 1 (`ct.bin.gz`, `labels.bin.gz`, `meta.json`) and `pipeline/cases/<id>.json` (`sex`).
- Produces: `fluid.bin.gz`, uint8, same grid and byte order as `labels.bin.gz`. Each voxel
  `v = site * 4 + level`, `site` ∈ {1 Morison/right paracolic, 2 splenorenal/left subphrenic, 3 pelvis,
  4 pericardium}, `level` ∈ {1 small, 2 large}; 0 = never fluid. Voxel is fluid when `level <= amount[site]`.
  `meta.json` gains `"fluid": {"sites": ["morison", "splenorenal", "pelvis", "pericardium"]}`.
- `fluid_map(ct: ndarray[x,y,z] int16, masks: dict[str, ndarray bool], spacing_mm: float, sex: str) -> ndarray uint8`

- [ ] **Step 1: Write failing tests** in `pipeline/test_fluidlib.py` on a synthetic phantom (soft-tissue box at 40 HU,
  a liver block touching a right-kidney block across a 4 mm gap, a spleen/left-kidney pair, a bladder, a heart ball
  with lung blocks beside it, one bone block):

```python
def test_fluid_never_in_organ_bone_air_or_lung(): ...   # (out > 0) & any_mask == none; HU>300, HU<-300 never fluid
def test_large_contains_small(): ...                     # for each site: level-1 voxels ⊆ voxels with level ≤ 2
def test_morison_small_is_between_liver_and_right_kidney():  # every site-1 level-1 voxel within 5 mm of both
def test_pelvis_sits_behind_bladder(): ...              # site-3 voxels have y below the bladder centroid's y
def test_pericardium_is_a_shell_round_the_heart(): ...  # site-4 voxels within 3 mm (small) / 12 mm (large) of heart, none in lung
def test_every_site_nonempty_at_small(): ...
```

- [ ] **Step 2: Run** `.venv/bin/pytest pipeline/test_fluidlib.py -q` → FAIL (module missing).

- [ ] **Step 3: Implement `fluid_map`** with `scipy.ndimage.distance_transform_edt` (sampling = spacing).
  `free = ~any_organ & (-150 <= ct <= 100) & ~lung`. Per site: small = thin band in `free` close to both bounding organs
  (Morison: liver & right kidney; splenorenal: spleen & left kidney; pelvis: bladder, posterior/superior half;
  pericardium: shell 1–3 mm outside the heart union). Large = wider band (Morison extends down the right paracolic gutter
  lateral to the colon; splenorenal wraps the spleen's posterolateral/superior side; pelvis fills the pouch; pericardium
  shell to ~10 mm, thicker posteroinferiorly). Keep only the connected component touching the seed band. Distances are
  tuned by eye in Step 6; the tests' bounds stand.

- [ ] **Step 4: Run** the tests → PASS.

- [ ] **Step 5: Write `make_fluid.py <case_dir> --case-file pipeline/cases/<id>.json`**: reads the case, builds masks
  from `labels.bin.gz` + `meta.structures` (heart = union of `heart_*`, lung = union of `lung_*`), writes `fluid.bin.gz`
  with `write_volume`, adds `meta.fluid`. Add `fluid.bin.gz` to `validate_case`'s size check when present, and assert its
  values decode to known sites/levels.

- [ ] **Step 6: Run on the real case** and check by eye: in `ct.html` there is no fluid overlay, so write a scratch PNG per
  site (axial and sagittal through each site's centroid, fluid in blue over soft window) into the scratchpad and look at
  them. Small = thin stripe in the right space; large = wedge; nothing inside an organ. Tune distances, rerun.

- [ ] **Step 7: Commit** (fluidlib, make_fluid, tests, validate_case change, `fluid.bin.gz`, `meta.json`).

---

### Task 3: Volume sampling and probe frame (`usgeom.js`)

**Files:**
- Create: `site/js/usgeom.js`, `tests/usgeom.test.js`

**Interfaces:**
- Consumes: `extractSlice` from `site/js/volume.js` (test only).
- Produces:
  - `trilinear(vol, dims, spacing, x, y, z, outside) -> number` (world mm; `outside` returned beyond the grid)
  - `nearest(vol, dims, spacing, x, y, z) -> number` (0 outside)
  - `samplePlane(vol, dims, spacing, origin, u, v, w, h, stepMm, out) -> out` (row-major, row r col c at
    `origin + c*stepMm*u + r*stepMm*v`, trilinear)
  - `poseFrame(skin: {p, n}, {rock, fan, rot}) -> {p, b, m, e}` where `n` is the inward skin normal.

- [ ] **Step 1: Write failing tests:**

```js
test("samplePlane on an axial plane equals extractSlice", () => { /* reuse the 2×3×4 volume from volume.test.js,
  spacing [1,1,1], origin at x=X-1,y=Y-1 of slice z, u=[-1,0,0], v=[0,-1,0]: same values as extractSlice(...,"axial",z) */ });
test("trilinear interpolates halfway and returns `outside` beyond the grid", ...);
test("poseFrame with zero angles: b = n, m = +z, e = b × m", ...);
test("rot 90 turns the marker to the patient's right (-x) on an anterior probe", ...); // n = [0,-1,0]
test("rock tilts b toward m; fan tilts b toward e; frame stays orthonormal", ...);
```

- [ ] **Step 2: Run** `node --test tests/usgeom.test.js` → FAIL.

- [ ] **Step 3: Implement.** Frame order: start `b = n`, `m = +z` projected ⟂ `n` and normalised; apply `rot` (rotate `m`
  about `b`, positive turns head → patient right for an anterior probe); then `rock` (rotate `b` and `m` about `e`, positive
  tilts `b` toward `m`); then `fan` (rotate `b` and `e` about `m`). Recompute `e = b × m` each time.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit.**

---

### Task 4: Skin surface and outlines (`usbody.js`)

**Files:**
- Create: `site/js/usbody.js`, `tests/usbody.test.js`

**Interfaces:**
- Produces:
  - `bodyOutline(ct, dims, spacing, nTheta = 180) -> { zMin, zMax, step, nTheta, cx: Float32Array(Z), cy: Float32Array(Z), r: Float32Array(Z*nTheta) }`
    — per axial slice, body = HU > −500 largest region; centroid; radius of the outer skin edge along each θ (θ as in the
    pose shape). Slices with no body get `r = 0` and are excluded from `[zMin, zMax]`.
  - `skinPoint(outline, zMm, theta) -> { p:[x,y,z], n:[x,y,z], zMm }` — clamps `zMm` to `[zMin, zMax]`; `n` is the inward
    normal of the smoothed outline (finite difference over ±3°), unit length.
  - `frontSilhouette(outline) -> { z: Float32Array, left: Float32Array, right: Float32Array }` (x extent per slice, for the
    front view).

- [ ] **Step 1: Write failing tests** on a synthetic elliptical cylinder (semi-axes 150 × 100 mm, HU 40 inside, −1000 outside):

```js
test("radius matches the ellipse within one voxel at θ = 0, ±90, 180", ...);
test("theta +90 is the patient's left (larger x)", ...);
test("inward normal at the anterior midline is [0,-1,0]", ...);
test("skinPoint clamps a zMm above or below the body and never returns NaN", ...);
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit.**

---

### Task 5: Ultrasound physics and scan conversion (`usrender.js`, `site/echo/tissues.json`)

**Files:**
- Create: `site/js/usrender.js`, `site/echo/tissues.json`, `tests/usrender.test.js`

**Interfaces:**
- Consumes: `trilinear`, `nearest`, `poseFrame` output (Task 3).
- Produces:
  - `tissues.json`: `{ "byKey": { "<structure key>": { "b": backscatter 0–1, "a": attenuation dB/cm/MHz, "z": impedance MRayl,
    "tex": speckle strength 0–1 } }, "byHU": [ [hiHU, {b,a,z,tex}], ... ], "fluid": {b,a,z,tex}, "bone": {...}, "gas": {...} }`.
    Starting values: fat z 1.38, soft 1.63, liver 1.65, kidney 1.62, blood/fluid 1.48–1.61 with a ≈ 0.002, soft a ≈ 0.5,
    bone z 7.8, gas z 0.0004. Bone = HU > 300, gas = HU < −300 (unless a label says otherwise). Tuned by eye.
  - `makeTissueLUT(tissues, structures) -> { lut: Float32Array(256*4) }` (per label id: b, a, z, tex)
  - `FAN = { sectorDeg: 60, radiusMm: 50, lines: 192, samples: 384, freqMHz: 3.5 }`
  - `renderFan(caseVol: {ct, labels, fluid, dims, spacing}, frame, { depthMm, gainDb, amounts: [0,a1,a2,a3,a4], lut, tissues }, out: Uint8Array(lines*samples)) -> out`
    — scan line `i` leaves a virtual apex at `p − radiusMm·b`, direction at angle `−30° … +30°` from `b` in the b–m plane, with
    **line 0 on the marker side**. Samples start at the skin (`radiusMm` from apex) and go to `depthMm`.
  - `scanMap(depthMm, W, H) -> Int32Array(W*H)` (index into the polar buffer, −1 outside the fan) and
    `scanConvert(polar, map, rgba)`; marker side on the image left.

- [ ] **Step 1: Write failing tests** on synthetic volumes (soft tissue 40 HU, spacing 1 mm, anterior probe pointing −y→+y):

```js
test("a bone block shadows everything below it", ...);              // mean brightness below the block < 10% of beside it
test("a fluid block is near-black and the tissue behind it is brighter", ...); // posterior enhancement > 1.3× beside
test("brightness falls with depth when gain is 0 and no fluid", ...); // TGC compensates soft tissue only
test("a gas pocket gives a bright line then repeated reverberation bands", ...);
test("outside the volume is black, not gas", ...);
test("speckle is fixed to the body: sliding the probe 1 mm along m shifts the pattern, not reshuffles it", ...);
test("fluid shows only when level <= amount for its site", ...);
test("line 0 is on the marker side and maps to the image left", ...);
```

- [ ] **Step 2: Run** `node --test tests/usrender.test.js` → FAIL.

- [ ] **Step 3: Implement the scan-line model** (per line, front to back, step `ds = depth/samples`):

```text
I = 1; Zprev = z(first sample)
for each sample s at depth d:
  t = tissue(label, HU, fluid)                    # fluid overrides when level <= amount[site]
  R = ((t.z - Zprev)/(t.z + Zprev))^2             # interface reflection
  echo = I * (R * SPEC + t.b * speckle(pos)^t.tex)
  I *= (1 - R) * 10^(-2 * t.a * f * ds / 200)     # two-way attenuation, ds in mm → cm
  if t is gas: add reverberation copies at 2d, 3d… with decay, then I *= 0.02
  tgc = 10^(2 * SOFT_A * f * d / 200)             # compensates soft tissue only → fluid gives enhancement
  out[s] = clamp(255 * logCompress(echo * tgc * 10^(gain/20)))
  Zprev = t.z
```
  `speckle(pos)`: Rayleigh value from an integer hash of `floor(pos / 0.4 mm)`, blurred along the beam over 3 samples.
  `SPEC` (specular boost) and the log-compression dynamic range (~50 dB) are tuning constants at the top of the file.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit.**

---

### Task 6: Page state in the URL (`echostate.js`)

**Files:**
- Create: `site/js/echostate.js`, `tests/echostate.test.js`

**Interfaces:**
- Produces: `ECHO_DEFAULTS = { win: "ruq", pose: null, depth: 160, gain: 0, fluid: [0,0,0,0], labels: true, lang: null }`;
  `parseEchoHash(hash) -> partial state`; `clampEchoState(s, { windows, outline, langs }) -> state`;
  `formatEchoHash(s) -> string`. Hash form: `w=ruq&p=<zMm>,<theta>,<rock>,<fan>,<rot>&d=160&g=0&f=0102&l=1&lang=en`.
  Clamps: depth 80–240, gain −20…+20, fluid digits 0–2, rock ±60, fan ±80, rot mod 360, theta wrapped to ±180,
  zMm via `outline` bounds, unknown window → `"ruq"`, `pose: null` → that window's target pose.

- [ ] **Step 1: Write failing tests:** round trip of a full state; `garbage hash` (`p=a,b,,9e99&d=-5&f=9x`) clamps without throwing;
  missing pose falls back to the window's target. **Step 2: Run** → FAIL. **Step 3: Implement** (follow `site/js/state.js`).
  **Step 4: Run** → PASS. **Step 5: Commit.**

---

### Task 7: FAST windows, targets and view checks (`site/echo/windows.json`, `uswindows.js`)

**Files:**
- Create: `site/echo/windows.json`, `site/js/uswindows.js`, `tests/echowindows.test.js`
- Modify: `tests/translations.test.js` (window titles in 7 languages)

**Interfaces:**
- Consumes: Tasks 3–5 and the real case (`site/cases/<id>/`, read with `node:zlib` `gunzipSync` in the test).
- Produces:
  - `windows.json`: `{ "case": "<id>", "windows": [ { "key": "ruq" | "luq" | "pelvic-trans" | "pelvic-sag" | "subxiphoid",
    "group": "ruq" | "luq" | "pelvic" | "subxiphoid", "title": {7 langs}, "where": en, "see": en, "mistakes": en,
    "target": { zMm, theta, rock, fan, rot }, "landmarks": [ { "keys": ["liver"], "minFrac": 0.08 }, ... ],
    "fluidSite": 1 } ] }`.
  - `fanContents(caseVol, frame, depthMm) -> Map<labelId, fraction of fan samples>` (+ key `"fluid:<site>"` counts at the
    current amounts).
  - `viewFound(contents, window, structuresByKey) -> boolean` (every landmark group meets `minFrac`).
  - `closeness(pose, target) -> 0..1` (1 at target; falls off over ~40 mm of skin distance and ~30° of angle).

- [ ] **Step 1: Find each target pose by hand** on the running page (Task 8 can come first for this step only, or use a scratch
  script that writes PNGs from `renderFan`): RUQ mid-axillary line at the level of the hepatorenal space, marker to head;
  LUQ posterior axillary line, higher than RUQ, marker to head; pelvic just above the pubis, transverse (rot 90) and sagittal
  (rot 0), fanned down into the pelvis; subxiphoid just below the xiphoid, marker to patient's right, beam flattened (fan ~70°)
  toward the left shoulder. Record them in `windows.json`, with the texts.

- [ ] **Step 2: Write failing tests** in `tests/echowindows.test.js`:

```js
for (const w of windows) test(`${w.key}: target pose shows its landmarks`, () => assert.ok(viewFound(fanContents(...), w, byKey)));
for (const w of windows.filter((w) => w.fluidSite)) test(`${w.key}: small fluid at its site is in the fan`, ...); // > 0.2%
test("a pose 90° rotated from the RUQ target is not 'found'", ...);
test("closeness is 1 at target and < 0.3 at another window's target", ...);
```
  Landmarks: RUQ liver + kidney_right; LUQ spleen + kidney_left; pelvic urinary_bladder; subxiphoid any `heart_*` + liver.

- [ ] **Step 3: Run** `node --test tests/echowindows.test.js` → FAIL. **Step 4: Implement** `uswindows.js`. **Step 5: Run** → PASS;
  `npm test` → all PASS (translations includes window titles). **Step 6: Commit.**

---

### Task 8: The page (`echo.html`, `echoapp.js`), home tile, docs

**Files:**
- Create: `site/echo.html`, `site/js/echoapp.js`, `site/img/echo.jpg`
- Modify: `site/style.css` (an `.echo-page` section), `site/index.html` (fourth tile), `site/i18n/*.json` (`echo.*`,
  `home.echo`; `home.credits` mentions the simulated fluid), `CLAUDE.md` (commands + layout lines for the echo page)

**Interfaces:**
- Consumes: `loadCase`, `decodeMaybeGzip` (volume.js; fetch `fluid.bin.gz` separately), i18n.js, everything above.

- [ ] **Step 1: Markup** following the spec's layout sketch: window buttons (RUQ, LUQ, Pelvic with a transverse/sagittal toggle,
  Subxiphoid); the ultrasound canvas with a marker dot on its left and a depth scale; per-site fluid selects (none/small/large) and
  "All positive"; a visible "Simulated fluid" badge whenever any amount > 0; the window text panel; on the right the front outline
  canvas, the axial ring canvas, rock/fan/rotate sliders (with ◀ ▶ step buttons), depth and gain sliders, a labels checkbox, the
  reference CT canvas, Show me, and a closeness meter with "View found ✓". Header like `heart.html` (title links home, language select).
  Image panes get `direction: ltr`.

- [ ] **Step 2: `echoapp.js`**: load the case with progress; build outline, LUT, scan map; one `requestAnimationFrame` render loop that
  draws only when state is dirty; pointer drag on the front outline sets `zMm` and side, on the ring sets `theta`; keys: arrows slide
  (z / θ), `Q/E` rock, `A/D` fan, `R` rotate 90°; Show me animates the pose to the target over ~600 ms; labels overlay draws outlines and
  names of structures in the fan from `nearest` labels on the polar grid; reference CT = `samplePlane` through `p` spanned by `m` and `b`
  (soft window) with the fan drawn on it; hash written on change via `formatEchoHash`.

- [ ] **Step 3: Strings** `echo.*` in all 7 languages; window titles already in `windows.json`.

- [ ] **Step 4: Home tile** linking `echo.html` with `home.echo` text; `img/echo.jpg` is a 720×360 screenshot of the RUQ window with
  small Morison fluid (take it with the Playwright tools at that size).

- [ ] **Step 5: Run** `npm test` and `.venv/bin/pytest pipeline -q` → all PASS.

- [ ] **Step 6: Check by hand** (`python3 -m http.server -d site 8000`, desktop and a 390 px wide viewport, en and ar):
  - each window's Show me lands on a "View found" view; RUQ shows liver over right kidney, rib shadows when the probe slides up;
  - rocking moves structures across the image, fanning sweeps through the kidney, rotate 90° swaps to transverse and the marker side
    text updates; marker dot stays on the image left in ar;
  - each fluid site at small/large shows a black stripe/wedge in its window, with brighter tissue behind; badge visible;
  - the network panel shows no three.js request; a render stays under 16 ms on desktop while dragging.

- [ ] **Step 7: Update `CLAUDE.md`** (echo page files, `make_fluid.py` command, fluid encoding) and **commit**.

---

### Task 9: Tune the look against textbook images

**Files:** `site/echo/tissues.json`, constants at the top of `site/js/usrender.js`, `pipeline/fluidlib.py` distances (if needed).

- [ ] **Step 1:** Put each window's image beside a typical textbook FAST image of the same view (by eye, nothing copied into the repo):
  liver mid-grey and fine-grained; renal cortex slightly darker than liver, sinus fat bright; Morison's interface a thin bright line;
  bladder black with posterior enhancement; pericardium a bright line round the heart with a black stripe when positive.
- [ ] **Step 2:** Adjust values, rerun `npm test` (the physics tests must still pass), recheck the five views.
- [ ] **Step 3:** Commit, with before/after screenshots described in the message.
