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
- Heart page (Z-Anatomy, needs Blender): `.venv/bin/python pipeline/make_atlas.py heart` (Blender → `site/heart/heart.glb`
  + `heart-graph.json`; landmark hints in `pipeline/heart_landmarks.json`). Rhythms live in `site/heart/rhythms.json`;
  `tests/heartrhythms.test.js` checks each one against its ECG criteria on the shipped graph — rerun after any change.
- Build ECGs: `.venv/bin/python pipeline/make_ecg.py` (records listed in `pipeline/ecgs.json`, PTB-XL)

## Layout

- `pipeline/` — `caselib.py` (pure helpers), `make_case.py` (CLI), `atlaslib.py` + `atlas_export.py` + `make_atlas.py` + `atlas_map.json` (3D atlas), `structures.json`
  (structure → system/colour/names catalogue), `cases/<id>.json` (curated key levels),
  `make_ecg.py` + `ecgs.json` (PTB-XL ECG list)
- `site/` — static site: `index.html` (landing, `js/home.js`; redirects old `#case=` links), `ct.html` (CT), `ecg.html` (ECG, `js/ecgapp.js` + `js/ecgplot.js` + `js/ecglearn.js` for the reading steps and Learn mode), `ecg/` (ECG JSON, µV ints), `heart.html` (heart electrophysiology: `js/heartapp.js`, `js/heartview.js` (three.js),
  DOM-free `js/heartsim.js` (activation, heart vector, leads, rhythm engine), `js/heartmeasure.js`, `js/ladder.js`,
  `js/heartstate.js`), `heart/` (heart GLB, simulation graph, rhythms + texts), `style.css`, `js/*.js` (ES modules), `i18n/*.json`,
  `cases/` (generated case data, committed), `atlas/` (3D atlas GLBs + index, CC BY-SA 4.0)
- `tests/` — Node tests for `site/js` modules
- `data/` — downloaded datasets (gitignored)

## Conventions

- Volumes: RAS+ arrays `[x,y,z]`; on disk C-order `[z][y][x]`, little-endian, gzipped.
  `meta.dims = [X,Y,Z]`. CT int16 HU, labels uint8 (0 = background).
- Display is radiological: patient right on viewer's left, in every language (never mirror for RTL).
- `site/js` modules other than the `*app.js` files, `view3d.js` and `heartview.js` (three.js) must stay DOM-free so Node can test them.
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
