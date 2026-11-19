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
- Build ECGs: `.venv/bin/python pipeline/make_ecg.py` (records listed in `pipeline/ecgs.json`, PTB-XL)

## Layout

- `pipeline/` — `caselib.py` (pure helpers), `make_case.py` (CLI), `structures.json`
  (structure → system/colour/names catalogue), `cases/<id>.json` (curated key levels),
  `make_ecg.py` + `ecgs.json` (PTB-XL ECG list)
- `site/` — static site: `index.html` (landing, `js/home.js`; redirects old `#case=` links), `ct.html` (CT), `ecg.html` (ECG, `js/ecgapp.js` + `js/ecgplot.js`), `ecg/` (ECG JSON, µV ints), `style.css`, `js/*.js` (ES modules), `i18n/*.json`,
  `cases/` (generated case data, committed)
- `tests/` — Node tests for `site/js` modules
- `data/` — downloaded datasets (gitignored)

## Conventions

- Volumes: RAS+ arrays `[x,y,z]`; on disk C-order `[z][y][x]`, little-endian, gzipped.
  `meta.dims = [X,Y,Z]`. CT int16 HU, labels uint8 (0 = background).
- Display is radiological: patient right on viewer's left, in every language (never mirror for RTL).
- `site/js` modules other than `app.js` must stay DOM-free so Node can test them.
- No backend, no build step, no npm dependencies.
- Languages: en, de, es, ar (rtl), fr, it, nl; missing strings fall back to en.
- Data credit: TotalSegmentator dataset, CC BY 4.0; PTB-XL, CC BY 4.0. Code: MIT.
- Commits carry no AI attribution.
