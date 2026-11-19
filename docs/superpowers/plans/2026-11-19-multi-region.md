# Multi-Region Atlas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the CT atlas region-agnostic, with systems, windows and grouping declared per case, and add head, neck and chest cases built from open TotalSegmentator tasks plus the seven licensed tasks the author allowed us to publish.

**Architecture:** System definitions move from viewer constants into data. `pipeline/systems.json` is the catalogue. Each `pipeline/cases/<id>.json` picks the systems, default systems, windows, tasks and overrides it uses, and `make_case.py` resolves all of that into `meta.json`. The viewer reads systems and windows from `meta.json`, and a region switcher in `ct.html` changes cases.

**Tech Stack:** As before: Python 3.12 `.venv` (nibabel, numpy, scipy, TotalSegmentator, remotezip, pytest), and plain ES modules tested with `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-multi-region-design.md` (extends `docs/superpowers/specs/2026-11-18-ct-anatomy-viewer-design.md`)

## Global Constraints

- `ALLOWED_TASKS` in `pipeline/caselib.py` is exactly the open tasks `total, liver_segments, ventricle_parts, head_glands_cavities, headneck_bones_vessels, headneck_muscles, head_muscles, oculomotor_muscles, lung_vessels, trunk_cavities, body, abdominal_muscles, breasts` plus the licensed tasks `brain_structures, heartchambers_highres, coronary_arteries, aortic_sinuses, appendicular_bones, vertebrae_pp_refined, tissue_types`. Check the open part against the README before Task 4.
- **The license key never enters the repo**, logs, commits or `meta.json`. It lives only in the owner's TotalSegmentator config.
- Each case is ≤ 25 MB. Coordinates follow RAS+ / `[z][y][x]`, as in `CLAUDE.md`.
- Old links keep working: the abdomen case (`s0010`) keeps its system keys `organs, segments, digestive, urinary, pelvis, spine, arteries, veins`, and `#case=s0010&sys=organs,…` opens the same view.
- Region order in the switcher and `index.json`: `head, neck, chest, abdomen-pelvis`.
- New window presets (center/width): `brain` 40/80, `mediastinum` 50/350. The existing ones keep their values.
- Languages `en, de, es, ar, fr, it, nl`. System names live in data (`systems.json` → `meta.json`), not in `site/i18n`.
- There's no chest-muscles system.
- If a region has no usable dataset scan, ship the others and tell the owner. Don't use another dataset.
- Commits carry no AI attribution.

## Review Focus

