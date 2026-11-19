# Multi-region atlas — Design

## Intent

The atlas grows from one abdominal case toward the whole body. People pick a body region (head,
neck, chest, abdomen & pelvis, and later others) and get a real CT of that region, with structures
grouped into systems that make sense for that region. Audience and purpose are unchanged: students,
doctors and the owner, learning and checking cross-sectional anatomy, for free.

Builds on `2026-11-18-ct-anatomy-viewer-design.md`. Everything there still applies unless changed
here.

## Decided by the owner

- Cover the whole body, as **one case per region** (separate scans), not one whole-body scan.
- Use **only TotalSegmentator models that are free to use without a license** (Apache-2.0 "open"
  tasks), for now. The licensed tasks (`brain_structures`, `heartchambers_highres`,
  `coronary_arteries`, `appendicular_bones`, `tissue_types`, `vertebrae_*`, `face`, …) are out
  until the owner gets explicit permission from the model author. An email asking for it has
  been drafted.
- Everything stays non-commercial and free.
- **Picking a region happens inside the CT viewer**: the home page's CT tile opens the viewer, and
  a region switcher there changes cases. There are no per-region tiles on the home page.
- **Sequencing:** the in-progress landing page and ECG work (`site/index.html` → `site/ct.html`,
  `home.js`, i18n and CSS edits) is committed first. Multi-region builds on top of it in its own
  branch.

## Goals

1. **Region-agnostic viewer.** Nothing in the code is tied to the abdomen. Each case declares its
   own systems (names in 7 languages, icon, colour, order) and its own window presets. The
   abdomen case keeps working and looks the same as today.
2. **Three new regions**, built from open tasks only:
   - **Head:** brain (whole), ventricles in detail (`ventricle_parts`), orbit (eyes, lenses,
     optic nerves, eye muscles from `oculomotor_muscles`), glands & airway
     (`head_glands_cavities`), vessels (internal carotids, internal jugulars from
     `headneck_bones_vessels`), skull & face bones (skull, zygomatic arches, styloid processes,
     hyoid), and muscles of mastication (`head_muscles`).
   - **Neck:** airway & larynx (larynx air, thyroid/cricoid cartilage, hyoid, trachea),
     pharynx & oesophagus, thyroid gland, salivary glands, vessels (carotids, jugulars,
     subclavians, brachiocephalic trunk/veins), cervical spine C1–C7, and neck muscles
     (`headneck_muscles`).
   - **Chest:** lungs by lobe, airway (trachea, plus open `lung_vessels` airways if usable),
     heart, great vessels (aorta, SVC, pulmonary veins, brachiocephalic trunk/veins,
     subclavian and carotid arteries), oesophagus, chest wall (ribs, sternum, costal cartilages,
     clavicles, scapulae) and thoracic spine. There's no chest-muscles system:
     `abdominal_muscles` only covers about T4–L4, so pectoralis and trapezius would be cut off
     partway.
3. **A region switcher** inside the CT viewer that's easy to find, at the top, in place of the
   hidden case dropdown.
4. **Key levels per region**, curated by the builder like the abdomen's, for example
   foramen magnum / orbit level for the head, hyoid / thyroid cartilage / cricoid for the neck,
   and aortic arch / carina / pulmonary trunk for the chest.
5. **Window presets per region**: brain (40/80) and bone for the head; soft tissue and bone for
   the neck; lung, mediastinum (50/350) and bone for the chest; the abdomen keeps its four.

## Non-goals

- Licensed tasks (above). The pipeline refuses them, so nothing licensed ships by accident.
- Limbs. The open models only segment the femur, humerus, hip, scapula and a few muscles; the
  full limb bones (`appendicular_bones`) are licensed. Add limbs when that changes.
- A whole-body continuous scan or overview case (could be added later as just another case).
- MRI.

## Anti-goals

- **Breaking the abdomen case** or existing share links. Old links
  (`#case=s0010&sys=organs,…`) must keep opening the same view.
- **A case over 25 MB.** The budget per case stays.
- **Showing obviously broken masks.** The same rule applies as before: the builder does a sanity
  pass per region and drops structures whose masks are clearly wrong. Then the community
  reviews.

## Approaches considered

1. **One case per region (chosen).** Best detail (1.5 mm) and each case stays within budget, at
   the cost of switching cases between regions.
2. One whole-body scan. Continuous scrolling, but about 60 MB at full detail. It would need
   about 2.5 mm downsampling, which blurs small structures, and few scans include the head.
3. Both. Deferred: an overview case can be added later as one more case.

## Design

