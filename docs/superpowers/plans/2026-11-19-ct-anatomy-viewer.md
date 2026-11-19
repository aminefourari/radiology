# CT Anatomy Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a public, multilingual, static web atlas that shows a real abdominal CT in three planes, with colored structure overlays toggled by system, leader-line labels, key levels, and community error reporting.

**Architecture:** An offline Python pipeline turns a TotalSegmentator-dataset CT into `site/cases/<id>/{ct.bin.gz, labels.bin.gz, meta.json}`. A no-build static site (plain ES modules) loads a case, reslices the typed arrays in the browser, draws them on a canvas, and puts an SVG label layer on top. All state lives in the URL hash.

**Tech Stack:** Python 3.10+ (nibabel, numpy, scipy, TotalSegmentator, pytest). Browser: vanilla JS ES modules, Canvas 2D, SVG, `DecompressionStream`. JS tests: Node 20+ built-in `node --test`, with no npm dependencies.

**Spec:** `docs/superpowers/specs/2026-11-18-ct-anatomy-viewer-design.md`

## Global Constraints

- No backend and no build step. The site is plain files under `site/`, servable by any static host.
- No npm dependencies. The root `package.json` exists only for `"type": "module"` and the `test` script.
- Each case download is ≤ 25 MB total (`ct.bin.gz` + `labels.bin.gz` + `meta.json`).
- The data is the TotalSegmentator dataset, **CC BY 4.0**. Credit it in the site footer, `README.md` and `meta.json`.
- Languages: `en, de, es, ar, fr, it, nl`. A missing translation falls back to `en`. `ar` uses `dir="rtl"`.
- **The scan never mirrors:** patient right is on the viewer's left in every language, and the R/L markers never move.
- Footer copy (en): "Educational use only — not for diagnosis. Labels are generated automatically and reviewed by the community."
- Systems at launch, in this order: `organs, segments, digestive, urinary, pelvis, spine, arteries, veins`. There are no lymph node or peritoneum systems.
- Window presets (center/width HU): soft tissue 40/400, liver 60/160, bone 400/1800, lung −600/1500.
- Commits carry no AI attribution trailers or footers (the owner's global rule).

### Shared data conventions (every task relies on these)

- Canonical orientation is **RAS+** (`nib.as_closest_canonical`). Array axes `[x, y, z]` increase toward patient Right, Anterior and Superior.
- Volumes are written as **C-order `[z][y][x]`**, little-endian, gzipped: `flat = z*Y*X + y*X + x`. `meta.dims = [X, Y, Z]` and `meta.spacing = [sx, sy, sz]` in mm. CT is `int16` HU and labels are `uint8`, with `0` = background.
- Slice index per plane: axial = `z`, coronal = `y`, sagittal = `x`.
- Display mapping, for column `c` and row `r` of the 2D slice:
  - axial(z): `x = X-1-c`, `y = Y-1-r` (patient right on the left, anterior at the top)
  - coronal(y): `x = X-1-c`, `z = Z-1-r` (superior at the top)
  - sagittal(x): `y = Y-1-c`, `z = Z-1-r` (anterior on the left)
- Pixel aspect (mm per column, mm per row): axial `[sx, sy]`, coronal `[sx, sz]`, sagittal `[sy, sz]`.
- `meta.json` shape:
  ```json
  {"id":"s0011","dims":[X,Y,Z],"spacing":[sx,sy,sz],"orientation":"RAS",
   "source":{"name":"TotalSegmentator dataset","license":"CC BY 4.0","url":"https://zenodo.org/record/6802614","case":"s0011"},
   "structures":[{"id":1,"key":"liver","system":"organs","color":"#e8a0d8","parent":null,
                  "names":{"en":"Liver","de":"Leber",...},"best":{"axial":z,"coronal":y,"sagittal":x}}],
   "keyLevels":[{"names":{"en":"Celiac trunk",...},"axial":z}]}
  ```
- `parent`: the id of a coarser structure (Couinaud segments → `liver`). When a label's own system is off but its parent's system is on, the pixel is drawn in the parent's colour.
- URL hash: `#case=s0011&lang=en&plane=coronal&slice=120&sys=organs,segments&zoom=1` (parsed with `URLSearchParams`).

## Review Focus

1. **A host serves `.bin.gz` with `Content-Encoding: gzip`**, so the browser hands over bytes that are already decompressed. The viewer must still load. Check the gzip magic bytes `1f 8b`, and decompress only if they're present. Test: Task 3 `decodeMaybeGzip`.
2. **Arabic (RTL)**: the controls mirror, but the scan, the R/L/A/P markers and the label sides must not. Test: Task 4 `layoutLabels` takes no direction input. Task 6 checklist item.
3. **A bad or stale share link** (unknown case, `slice=9999`, `plane=foo`, `lang=xx`, `zoom=-3`) opens a valid view clamped to the defaults instead of crashing. Test: Task 5 `parseHash` with `clampState`.
4. **Structures that are empty after cropping, or tiny ones (1 voxel)**: the pipeline drops zero-voxel structures, so a best slice is never NaN. A 1-pixel structure still gets an anchor. Tests: Task 1 `best_slices`, Task 4 `anchors`.
5. **Many labels on a short portrait-phone canvas (≥ 15 visible)**: labels must never overlap or leave the canvas. If they don't fit, `layoutLabels` returns `null` and the UI falls back to tap-only labels. Test: Task 4.

---

### Task 1: Pipeline core + project scaffolding

**Files:**
- Create: `CLAUDE.md` (commands: `pip install -r pipeline/requirements.txt`, `pytest pipeline`, `npm test`, `python3 -m http.server -d site 8000`, `python pipeline/make_case.py …`; layout; the data conventions above in short)
- Create: `.gitignore` (`data/`, `__pycache__/`, `.venv/`, `*.nii.gz`)
- Create: `LICENSE` (MIT, holder "radiology contributors")
- Create: `package.json` → `{"name":"radiology","private":true,"type":"module","scripts":{"test":"node --test tests/"}}`
- Create: `pipeline/requirements.txt` (`nibabel`, `numpy`, `scipy`, `TotalSegmentator`, `pytest`)
- Create: `pipeline/caselib.py`
- Test: `pipeline/test_caselib.py`

**Interfaces:**
- Produces (`pipeline/caselib.py`):
  - `load_canonical(path: str) -> tuple[np.ndarray, tuple[float, float, float]]`: an RAS+ array `[x,y,z]` and its spacing.
  - `resample(arr: np.ndarray, spacing, target_mm: float | None, order: int) -> tuple[np.ndarray, tuple]`: `scipy.ndimage.zoom`. Returns the input unchanged when `target_mm` is None or already matches. Use `order=0` for labels and `order=1` for CT.
  - `body_bbox(ct: np.ndarray, threshold: float = -500, margin: int = 2) -> tuple[slice, slice, slice]`
  - `build_label_map(masks: dict[str, np.ndarray], structures: list[dict]) -> tuple[np.ndarray, list[dict]]`: paints a uint8 map in `structures` order (later wins), assigns ids `1..n` in order, and **drops structures whose mask is missing or empty**. Returns the map and the kept structures, each with an `id`.
  - `best_slices(labels: np.ndarray, ids: list[int]) -> dict[int, dict]`: for each id, the index along each axis with the most voxels, as `{"axial": z, "coronal": y, "sagittal": x}`.
  - `write_volume(path: str, arr_xyz: np.ndarray, dtype: str) -> None`: transposes to `[z,y,x]`, makes it C-contiguous little-endian `dtype` (`"<i2"` or `"u1"`), and gzips it.
  - `validate_case(case_dir: str, budget_bytes: int = 25 * 1024 * 1024) -> None`: asserts that the decompressed byte counts equal `X*Y*Z*2` and `X*Y*Z`, that every label value in the volume is 0 or an id in `meta.structures`, and that the total size ≤ budget.

- [ ] **Step 1: Write the failing tests** in `pipeline/test_caselib.py`, using synthetic nibabel images written to `tmp_path`:
  - `test_load_canonical_reorients_las_to_ras`: a 3×2×2 array with an LAS affine (`diag(-1,1,1,1)`). After loading, `arr[0,0,0]` equals the original `arr[2,0,0]`, and the spacing is `(1.0,1.0,1.0)`.
  - `test_resample_noop_and_halves`: `target_mm=None` returns the same object. A 4×4×4 volume at 1 mm with `target_mm=2` has shape `(2,2,2)` and spacing `(2,2,2)`.
  - `test_body_bbox_trims_air`: a −1000 volume with a 0-HU cube at `[3:5,3:5,3:5]` and `margin=0` gives `(slice(3,5),)*3`.
  - `test_build_label_map_later_wins_and_drops_empty`: structures `[liver, liver_segment_1, empty_thing]`, with the segment overlapping half the liver. The map has the segment id (2) where they overlap, and `empty_thing` is not in the returned list.
  - `test_best_slices_picks_max_area`: an id that has more voxels at z=3 than at z=1 gives `axial == 3`.
  - `test_write_volume_layout`: write `arr[x,y,z] = x + 10*y + 100*z` (shape 2×3×4, `<i2`), gunzip it, and `np.frombuffer(..., "<i2")[z*3*2 + y*2 + x]` equals the value at `(x,y,z)` for every voxel.
  - `test_validate_case_rejects_unknown_label`: a case whose labels contain a value missing from meta raises `AssertionError`.

- [ ] **Step 2: Run** `pytest pipeline -q`. Expected: the tests FAIL (ImportError / missing functions).

- [ ] **Step 3: Implement `pipeline/caselib.py`** with the signatures above. For `best_slices`, use one pass of `np.bincount`-style counting per axis (for example `np.add.reduceat` or a loop over the ids with `mask.sum(axis=…)`), not O(ids × voxels) Python loops.

- [ ] **Step 4: Run** `pytest pipeline -q`. Expected: all pass.

- [ ] **Step 5: Write `CLAUDE.md`, `.gitignore`, `LICENSE`, `package.json`, requirements.** Commit:
  ```bash
  git add CLAUDE.md .gitignore LICENSE package.json pipeline/
  git commit -m "Add pipeline core: canonical volumes, label map, case validation"
  ```

### Task 2: Structure catalogue, `make_case` CLI, first real case

**Files:**
- Create: `pipeline/structures.json`
- Create: `pipeline/make_case.py`
- Create: `pipeline/cases/<case_id>.json` (key levels)
- Create: `site/cases/index.json`, `site/cases/<case_id>/{ct.bin.gz,labels.bin.gz,meta.json}` (generated, committed)
- Test: `pipeline/test_make_case.py`

**Interfaces:**
- Consumes: all of `caselib` (Task 1).
- Produces: `pipeline/structures.json`, shaped as `{"structures":[{"key","source":"total"|"liver_segments","system","color","parent":key|null,"names":{en,de,es,ar,fr,it,nl}}]}`. `key` is the dataset/TotalSegmentator file stem (for example `liver`, `kidney_left`, `liver_segment_4`, `vertebrae_L1`).
- Produces: `make_case.py <dataset_case_dir> <case_id> [--no-liver-segments] [--voxel-mm 1.5] [--z-range lo:hi]`. It reads `<dir>/ct.nii.gz` and `<dir>/segmentations/<key>.nii.gz`. Unless `--no-liver-segments` is set, it runs `TotalSegmentator -i ct.nii.gz -o data/tmp/<case_id>_liverseg -ta liver_segments` and reads `liver_segment_{1..8}.nii.gz`. It writes the case files, merges key levels from `pipeline/cases/<case_id>.json` (`{"keyLevels":[{"names":{…},"axial":z_in_output_space}]}`), upserts `{"id","title":{lang:…}}` into `site/cases/index.json`, and finally calls `validate_case`.
- Produces: `meta.json` exactly as in Global Constraints. `parent` is resolved from key to id, and becomes `null` if the parent was dropped.

- [ ] **Step 1: Check the license.** Read the official README at https://github.com/wasserth/TotalSegmentator. If `liver_segments` is listed among the open (Apache-2.0) tasks, continue. If not, use `--no-liver-segments` for the first case, and note it in the PR and in `README.md` (the Segments system then simply doesn't appear).

- [ ] **Step 2: Write the failing test** `pipeline/test_make_case.py::test_make_case_end_to_end`. It builds a fake dataset dir in `tmp_path`: a 20×20×20 CT and `segmentations/liver.nii.gz` + `segmentations/aorta.nii.gz`. It runs `main([dir, "t1", "--no-liver-segments", "--out", str(tmp_path/"site")])` (`--out` defaults to `site`), then asserts that `validate_case` passes, that `meta["structures"][*]["key"] == ["liver","aorta"]` (in catalogue order), that every structure has `best` with all 3 planes, and that `index.json` lists `t1` once even after a second run.

- [ ] **Step 3: Run** `pytest pipeline/test_make_case.py -q`. Expected: FAIL.

- [ ] **Step 4: Write `pipeline/structures.json`.** Map the dataset's abdominal and pelvic stems to the systems: organs (liver, spleen, pancreas, gallbladder, adrenals, kidneys); segments (liver_segment_1…8, `parent: "liver"`, labelled "Liver segment I (Couinaud)" and so on); digestive (esophagus, stomach, duodenum, small_bowel, colon); urinary (kidneys go here *instead of* organs, plus urinary_bladder); pelvis (hip_left/right, sacrum, femur heads if present); spine (vertebrae T10–S1); arteries (aorta, iliac arteries); veins (inferior_vena_cava, portal_vein_and_splenic_vein, iliac veins). Put liver before its segments (later wins). Use distinct, mid-saturation colours readable on grayscale. Draft names in all 7 languages from Terminologia Anatomica equivalents.

- [ ] **Step 5: Implement `pipeline/make_case.py`** (`main(argv: list[str] | None) -> None`). Steps: load the CT, crop to `body_bbox` (plus `--z-range`), resample, load and crop and resample every catalogue mask (`order=0`), `build_label_map`, `best_slices`, write the volumes and `meta.json` (UTF-8, `ensure_ascii=False`), update the index, then `validate_case`.

- [ ] **Step 6: Run** `pytest pipeline -q`. Expected: all pass.

- [ ] **Step 7: Make the real case.** Download the TotalSegmentator dataset (the latest version linked from the Zenodo record) into `data/` (gitignored). Use `meta.csv` and a visual check to pick one contrast-enhanced (venous-phase if possible) adult CT that covers the liver dome to the pelvis. Run `python pipeline/make_case.py data/<dir> <case_id>`. Expected: it finishes with no AssertionError, and `du -ch site/cases/<case_id>/*` is ≤ 25 MB. If it's over budget, rerun with `--voxel-mm 2.0` or a tighter `--z-range`.

- [ ] **Step 8: Curate the key levels.** Open the CT (any NIfTI viewer, or the Task 6 viewer once it exists) and write `pipeline/cases/<case_id>.json` with axial indices *in output space* for: esophageal hiatus / GE junction, celiac trunk, SMA origin, renal veins, aortic bifurcation. Names go in all 7 languages. Then rerun step 7. Sanity pass: drop (remove from the catalogue) any structure whose mask is obviously broken on its best slices.

- [ ] **Step 9: Commit**
  ```bash
  git add pipeline/ site/cases/
  git commit -m "Add structure catalogue, make_case CLI and first abdominal case"
  ```

### Task 3: Volume loading and reslicing (browser)

**Files:**
- Create: `site/js/volume.js`
- Test: `tests/volume.test.js`

**Interfaces:**
- Produces (`site/js/volume.js`, named exports):
  - `PLANES = ["axial","coronal","sagittal"]`
  - `WINDOWS = {soft:{c:40,w:400}, liver:{c:60,w:160}, bone:{c:400,w:1800}, lung:{c:-600,w:1500}}`
  - `decodeMaybeGzip(buf: ArrayBuffer): Promise<ArrayBuffer>`: inflates via `DecompressionStream("gzip")` only if bytes 0–1 are `0x1f 0x8b`.
  - `loadCase(baseUrl: string, onProgress?: (fraction:number)=>void): Promise<{meta, ct: Int16Array, labels: Uint8Array}>`: fetches `meta.json`, then both volumes in parallel. Progress is reported from `Content-Length` when available.
  - `sliceCount(dims: number[], plane: string): number`
  - `planeSize(dims: number[], plane: string): [w: number, h: number]`: axial `[X,Y]`, coronal `[X,Z]`, sagittal `[Y,Z]`.
  - `pixelAspect(spacing: number[], plane: string): [mmPerCol, mmPerRow]`
  - `extractSlice(vol: Int16Array|Uint8Array, dims: number[], plane: string, index: number): Int16Array|Uint8Array`: length `w*h`, row-major, using the display mapping in Global Constraints.
  - `windowToGray(slice: Int16Array, center: number, width: number, out: Uint8ClampedArray): void`: writes RGBA (`a=255`) linearly, clamped to `[c-w/2, c+w/2]`.

- [ ] **Step 1: Write the failing tests** in `tests/volume.test.js` (`node:test`, `node:assert/strict`). Use a synthetic volume with `dims=[2,3,4]` where `vol[z*6+y*2+x] = x + 10*y + 100*z`:
  - `axial z=1`: `planeSize` gives `[2,3]`. Row 0 is `y=2` and col 0 is `x=1`, so `slice[0] === 1+20+100`.
  - `coronal y=0`: `[2,4]`, `slice[0]` (x=1, z=3) `=== 301`.
  - `sagittal x=0`: `[3,4]`, `slice[0]` (y=2, z=3) `=== 320`.
  - `sliceCount` gives axial 4, coronal 3, sagittal 2.
  - `pixelAspect([0.8,0.8,2],"coronal")` deep-equals `[0.8,2]`.
  - `windowToGray`: with c=40, w=400, the HU values −160, 40 and 240 map to 0, 128±1 and 255.
  - `decodeMaybeGzip`: gzipped bytes (`zlib.gzipSync`) round-trip, and plain bytes come back unchanged (Review Focus 1).

- [ ] **Step 2: Run** `npm test`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement `site/js/volume.js`.** Keep it free of DOM access so it runs in Node.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Commit** `git add site/js/volume.js tests/volume.test.js && git commit -m "Add browser volume loading and reslicing"`

### Task 4: Overlay colouring and label layout

**Files:**
- Create: `site/js/overlay.js`, `site/js/labels.js`
- Test: `tests/overlay.test.js`, `tests/labels.test.js`

**Interfaces:**
- Consumes: the slices from `extractSlice` (Task 3), and `meta.structures` (Task 2).
- Produces (`overlay.js`):
  - `colorTable(structures: object[], systemsOn: Set<string>, hidden: Set<number>): Uint8Array`: 256×RGBA. The entry for id `i` is its own colour if its system is on and it isn't hidden. Otherwise it's the parent's colour if the parent's system is on and the parent isn't hidden. Otherwise it's alpha 0. Id 0 is always alpha 0.
  - `compositeOverlay(rgba: Uint8ClampedArray, labels: Uint8Array, table: Uint8Array, opacity: number, mode: "fill"|"outline", w: number, h: number): void`: blends in place. In `outline` mode, only pixels with a 4-neighbour of a different label are painted.
  - `visibleIds(table: Uint8Array): Set<number>`: the ids with alpha > 0.
- Produces (`labels.js`):
  - `anchors(labels: Uint8Array, w: number, h: number, ids: Set<number>): Map<number,{x:number,y:number,area:number}>`: the centroid of each id's pixels on the slice, snapped to the nearest pixel that has that id. It's a single pass for the sums, and the snap search only runs when the centroid pixel isn't that id.
  - `layoutLabels(anchorMap, w: number, h: number, lineHeight: number): Array<{id,side:"left"|"right",y:number,ax:number,ay:number}> | null`: the side is `"left"` when `ax < w/2` (image coordinates, never the text direction). Each side is sorted by `ay`. Overlaps are pushed down by `lineHeight`, then the whole column is shifted up if it overflows `h`. Returns `null` if any column needs more than `h / lineHeight` rows.

- [ ] **Step 1: Write the failing tests:**
  - `colorTable`: a segment (parent liver) with segments off and organs on gets liver's RGB. With both off, alpha is 0. A hidden id gets alpha 0, and id 0 always has alpha 0.
  - `compositeOverlay`: in outline mode on a 5×5 slice with a 3×3 block, the centre pixel is untouched and an edge pixel is changed.
  - `anchors`: an L-shaped region whose centroid falls outside it gets an anchor *on* a labelled pixel. A 1-pixel structure gets an anchor at that pixel with `area===1` (Review Focus 4). An id that's absent isn't in the map.
  - `layoutLabels`: 3 left anchors at the same `ay` produce y values spaced ≥ `lineHeight`. 16 anchors on one side with `h=100, lineHeight=10` give `null` (Review Focus 5). Every returned `y` is in `[0,h]`.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** both modules (DOM-free).
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add overlay colouring and label layout"` (with both modules and tests added)

### Task 5: URL state, languages, issue reporting

**Files:**
- Create: `site/js/state.js`, `site/js/i18n.js`, `site/js/report.js`
- Create: `site/i18n/index.json` → `[{"code":"en","name":"English"},{"code":"de","name":"Deutsch"},{"code":"es","name":"Español"},{"code":"ar","name":"العربية","dir":"rtl"},{"code":"fr","name":"Français"},{"code":"it","name":"Italiano"},{"code":"nl","name":"Nederlands"}]`
- Create: `site/i18n/{en,de,es,ar,fr,it,nl}.json`
- Test: `tests/state.test.js`, `tests/i18n.test.js`, `tests/report.test.js`

**Interfaces:**
- Produces (`state.js`):
  - `DEFAULTS = {case:null, lang:null, plane:"axial", slice:null, sys:["organs"], zoom:1}` (`null` means "decide from the data")
  - `parseHash(hash: string): object`: tolerant, and never throws.
  - `clampState(state, {cases:string[], langs:string[], dims:number[]|null}): object`: an unknown case becomes `cases[0]`. An unknown lang becomes `null`. A bad plane becomes `"axial"`. The slice is clamped to `[0, sliceCount-1]`, or the middle slice if it's null or NaN. Zoom is clamped to `[0.25, 8]`. Unknown systems are dropped.
  - `formatHash(state): string`: round-trips through `parseHash`.
- Produces (`i18n.js`):
  - `pickLang(available: string[], preferred: readonly string[]): string`: an exact match first, then the base subtag (`de-AT`→`de`), else `"en"`.
  - `loadStrings(lang: string): Promise<void>` (loads `en` too, as the fallback)
  - `t(key: string, vars?: object): string`: falls back to `en`, then to the key itself, with `{name}` interpolation.
  - `structName(structure, lang): string`: falls back to `names.en`.
  - `applyDir(lang: string): void`: sets `<html lang>` and `dir` from `index.json`.
- Produces (`report.js`):
  - `REPO_URL`: a constant, the owner's public GitHub repo URL. Read it from `git remote get-url origin`. If there's no remote yet, leave `""`; the UI then hides the report links.
  - `reportUrl(repo: string, {caseId, structureKey, structureName, lang, plane, slice, shareUrl}): string` gives `${repo}/issues/new?title=…&body=…&labels=label-report`. The title is `[<caseId>] <structureName> (<structureKey>)`, and the body lists every field on its own line.
- Strings: `en.json` holds every UI string, using flat keys such as `system.organs`, `plane.axial`, `ctl.fit`, `ctl.move`, `ctl.focus`, `ctl.all`, `ctl.none`, `ctl.structures`, `ctl.settings`, `win.soft`, `keylevels`, `report`, `footer.disclaimer`, `footer.credit`, `loading`, `error.load`. The other six files are drafts. A key may be missing from them, but they may not contain keys that `en.json` lacks.

- [ ] **Step 1: Write the failing tests:**
  - `state.test.js`: `clampState(parseHash("#case=zzz&plane=foo&slice=9999&zoom=-3&lang=xx&sys=organs,bogus"), {cases:["s1"],langs:["en"],dims:[10,10,10]})` deep-equals `{case:"s1",lang:null,plane:"axial",slice:9,sys:["organs"],zoom:0.25}` (Review Focus 3). `parseHash("%%%")` doesn't throw. `formatHash` → `parseHash` round-trips.
  - `i18n.test.js`: `pickLang(["en","de"],["de-AT","fr"]) === "de"` and `pickLang(["en"],["xx"]) === "en"`. Read every `site/i18n/*.json` with `fs`: each one parses, and none has a key that's absent from `en.json` (missing keys only `console.warn`). Every code in `index.json` has a file.
  - `report.test.js`: the URL starts with `https://github.com/o/r/issues/new?`, and after decoding, the body contains `slice: 120` and the share URL.

- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the three modules and the 7 string files. `i18n.js` touches `document` only inside `applyDir`/`loadStrings`, so the tests import it safely.
- [ ] **Step 4: Run** `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add URL state, translations and issue reporting"`

### Task 6: Viewer UI, docs, release check

**Files:**
- Create: `site/index.html`, `site/style.css`, `site/js/app.js`
- Create: `CONTRIBUTING.md`
- Modify: `README.md` (what it is, a screenshot, run locally, how to add a case, how to deploy to any static host, data credit, the code licence)

**Interfaces:**
- Consumes: everything from Tasks 3–5, and `site/cases/index.json` from Task 2.

**UI requirements** (from the spec; the layout and look are the builder's call. It's dark, uses a monospace UI font, has rounded bordered controls, and is inspired by the reference, not a copy of it):
- The header shows the case title and a language switcher. A case picker appears there only when `site/cases/index.json` lists more than one case.
- The system bar has icon buttons in the Global Constraints order, plus All/None. A horizontal scroll is fine on a phone.
- The plane buttons are Axial/Coronal/Sagittal. The zoom controls are − / % / + / Fit / Move. The window preset select has a live HU readout under the pointer. There's also a Focus toggle.
- The canvas area has a header line (`PLANE · w × h`) and orientation markers (S/I, R/L, A/P) placed by the display mapping, never by `dir`.
- The rendering is: `extractSlice` → `windowToGray` → `compositeOverlay` → `putImageData` onto an offscreen canvas, then `drawImage` scaled by `pixelAspect` × zoom, with pan, and `imageSmoothingEnabled=false` for the labels. Redraw on `requestAnimationFrame` only when the state changes.
- The label SVG layer comes from `anchors` + `layoutLabels`. When it's `null`, or labels are off in Settings, show only the tapped structure's name.
- Slice navigation is a slider, ‹ › buttons, the wheel, ↑/↓ keys, and vertical drag (or horizontal on the slider). When Move is on, drag pans instead.
- Tapping the image on a labelled pixel highlights the structure and shows a popup with its full name and a "Report a problem" link (hidden when `REPO_URL` is `""`).
- The Structures panel lists the structures grouped by system, each with a checkbox (`hidden` set), tap-to-jump to `best[plane]` and a report link.
- The key levels row has one button per `meta.keyLevels`. Each one switches to axial at that index.
- Settings holds the overlay opacity (default 0.45), labels on/off, and fill/outline.
- The footer carries the disclaimer and credit strings, plus a link to the repo.
- The state is written to the hash (`history.replaceState`, debounced) and read on load and on `hashchange`.
- While loading, show a progress bar (`loadCase` onProgress). On failure, show a `t("error.load")` message.

- [ ] **Step 1: Build `index.html`, `style.css` and `app.js`** to the requirements above. `app.js` holds only DOM wiring. Any logic worth testing belongs in Tasks 3–5's modules.
- [ ] **Step 2: Run** `npm test && pytest pipeline -q`. Expected: everything passes.
- [ ] **Step 3: Manual check.** Run `python3 -m http.server -d site 8000` and open `http://localhost:8000` in a desktop browser *and* at a 390×844 viewport. Confirm each of these:
  1. The first image appears and the progress bar goes away. The network shows ≤ 25 MB.
  2. On coronal, the liver is on the viewer's **left**, and the body isn't stretched.
  3. All systems on: the labels don't overlap. At 390 px wide they fit in the margins, or fall back to tap-only.
  4. A key-level button jumps to the right axial slice.
  5. Switch to العربية: the controls mirror, but the scan, the R/L markers and the label sides don't change.
  6. Copy the URL, open it in a new tab, and the same view comes back. `#slice=9999&plane=foo` opens a valid view.
  7. "Report a problem" opens a GitHub new-issue page, prefilled (if `REPO_URL` is set).
  8. The footer shows the disclaimer and the CC BY 4.0 credit.
- [ ] **Step 4: Write `CONTRIBUTING.md`.** Explain how to fix a name or translation (`pipeline/structures.json` → rerun `make_case`, or `site/i18n/*.json`), add a language (one file, plus an entry in `index.json`, plus a `names` column), drop or recolour a structure, move a key level, add a case, and run the tests. Update `README.md`.
- [ ] **Step 5: Commit** `git add site/ CONTRIBUTING.md README.md && git commit -m "Add viewer UI and contributor docs"`