1. **Old abdomen links** (`#case=s0010&plane=coronal&sys=organs,segments`) must open with the same systems on. Test: Task 2 `clampState` with the s0010 system list.
2. **A link with a system the case lacks** (`#case=<head>&sys=organs,brain`) keeps only the systems the case has, and doesn't crash. Test: Task 2.
3. **A link that switches case**, opened from another case (`hashchange` to `case=B&plane=coronal&slice=40&sys=x`), must apply B's plane, slice and systems, not keep A's. Covered by the Task 3 `openCase(id, wanted)` contract and the manual check.
4. **A structure that two tasks produce** (`skull`, `optic_nerve_*`, `trapezius`) is painted once, from its named source. Test: Task 1 (`source` is per catalogue entry, and the build reads only that task's folder).
5. **A task outside the allow-list** (for example `face`) named in a case file fails the build with a clear message. Test: Task 1 `check_tasks`.

---

### Task 1: Data-driven systems in the pipeline

**Files:**
- Create: `pipeline/systems.json`
- Modify: `pipeline/caselib.py`, `pipeline/make_case.py`, `pipeline/cases/s0010.json`, `pipeline/structures.json` (`source` stays a task name; unchanged for existing entries)
- Regenerate: `site/cases/s0010/meta.json`, `site/cases/index.json`
- Test: `pipeline/test_caselib.py`, `pipeline/test_make_case.py`

**Interfaces:**
- Produces (`caselib.py`):
  - `ALLOWED_TASKS: frozenset[str]` (see Global Constraints)
  - `check_tasks(tasks: list[str]) -> None`: raises `ValueError("TotalSegmentator task not allowed: <name>")` for anything not in `ALLOWED_TASKS`.
  - `select_structures(catalogue: list[dict], case: dict) -> list[dict]`: returns the catalogue entries whose `source` is in `case["tasks"]` and whose resolved system (`case.get("systemOverrides", {}).get(key, entry["system"])`) is in `case["systems"]`, with `system` replaced by the resolved value. Catalogue order is kept.
- Produces: the case file schema `pipeline/cases/<id>.json`, as `{"region","title":{lang},"tasks":[...],"systems":[...],"defaultSystems":[...],"windows":[...],"systemOverrides":{key:system}?,"keyLevels":[...]}`.
- Produces: `pipeline/systems.json`, as `{"systems":[{"key","icon","color","names":{7 langs}}]}`.
- Produces: `meta.json` `source` gains `"tasks"` (the task names used), and `meta.json` gains `"region"`, `"systems":[{key,icon,color,names}]` (in case order, only systems with ≥ 1 kept structure), `"defaultSystems"` (filtered to those present) and `"windows"`.
- Produces: `index.json` entries become `{"id","region","title"}`, sorted by the region order.
- `make_case.py`: removes `--no-liver-segments`. The tasks come from the case file. `total` is read from `<src>/segmentations/`. Every other task runs `TotalSegmentator -ta <task> -d <device>` into `data/tmp/<case_id>_<task>/` (skipped if that folder already has `.nii.gz` files). The test passes a case file through `--case-file` (default `pipeline/cases/<case_id>.json`).

- [ ] **Step 1: Write the failing tests.**
  - `test_check_tasks_rejects_licensed`: `check_tasks(["total","face"])` raises `ValueError` mentioning `face` (licensed but not allowed), and `check_tasks(["total","ventricle_parts","brain_structures"])` passes.
  - `test_select_structures_overrides_and_filters`: a catalogue of `hyoid`(system `skull`, source `headneck_bones_vessels`), `liver`(organs, total) and `brain`(brain, total). The case has `tasks=["total","headneck_bones_vessels"]`, `systems=["larynx","brain"]` and `systemOverrides={"hyoid":"larynx"}`. The result is `[hyoid(system larynx), brain]`.
  - Update `test_make_case_end_to_end`. It writes a case file `{"region":"abdomen-pelvis","title":{"en":"T"},"tasks":["total"],"systems":["organs","arteries"],"defaultSystems":["organs","veins"],"windows":["soft","bone"],"keyLevels":[]}` and runs `main([src,"t1","--case-file",path,"--out",site])` twice. It asserts that `[s["key"] for s in meta["systems"]] == ["organs","arteries"]`, `meta["defaultSystems"] == ["organs"]` (veins dropped), `meta["windows"] == ["soft","bone"]`, each `meta["systems"][i]["names"]["en"]` is non-empty, and the index entry has `region == "abdomen-pelvis"`.
- [ ] **Step 2: Run** `.venv/bin/pytest pipeline -q`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Write `systems.json` with the eight abdomen systems: keys unchanged, icons named after the keys, the colours from today's `SYSTEM_COLOR` in `site/js/app.js`, and the names copied from the `system.*` keys in `site/i18n/*.json`. Add `region/tasks/systems/defaultSystems/windows` to `pipeline/cases/s0010.json` (`abdomen-pelvis`, `["total","liver_segments"]`, the 8 systems, `["organs"]`, `["soft","liver","bone","lung"]`). Then do the `caselib` and `make_case` changes.
- [ ] **Step 4: Run** `.venv/bin/pytest pipeline -q`. Expected: everything passes.
- [ ] **Step 5: Rebuild the abdomen case** with `.venv/bin/python pipeline/make_case.py data/ts/Totalsegmentator_dataset_v300/s0010 s0010 --device mps` (the cached liver segments are reused). Expected: 43 structures. `git diff --stat site/cases/s0010` shows only `meta.json` changed (the volumes are byte-identical).
- [ ] **Step 6: Commit** `git add pipeline site/cases && git commit -m "Move systems, windows and grouping into per-case data"`

### Task 2: Case-driven state and window catalogue

**Files:**
- Modify: `site/js/state.js`, `site/js/volume.js`
- Test: `tests/state.test.js`, `tests/volume.test.js`

**Interfaces:**
- Produces (`state.js`):
  - Remove `SYSTEMS`. `DEFAULTS.sys` becomes `null`, so `parseHash` returns `sys: null` when the hash has no `sys`.
  - `clampState(s, {cases, langs, dims, systems, defaultSystems})`: `sys` is `defaultSystems` when `s.sys` is null. Otherwise it's `systems.filter(k => s.sys.includes(k))`, in case order. When `systems` is null (no case loaded yet), `sys` passes through unchanged.
- Produces (`volume.js`): `WINDOWS` adds `brain:{c:40,w:80}` and `mediastinum:{c:50,w:350}`.

- [ ] **Step 1: Update the tests.** Remove the `SYSTEMS` launch-order test. Add these:
  - `old abdomen link keeps its systems`: `clampState(parseHash("#case=s0010&sys=organs,segments"), {cases:["s0010"], langs:["en"], dims:[10,10,10], systems:ABDO, defaultSystems:["organs"]}).sys` deep-equals `["organs","segments"]` (`ABDO` = the 8 abdomen keys).
  - `unknown systems are dropped per case`: with `systems:["brain","ventricles"]`, `sys=organs,brain` gives `["brain"]`.
  - `missing sys uses the case default`: `parseHash("#case=s1").sys === null`, and the clamped result is `defaultSystems`.
  - The existing "bad share link" test now passes `systems:ABDO, defaultSystems:["organs"]`. Its expected result is unchanged.
  - `volume.test.js`: `WINDOWS.brain` deep-equals `{c:40,w:80}`, and `WINDOWS.mediastinum` deep-equals `{c:50,w:350}`.
- [ ] **Step 2: Run** `npm test`. Expected: the new assertions FAIL.
- [ ] **Step 3: Implement** the signatures above.
- [ ] **Step 4: Run** `npm test`. Expected: PASS (the ECG tests stay green).
- [ ] **Step 5: Commit** `git commit -am "Read systems and defaults from the case in URL state"`

### Task 3: Viewer reads systems and windows from the case, plus the region switcher

**Files:**
- Modify: `site/js/app.js`, `site/ct.html`, `site/style.css`, `site/i18n/{en,de,es,ar,fr,it,nl}.json`

**Interfaces:**
- Consumes: `meta.systems`, `meta.defaultSystems`, `meta.windows` and `index.json` `region` (Task 1). `clampState` context and `WINDOWS` (Task 2).
- Produces (`app.js`):
  - `openCase(id: string, wanted: {plane?, slice?, sys?} | null)`: after loading, the state is `clampState({...st, case:id, ...(wanted ?? {plane:"axial", slice:null, sys:null})}, ctx)`, where `ctx` includes the case's `systems` and `defaultSystems`. The region switcher calls `openCase(id, null)`. `onHashChange` and boot call it with the parsed hash.
  - System buttons are built from `meta.systems` (`--c` = `color`, label = `localized(names, lang)`, icon = `ICONS[icon]`). Add icon symbols for the systems Tasks 4–6 introduce, and fall back to a plain circle for an unknown icon.
  - The window select lists `meta.windows`.
  - The region switcher: `#region-bar` in `ct.html` replaces `#case-select`, with one button per `index.json` entry, labelled `t("region.<region>")` and marked `aria-pressed` for the current case. It's hidden when there's 1 case.
- Strings: remove the `system.*` keys from all 7 files. Add `region.head`, `region.neck`, `region.chest`, `region.abdomen-pelvis`, `win.brain`, `win.mediastinum` and `region.label` (the switcher's aria label) in all 7 languages. Update `home.ct` so it no longer says "abdominal" (for example "Scroll real CT scans of the head, neck, chest and abdomen in three planes…").

- [ ] **Step 1: Implement** the above, then run `npm test`. Expected: PASS. `i18n.test.js` still checks that no language has keys missing from `en.json`.
- [ ] **Step 2: Manual check** with `python3 -m http.server -d site 8000`, then open `ct.html`:
  1. `#case=s0010&plane=coronal&sys=organs,segments` looks the same as before: 8 system buttons, the same colours, and the liver on the viewer's left.
  2. The switcher is hidden while there's only one case. Temporarily add a second `index.json` entry that points at `s0010` under `region: "chest"` and check that the switcher shows, the pressed state follows the case, and `hashchange` to the other case applies the link's plane and slice (Review Focus 3). Revert the temporary entry.
  3. Arabic: system labels come from the data, and the scan doesn't mirror.
- [ ] **Step 3: Commit** `git commit -am "Build system buttons, windows and region switcher from case data"`

### Task 4: Head case

**Files:**
- Modify: `pipeline/systems.json`, `pipeline/structures.json` (new entries, names in 7 languages)
- Create: `pipeline/cases/<head_id>.json`, `site/cases/<head_id>/*`
- Modify: `site/cases/index.json` (generated), `site/js/app.js` (icons only, if new)

- [ ] **Step 1: Pick the scan.** From `data/ts/Totalsegmentator_dataset_v300/meta.csv`, take `study_type == "ct head"` cases with `pathology` empty or `no_pathology`, an adult age, and a soft kernel. Fetch 2–3 candidates' `ct.nii.gz` + `segmentations/brain.nii.gz` + `skull.nii.gz` with remotezip (see `CONTRIBUTING.md`). Keep one whose brain mask is non-empty and whose scan covers the vertex to the skull base, with the orbits in view. If none qualifies, skip this task and note it in the ledger.
- [ ] **Step 2: Add the systems** to `systems.json`: `lobes` (frontal, parietal, temporal and occipital lobes, insular cortex, central sulcus), `deep-nuclei` (thalamus, caudate, lentiform, internal capsule), `posterior-fossa` (cerebellum, brainstem), `meninges-sinuses` (venous sinuses, subarachnoid space, septum pellucidum) — all from `brain_structures` — plus `brain`, `ventricles`, `orbit`, `glands-airway`, `vessels`, `skull-face`, `mastication`. Add their catalogue entries to `structures.json`:
  - `brain`, `skull` (source `total`)
  - all `ventricle_parts` classes
  - from `head_glands_cavities`: eyes, lenses, optic nerves, parotid and submandibular glands, nasal cavities, pharynx parts, auditory canals, hard and soft palate
  - from `oculomotor_muscles`: the eye muscles only (`optic_nerve_*`/`skull`/`eyeball_*` stay sourced from the tasks above)
  - from `headneck_bones_vessels`: internal carotids, internal jugulars, zygomatic arches, styloid processes, hyoid
  - from `head_muscles`: masseter, temporalis, the pterygoids
  
  Check each class name against the README's task line. Draft the names in 7 languages from Terminologia Anatomica.
- [ ] **Step 3: Write the case file** (`region: "head"`). Tasks: `total, brain_structures, ventricle_parts, head_glands_cavities, oculomotor_muscles, headneck_bones_vessels, head_muscles`. Systems in the order above, with `brain` (whole) after the lobe systems. `defaultSystems: ["lobes","ventricles"]`. Use `ventricle_parts` for the ventricles and leave `brain_structures`' single `ventricle` class out. `windows: ["brain","bone","soft"]`. `systemOverrides: {"hyoid":"skull-face"}`. Key levels: vertex/centrum semiovale, lateral ventricles (body), third ventricle / basal ganglia, orbits / optic nerves, skull base / foramen magnum. Pick them from axial crops as was done for the abdomen.
- [ ] **Step 4: Build** with `.venv/bin/python pipeline/make_case.py data/ts/Totalsegmentator_dataset_v300/<head_id> <head_id> --device mps`. Expected: no AssertionError, ≤ 25 MB. Then run the sanity pass: open it in the viewer, and remove from the catalogue (or from the case's systems) any structure whose mask is obviously broken. Rebuild, and run `.venv/bin/pytest pipeline -q && npm test`.
- [ ] **Step 5: Commit** `git add pipeline site && git commit -m "Add head CT case from open models"`

### Task 5: Neck case

Same steps as Task 4, with these values:
- Scan: `study_type` in `ct neck` / `ct chest-neck`, ideally with contrast, covering the skull base to the aortic arch.
- New systems: `larynx` (larynx air, thyroid and cricoid cartilage, hyoid, trachea), `pharynx-esophagus`, `thyroid` (`thyroid_gland`), `neck-muscles` (`headneck_muscles` classes). Reuse `glands-airway` (salivary glands), `vessels` (carotids, jugulars, subclavians, brachiocephalic trunk and veins) and `spine` (C1–C7, plus T1 as a landmark).
- Tasks: `total, headneck_bones_vessels, headneck_muscles, head_glands_cavities`. `systemOverrides: {"hyoid":"larynx"}`. `defaultSystems: ["larynx","vessels"]`. `windows: ["soft","bone"]`.
- Key levels: C2 / oropharynx, hyoid, thyroid cartilage, cricoid, thyroid gland.
- Commit: `"Add neck CT case from open models"`

### Task 6: Chest case, docs and final check

Same steps as Task 4, with these values:
- Scan: `study_type` in `ct chest-abdomen-pelvis` / `ct chest` / `ct thorax`, contrast-enhanced, adult, no pathology. Use `--z-range` to keep it to the lung apices through the diaphragm.
- New systems: `heart` (chambers and myocardium from `heartchambers_highres`; coronaries from `coronary_arteries` and cusps from `aortic_sinuses` only if they pass the sanity pass), `lungs` (5 lobes), `airway` (trachea, plus `lung_vessels` airways if the masks pass the sanity pass), `heart-vessels` (heart, aorta, SVC, pulmonary veins, brachiocephalic trunk and veins, subclavian and common carotid arteries, atrial appendage), `chest-wall` (ribs, sternum, costal cartilages, clavicles, scapulae). Reuse `digestive` (oesophagus) and `spine` (T1–T12).
- Tasks: `total, heartchambers_highres` (plus `coronary_arteries`, `aortic_sinuses` and `lung_vessels` if used). The whole `heart` from `total` is left out in favour of the chambers. `defaultSystems: ["lungs","heart","heart-vessels"]`. `windows: ["lung","mediastinum","bone"]`.
- Key levels: thoracic inlet, aortic arch, carina, pulmonary trunk, cardiac four-chamber level.
- Then update `README.md` (regions list, credits per task, the author's 2026-11-19 permission to publish licensed-task outputs, and which cases need a license key to rebuild) and `CONTRIBUTING.md` (case file fields, `systems.json`, the open-task allow-list). Run the manual check from Task 3 Step 2 for every region, including Arabic and a 390 px viewport.
- Commit: `"Add chest CT case and document multi-region cases"`
