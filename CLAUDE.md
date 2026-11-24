# CT Anatomy Viewer

Static, multilingual web atlas of CT anatomy. An offline Python pipeline turns open-dataset CTs
into compact case files; a no-build static site reslices and labels them in the browser.
Design: `docs/superpowers/specs/2026-11-18-ct-anatomy-viewer-design.md`.

## Commands

- Pipeline env: `uv venv -p 3.12 .venv && uv pip install -p .venv -r pipeline/requirements.txt`
  (use Python 3.12 — TotalSegmentator/torch lag new Pythons)
- Pipeline tests: `.venv/bin/pytest pipeline -q`
- Viewer tests: `npm test` (Node built-in test runner, no npm deps)
- Run site locally: `python3 -m http.server -d site 8000`
- Build a case: `.venv/bin/python pipeline/make_case.py data/<dataset_case_dir> <case_id>`
- 3D atlas (Z-Anatomy; needs Blender, `data/zanatomy/` and the BodyParts3D kidney STLs in `data/bp3d/`):
  `.venv/bin/python pipeline/make_atlas.py export` (Blender → `site/atlas/*.glb` + `index.json`), then
  `make_atlas.py link` (validates `pipeline/atlas_map.json` into `index.json`), then
  `make_atlas.py fit site/cases/<id> ...` (per-case plane fit `atlaslink.json`; rerun after rebuilding a case)
- Heart page: no build step — the idealised heart is generated in the browser by `site/js/heartshape.js` (shape,
  orientation and Purkinje territories in `SHAPE`, found by search so NSR/RBBB/LBBB/LAFB meet their criteria). Rhythms
  live in `site/heart/rhythms.json`; `tests/heartrhythms.test.js` and `tests/heartcatalogue.test.js` check each one
  against its ECG criteria — rerun after any change to the shape, engine or a model.
- Build ECGs: `.venv/bin/python pipeline/make_ecg.py` (records listed in `pipeline/ecgs.json`, PTB-XL)
- FAST trainer fluid: `.venv/bin/python pipeline/make_fluid.py site/cases/s0739-trunk [--png DIR]` writes `fluid.bin.gz`
  (uint8, `site*4 + level`, sites morison/splenorenal/pelvis/pericardium, level 1 small / 2 large). Rerun after rebuilding
  the case (make_case rewrites meta.json). `tests/echowindows.test.js` checks each window's target pose on the real case.

## Layout

- `pipeline/` — `caselib.py` (pure helpers), `make_case.py` (CLI), `atlaslib.py` + `atlas_export.py` + `make_atlas.py` + `atlas_map.json` (3D atlas), `structures.json`
  (structure → system/colour/names catalogue), `cases/<id>.json` (curated key levels),
  `make_ecg.py` + `ecgs.json` (PTB-XL ECG list)
- `site/` — static site: `index.html` (landing, `js/home.js`; redirects old `#case=` links), `ct.html` (CT), `ecg.html` (ECG, `js/ecgapp.js` + `js/ecgplot.js` + `js/ecglearn.js` for the reading steps and Learn mode), `ecg/` (ECG JSON, µV ints), `heart.html` (heart & ECG simulator: `js/heartapp.js`, DOM `js/heartschematic.js` (slice view),
  `js/heartpicker.js`, `js/heartview.js` (three.js 3D/torso); DOM-free `js/heartshape.js` (idealised heart, slices, surface),
  `js/heartsim.js` (activation, heart vector, leads, rhythm engine), `js/heartplots.js`, `js/heartmeasure.js`, `js/ladder.js`,
  `js/heartstate.js`), `heart/` (rhythms + texts), `echo.html` (FAST ultrasound trainer: `js/echoapp.js`; DOM-free
  `js/usgeom.js` (sampling, probe frame), `js/usbody.js` (skin outline), `js/usrender.js` (pulse-echo model, scan conversion),
  `js/uswindows.js` (view checks), `js/echostate.js`), `echo/` (`windows.json` target poses + texts, `tissues.json` acoustics), `style.css`, `js/*.js` (ES modules), `i18n/*.json`,
  `cases/` (generated case data, committed), `atlas/` (3D atlas GLBs + index, CC BY-SA 4.0)
- `tests/` — Node tests for `site/js` modules
- `data/` — downloaded datasets (gitignored)

## Conventions

- Volumes: RAS+ arrays `[x,y,z]`; on disk C-order `[z][y][x]`, little-endian, gzipped.
  `meta.dims = [X,Y,Z]`. CT int16 HU, labels uint8 (0 = background).
- Display is radiological: patient right on viewer's left, in every language (never mirror for RTL).
- `site/js` modules other than the `*app.js` files, `view3d.js`, `heartview.js`, `heartschematic.js` and `heartpicker.js` must stay DOM-free so Node can test them.
- RAS+ means **+x is the patient's right**. Echo probe θ: 0 anterior, +90 patient's left flank; rot +90 = marker to the patient's right;
  the marker side is the image's left. Ultrasound features (shadows, enhancement, fluid) must come from the physics model, never per view.
- Heart rhythm texts: titles in all 7 languages; why/looks/takeaways in English (other languages fall back).
- Heart simulation: a rhythm's teaching feature (R′ in V1, delta wave, flutter polarity…) must come from the vector model,
  never a hand-drawn template; a rhythm that can't pass its criteria is left out, not faked.
- No backend, no build step, no npm dependencies. One CDN library: three.js 0.170.0 (import map in
  `ct.html`), loaded with `import()` only when the 3D view opens — the 2D views must never fetch it (heart.html has its own copy).
- Languages: en, de, es, ar (rtl), fr, it, nl; missing strings fall back to en.
- Data credit: TotalSegmentator dataset, CC BY 4.0; PTB-XL and PTB-XL+, CC BY 4.0.
  3D atlas: Z-Anatomy (CC BY-SA 4.0) from BodyParts3D (DBCLS, CC BY-SA 2.1 JP), see `site/atlas/LICENSE.txt`;
  never ship Z-Anatomy's non-commercial parts (inner ear, Lissie Cowley's kidney).
- ECG paper is one SVG in mm units (viewBox = paper mm); strokes use `vector-effect: non-scaling-stroke`. Code: MIT.
- Commits carry no AI attribution.
