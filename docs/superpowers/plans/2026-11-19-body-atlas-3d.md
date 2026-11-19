# 3D Body Atlas (Z-Anatomy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scan-built 3D with the Z-Anatomy atlas, shown side by side with the CT slices,
linked by structure (shared selection, Show in CT / Show in 3D) and by a see-through plane marking the
current slice.

**Architecture:** An offline step runs headless Blender to export Z-Anatomy as one meshopt GLB per
atlas system plus `site/atlas/index.json` (structures, links to site keys). A second step fits a
per-axis linear CT→atlas transform per case from shared landmarks (`atlaslink.json`). In the browser,
DOM-free `atlasdata.js` decides visibility and maps keys/planes; `view3d.js` (kept) draws it; `app.js`
splits the viewer into slices + 3D panes.

**Tech Stack:** Python 3.12 (numpy, pytest), Blender (headless, `bpy`), gltfpack (`npx -y gltfpack`),
three.js 0.170.0 (`GLTFLoader`, `MeshoptDecoder`), Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-11-19-body-atlas-3d-design.md`

## Global Constraints

- Static site, no build step, no npm deps. three.js 0.170.0 from jsDelivr only, loaded with `import()`
  when 3D is first switched on; the 2D views never fetch three.js or `site/atlas/*`.
- First 3D view ≲3 s on broadband, default systems ≤6 MB total; other systems load when toggled.
- Atlas licence: CC BY-SA 4.0 (Z-Anatomy) from BodyParts3D (CC BY-SA 2.1 JP). Ship no non-commercial
  part: inner ear (CC BY-NC-SA), Lissie Cowley's kidney (CC BY-NC) — replace that kidney with the
  BodyParts3D kidney from Kevin Moerman's STL clone if needed.
- Radiological: default 3D view anterior, patient right on the viewer's left. Never mirror for RTL.
- RAS mm everywhere; volumes `[x,y,z]`, voxel i spans `[i, i+1) * spacing`.
- 7 languages (en, de, es, ar, fr, it, nl) for every new UI string. Atlas-only structure names: English
  + Latin; linked structures: the site's 7-language names.
- `site/js` modules other than `app.js` and `view3d.js` stay DOM-free.
- Commits carry no AI attribution.

## Review Focus

- Case whose landmarks don't cover an axis (head case: no femurs, few vertebrae) → plane hidden for that
  axis, never drawn at a wild position. Test in Task 3.
- Atlas structure linked to a site key the current case doesn't label → Show in CT opens the first case
  that does, at its best slice; no case does → button absent. Test in Task 4 (`caseFor`).
- Phone width (<700 px) → panes stacked, both usable, no horizontal scroll. Browser check in Task 6.
- Toggling a system off while its GLB is still downloading → it stays hidden when it arrives. Covered by
  visibility being recomputed from state on load (Task 5 step).
- Switching case with 3D on → plane uses the new case's fit, atlas not re-downloaded. Browser check in
  Task 7.

---

### Task 1: Export Z-Anatomy to per-system GLBs

**Files:**
- Create: `pipeline/atlaslib.py` (pure helpers), `pipeline/atlas_export.py` (runs inside Blender),
  `pipeline/make_atlas.py` (CLI), `pipeline/test_atlaslib.py`
- Output: `site/atlas/<system>.glb`, `site/atlas/index.json`, `site/atlas/LICENSE.txt`

**Interfaces:**
- Produces `atlaslib.blender_to_ras(p: (x,y,z), scale: float) -> (x,y,z)` = `(-x*s, -y*s, z*s)`
  (Z-Anatomy faces −Y in Blender; its right hand is at −X).
- Produces `atlaslib.slug(name: str) -> str` (lowercase, non-alnum → `_`, `.l`/`.r` suffix →
  `_left`/`_right`), the atlas key.
- Produces `site/atlas/index.json`:
  `{ "systems": [{key, names:{en..nl}, file, bytes}], "regionDefaults": {region: [systemKey]},
     "structures": [{key, system, en, la, color, anchor:[x,y,z], centroid:[x,y,z], box:[6], size}],
     "links": {} }` — `links` filled by Task 2. GLB node names == atlas keys.

- [ ] **Step 1:** Download `Z-Anatomy.zip` from `github.com/Z-Anatomy/Models-of-human-anatomy` into
  `data/zanatomy/` (own empty dir). Open it with `Blender -b <file> --python-expr` to list top-level
  collections, object counts, and the unit scale (measure a femur's length; expect ~450 mm). Record the
  collection → system mapping and scale in `atlas_export.py`'s header. Read Z-Anatomy's credits to find
  the inner-ear and Cowley-kidney object names; list them in `EXCLUDE`.
- [ ] **Step 2: Failing tests** in `pipeline/test_atlaslib.py`:
  ```python
  def test_blender_to_ras_flips_x_and_y_and_scales():
      assert blender_to_ras((1, 2, 3), 10) == (-10, -20, 30)
  def test_slug_sides():
      assert slug("Rib 5.l") == "rib_5_left" and slug("Liver") == "liver"
  ```
  Run `.venv/bin/pytest pipeline/test_atlaslib.py -q` → FAIL (import error).
- [ ] **Step 3:** Implement both in `atlaslib.py`; run → PASS.
- [ ] **Step 4:** `atlas_export.py`: for each system, select its MESH objects (skip `EXCLUDE`, text,
  curves), apply transforms, rename to `slug(name)`, export `data/zanatomy/out/<system>.glb`
  (`export_apply=True`, no materials needed), and dump per-object `{key, system, en, la, color,
  centroid, box, anchor, size}` (RAS mm via `blender_to_ras`; anchor = vertex nearest the centroid;
  size = surface area mm²; `la` from Z-Anatomy's `TA2.csv` by English name, else omitted).
- [ ] **Step 5:** `make_atlas.py export`: runs Blender, then `npx -y gltfpack -i in -o site/atlas/<s>.glb
  -cc -kn -si <ratio>` per system (ratio per system so skeleton+default organ systems ≤6 MB), writes
  `index.json` (with `regionDefaults` for head, neck, chest, abdomen-pelvis, lower-limb) and
  `LICENSE.txt` (CC BY-SA 4.0, credit Z-Anatomy and BodyParts3D, list exclusions).
- [ ] **Step 6: Verify:** in `index.json`, `liver.centroid[0] > spleen.centroid[0]` (same side as in
  the CT cases' labels); no key matches `EXCLUDE`; `du -ch` of default systems for each region ≤6 MB.
- [ ] **Step 7:** Commit `pipeline/atlas*.py pipeline/make_atlas.py pipeline/test_atlaslib.py site/atlas`.

### Task 2: Curated site ↔ atlas map

**Files:**
- Create: `pipeline/atlas_map.json`; Modify: `pipeline/atlaslib.py`, `pipeline/make_atlas.py`,
  `pipeline/test_atlaslib.py`

**Interfaces:**
- Produces `atlaslib.validate_map(m: dict[str, list[str]], site_keys: set, atlas_keys: set) -> None`,
  raises `ValueError` naming the first unknown key (either side).
- Produces `atlaslib.draft_map(site: list[dict], atlas: list[dict]) -> dict` (name/TA2/side matching).
- `make_atlas.py map` writes a draft to `data/zanatomy/atlas_map.draft.json`; `make_atlas.py link`
  validates `atlas_map.json` and copies it into `index.json["links"]`.

- [ ] **Step 1: Failing tests:**
  ```python
  def test_validate_map_rejects_unknown_atlas_key():
      with pytest.raises(ValueError, match="nope"):
          validate_map({"liver": ["nope"]}, {"liver"}, {"liver"})
  def test_validate_map_rejects_unknown_site_key():
      with pytest.raises(ValueError, match="kidney_x"):
          validate_map({"kidney_x": ["liver"]}, {"liver"}, {"liver"})
  def test_draft_map_matches_sides():
      site = [{"key": "kidney_left", "names": {"en": "Left kidney"}}]
      atlas = [{"key": "kidney_left", "en": "Kidney"}, {"key": "kidney_right", "en": "Kidney"}]
      assert draft_map(site, atlas) == {"kidney_left": ["kidney_left"]}
  ```
- [ ] **Step 2:** Implement; tests PASS.
- [ ] **Step 3:** Draft, then review by hand into `pipeline/atlas_map.json` for every key in
  `pipeline/structures.json` the atlas has (several-to-one is fine: liver segments → liver).
- [ ] **Step 4:** `make_atlas.py link` → `index.json.links` populated; commit.

### Task 3: Per-case plane fit (`atlaslink.json`)

**Files:** Modify `pipeline/atlaslib.py`, `pipeline/make_atlas.py`, `pipeline/test_atlaslib.py`;
Output `site/cases/<id>/atlaslink.json`

**Interfaces:**
- Produces `atlaslib.fit_axes(ct: np.ndarray[n,3], atlas: np.ndarray[n,3], min_spread_mm=30) ->
  {"x":[a,b]|None, "y":..., "z":...}` (least squares `atlas = a·ct + b` per axis; `None` when fewer than
  2 landmarks or CT centroids spread < `min_spread_mm` on that axis, or `a <= 0`).
- Produces `atlaslib.case_centroids(labels[x,y,z], spacing, ids) -> {id: (x,y,z) mm}` (voxel centre
  `(i+0.5)*spacing`).
- `make_atlas.py fit site/cases/<id> ...` writes `{x,y,z, landmarks:[siteKey...]}`. Landmarks: case
  structures linked in `index.json.links`, bones first; atlas point = mean of linked atlas centroids.

- [ ] **Step 1: Failing tests:**
  ```python
  def test_fit_recovers_scale_and_offset():
      ct = np.array([[0,0,0],[100,50,200],[40,90,10]], float)
      f = fit_axes(ct, ct * 1.1 + [5, -3, 20])
      assert np.allclose(f["x"], [1.1, 5]) and np.allclose(f["z"], [1.1, 20])
  def test_fit_skips_axis_without_spread():
      ct = np.array([[0,0,0],[100,0,200]], float)
      assert fit_axes(ct, ct)["y"] is None
  def test_fit_needs_two_landmarks():
      assert fit_axes(np.zeros((1,3)), np.zeros((1,3))) == {"x": None, "y": None, "z": None}
  def test_case_centroids_voxel_centres():
      lab = np.zeros((4,4,4), np.uint8); lab[1,2,3] = 7
      assert case_centroids(lab, (2,2,2), [7]) == {7: (3.0, 5.0, 7.0)}
  ```
- [ ] **Step 2:** Implement; PASS.
- [ ] **Step 3:** Run for all five cases. Check: L1 (or nearest vertebra) centroid in each case maps
  within 20 mm of atlas L1 on z; head case has `z` (skull/C-spine) or `null` — never a negative scale.
- [ ] **Step 4:** Commit.

### Task 4: `atlasdata.js` (DOM-free)

**Files:** Create `site/js/atlasdata.js`, `tests/atlasdata.test.js`

**Interfaces:**
- `tissueOf(system) -> "bone"|"cartilage"|"muscle"|"vessel"|"nerve"|"organ"`
  (skeleton→bone, joints→cartilage, muscles→muscle, cardiovascular→vessel, nervous→nerve, else organ).
- `atlasVisibility(structures, systemsOn:Set, hidden:Set, faded:Set, isolated:string|null)
  -> Map<key, {color, tissue, opacity}>`; faded opacity 0.15; isolated keeps only that key.
- `siteToAtlas(links, siteKey) -> string[]`; `atlasToSite(links, atlasKey) -> string|null`
  (first site key in file order whose list contains it; the map lists parents before children).
- `caseFor(siteKey, current:{id, structures}, cases:[{id, keys:Set}]) -> caseId|null` (current first).
- `sliceMm(plane, slice, spacing) -> number` = `(slice+0.5)*spacing[axis]`, axis axial→2, coronal→1,
  sagittal→0.
- `ctToAtlas(fit, plane, mm) -> {axis:"x"|"y"|"z", value}|null` (null when that axis' fit is null).

- [ ] **Step 1: Failing tests** (`npm test`): isolated/hidden/faded as in the old meshdata tests but
  with string keys; `tissueOf("nervous") === "nerve"`; `siteToAtlas` unknown → `[]`;
  `atlasToSite(links,"liver") === "liver"` with `{liver:["liver"], liver_segment_1:["liver"]}`;
  `caseFor` returns current id when it has the key, else first case with it, else null;
  `sliceMm("axial", 10, [1,1,2]) === 21`; `ctToAtlas({x:null,y:null,z:[2,5]}, "axial", 10)` →
  `{axis:"z", value:25}`, `ctToAtlas({x:null,...}, "sagittal", 3) === null`.
- [ ] **Step 2:** Implement; PASS. Commit.

### Task 5: `view3d.js` loads the atlas and draws the plane

**Files:** Modify `site/js/view3d.js`, `site/ct.html` (import map unchanged; `three/addons/` covers
`loaders/GLTFLoader.js` and `libs/meshopt_decoder.module.js`)

**Interfaces:**
- Replace `setCase` with `addSystem(key, url, structuresByKey) -> Promise<void>` (loads GLB with
  `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)`, one `Mesh` per node keyed by node name, `userData`
  anchor/size from index, hidden until `setVisibility`), and `bounds(box:[6])` used by `reset()` when
  nothing is visible.
- `setVisibility(Map key→{color,tissue,opacity})`, `select(keys: string[])`, `pick(x,y) -> key|null`,
  `centerOn(key)`, `project(key)` keep their meaning with string keys. Add `TISSUES.nerve`
  (`roughness 0.45, clearcoat 0.4, sheen 0.3`).
- Add `setPlane(p: {axis, value}|null)`: a `PlaneGeometry` quad spanning the visible bodies' box on the
  other two axes (+10 mm), `MeshBasicMaterial` cyan `#4fd1e8`, opacity 0.18, `depthWrite:false`,
  `DoubleSide`, with a `LineLoop` outline; not pickable.

- [ ] **Step 1:** Implement. After each GLB arrives the caller re-applies `setVisibility` from current
  state (so a system toggled off during download stays hidden).
- [ ] **Step 2: Browser check** with a throwaway page in the scratchpad (not committed): load skeleton
  + digestive, screenshot anterior view — liver on the viewer's left; `setPlane({axis:"z",value:L1z})`
  crosses the spine at L1.
- [ ] **Step 3:** Commit `view3d.js`.

### Task 6: Side-by-side layout and the 3D toggle; remove scan 3D

**Files:** Modify `site/ct.html`, `site/style.css`, `site/js/app.js`, `site/js/state.js`,
`tests/state.test.js`, `site/i18n/*.json`, `CLAUDE.md`. Delete `pipeline/meshlib.py`,
`pipeline/make_meshes.py`, `pipeline/test_meshlib.py`, `site/cases/*/mesh.bin.gz`,
`site/cases/*/meshes.json`, `site/js/meshdata.js`, `tests/meshdata.test.js`; drop scikit-image and
fast-simplification from `pipeline/requirements.txt` if nothing else imports them.

**Interfaces:**
- URL: `3d=1` in the hash. `parseHash` returns `is3d: boolean`; `formatHash` writes `3d=1` only when on.
- DOM: `.panes` wraps `#viewer` and new `#viewer3d` (contains `#atlas-bar`, `#labels3d` svg,
  `#popup3d`); `.panes.split` = two columns; below 700 px, stacked (slices on top), each pane ≥45vh.
- `#plane-group` drops the 3D option; new `#toggle-3d` button (`aria-pressed`) next to it.
- i18n: `ctl.3d` ("3D"), `hint.3d` (kept), `atlas.sys.<key>` names for each atlas system.

- [ ] **Step 1: Failing test** in `tests/state.test.js`: `parseHash("#3d=1").is3d === true`,
  `parseHash("").is3d === false`, `formatHash({...DEFAULTS, is3d:true})` contains `3d=1`,
  `formatHash(DEFAULTS)` does not contain `3d`.
- [ ] **Step 2:** Implement in `state.js`; PASS.
- [ ] **Step 3:** `app.js`: the 2D view always renders in `#viewer`; `#toggle-3d` splits and calls
  `open3d()`, which on first use imports `view3d.js` and `atlas/index.json`, then loads the region's
  default systems in parallel. `#atlas-bar` buttons toggle atlas systems (lazy `addSystem`). Remove all
  `ui.is3d` branches that hid 2D controls; 3D Fit lives in the 3D pane. Delete the scan-3D code paths
  (`caseMeshes`, `meshCache`, `meshVisibility` use) and the files listed above.
- [ ] **Step 4: Browser check** at 1280×800 and 390×844: both panes visible, no horizontal scroll;
  network log of a 2D-only session has no `three` or `atlas/` request; with `#3d=1` the region's
  defaults load within budget.
- [ ] **Step 5:** `npm test` and `.venv/bin/pytest pipeline -q` pass; update CLAUDE.md (commands:
  `make_atlas.py export|map|link|fit`; layout; remove make_meshes); commit.

### Task 7: Links A and B

**Files:** Modify `site/js/app.js`, `site/i18n/*.json`

**Interfaces (from earlier tasks):** `atlasVisibility`, `siteToAtlas`, `atlasToSite`, `caseFor`,
`sliceMm`, `ctToAtlas` (Task 4); `view.select/centerOn/project/setPlane` (Task 5);
`cases/<id>/atlaslink.json` (Task 3, fetched with the case only when 3D is on).
- i18n: `ctl.showct`, `ctl.show3d`, `ctl.hide`, `ctl.fade`, `ctl.unfade`, `ctl.isolate`, `ctl.showall`.

- [ ] **Step 1: Shared selection.** Selecting in 2D → `view.select(siteToAtlas(links, key))`. Picking in
  3D → `ui.atlasSel = key`; if `atlasToSite` gives a key the current case labels, `ui.selected` = its id.
- [ ] **Step 2: 3D popup** (`#popup3d`): name (site 7-language name if linked, else `en` + `la` in
  italics), Hide, Fade/Unfade, Isolate, Show in CT (only if `caseFor` ≠ null: opens that case if
  needed, sets the current plane's slice to `structure.best[plane]`, selects it). "Show all" button in
  `#atlas-bar` when anything is hidden/faded/isolated.
- [ ] **Step 3: 2D popup:** adds Show in 3D when linked and 3D is on → `view.centerOn` first atlas key
  and select.
- [ ] **Step 4: Plane.** On every `update()` with 3D on: `view.setPlane(ctToAtlas(fit, st.plane,
  sliceMm(st.plane, st.slice, meta.spacing)))`; `null` when the case has no fit for that axis.
- [ ] **Step 5: Pinned labels** in `#labels3d`: the up-to-12 largest visible structures whose
  `project()` is visible, laid out with `layoutLabels` from `labels.js`, plus the selected one.
- [ ] **Step 6: Browser check**, every case: Show in CT lands on a slice where the structure's label is
  present in `labSlice`; Show in 3D selects it; dragging the slider moves the plane; axial slice at L1
  ↔ plane at atlas L1 (±20 mm); switching case with 3D on re-fits the plane without refetching GLBs.
- [ ] **Step 7:** Commit.

### Task 8: Credits and finish

**Files:** Modify `site/ct.html` (footer `#atlas-credit` link to Z-Anatomy, shown only when 3D has been
opened), `site/i18n/*.json` (`footer.atlas`: "3D atlas: Z-Anatomy, from BodyParts3D (DBCLS) — CC BY-SA
4.0"), `CLAUDE.md` (data credit line).

- [ ] **Step 1:** Implement; `npm test` passes (translations test checks the 7 languages).
- [ ] **Step 2:** Full browser pass: speed (first 3D view ≲3 s, ≤6 MB, measured from network log),
  orientation, both widths. Commit.