### Data model

- `pipeline/systems.json` (new): the catalogue of systems:
  `{key, icon, color, names: {en,de,es,ar,fr,it,nl}}`. It includes the current eight plus the
  new ones (brain, ventricles, orbit, glands & airway, vessels, skull & face, mastication muscles,
  larynx, thyroid, lungs, heart & great vessels, chest wall, chest muscles, …; the builder
  finalises the list). `icon` names a symbol drawn by the viewer.
- `pipeline/structures.json` keeps one catalogue for all regions. `source` becomes the
  TotalSegmentator task name (`total`, `liver_segments`, `ventricle_parts`,
  `head_glands_cavities`, …). When several tasks produce the same class (for example `skull`,
  `optic_nerve_*` or `trapezius`), the catalogue names exactly one source. Each structure has a
  default `system`. A structure can belong to many regions; the case decides what gets in.
- **Per-case system overrides:** `pipeline/cases/<id>.json` may map `structure key → system`
  to regroup a structure for that region (for example `hyoid` under skull & face in the head and
  under larynx in the neck). `meta.json` carries the resolved system per structure, so the
  viewer never needs to know about overrides.
- `pipeline/cases/<id>.json` gains:
  - `region` (key such as `head`)
  - `tasks`: the open tasks to run
  - `systems`: the ordered system keys this case shows
  - `defaultSystems`
  - `windows`: the ordered preset keys
  - `systemOverrides`: optional `structure key → system key`
  
  It keeps `title` and `keyLevels`.
- `meta.json` gains `systems` (the full system entries this case uses, in order, with names),
  `defaultSystems` and `windows`. The viewer reads systems and windows from the case, never from
  constants.
- `site/cases/index.json` entries gain `region` and stay sorted in a fixed region order
  (head, neck, chest, abdomen-pelvis).

### Pipeline

- `make_case.py` runs every task in the case's `tasks` list (cached per task, as `liver_segments`
  is today) with the existing `--device` flag. It **refuses any task not on an allow-list of open
  tasks**, and that list is checked against the official README at build time by the builder.
  The dataset's own `segmentations/` folder stays the source for `total` classes.
- Cases come from the TotalSegmentator dataset, fetched one at a time (as for `s0010`). Choose
  adult scans without obvious pathology and with contrast where it helps (the neck and chest
  benefit from it, the head usually doesn't).

### Viewer

- `state.js`: the system list comes from the case. `clampState` gets the case's system keys
  instead of the global `SYSTEMS`. A link with no `sys` uses the case's `defaultSystems`.
  Switching region resets plane, slice and systems to that case's defaults.
- `volume.js`: `WINDOWS` becomes a catalogue including the new presets (brain 40/80,
  mediastinum 50/350). The window dropdown shows the case's `windows`.
- `app.js`: system buttons, icons and colours come from `meta.systems`, plus new icon symbols for
  the new systems. The region switcher replaces the case dropdown and is always visible when
  there's more than one case. The deferred bug "opening a case from a link drops the link's
  plane and systems" must be fixed here, since multiple cases make it real.
- `i18n`: system names move into the data (`systems.json` → `meta.json`), like structure names.
  The `system.*` keys leave the UI string files, and new window and region strings are added.
- Existing links: `#case=s0010&sys=organs,...` keeps working, because the abdomen case's system
  keys are unchanged.

### Checks

- Pipeline tests: the open-task allow-list rejects a licensed task; a case's `meta.json` carries
  `systems`, `defaultSystems` and `windows`; a structure whose system isn't in the case's
  `systems` is excluded.
- Viewer tests: `clampState` with a case-specific system list; the default systems when `sys`
  is absent; window catalogue entries for the new presets.
- Manual check in a browser per region: orientation (patient right on the left), systems, key
  levels, Arabic RTL, and phone width.

## My calls (correctable)

- Regions now: head, neck and chest. Limbs wait, because their open coverage is too thin.
- A region switcher at the top replaces the case dropdown.
- Window presets per region as listed above.
- No chest-muscles system (the open model's masks stop partway up the chest).
- One explicit source per structure when tasks overlap. Per-case system overrides handle
  region-specific grouping.
- If the dataset has no usable head or neck scan, ship the regions that work and tell the owner.
  Don't bring in another dataset without asking.

## Left to the builder

- The exact dataset scan per region, and the voxel size or z-range to meet the 25 MB budget.
- The final system list, colours and icons for the new systems.
- The structure translations in 7 languages, drafted from Terminologia Anatomica as before.
- The key levels per region.
- Which structures survive the sanity pass.
