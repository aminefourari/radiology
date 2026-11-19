# CT Anatomy Viewer — Design

## Intent

A web atlas of cross-sectional anatomy built on real CT scans. You scroll through a scan in axial,
coronal or sagittal view, switch colored structure overlays on and off by system, and read
labels that point to each structure. Inspired by a viewer seen in a short video (abdomen/pelvis,
venous-phase CT, Couinaud liver segments, a dark monospace UI).

**Who it's for:** the owner (studying), medical students (learning anatomy), and doctors
(checking their bearings on real images).

**Success:** someone opens the link on a phone or laptop, has a labeled abdominal CT in hand within
seconds, and can answer "what is this structure, and where is it on the other planes?" without
help.

## Goals

- A public, free website with no login. It works well on a phone and a tablet, and also on desktop.
- One real abdomen/pelvis CT case at launch, from an open dataset, with a correct attribution.
- A **case library** from day one: the viewer loads any case from a data folder, and a repeatable
  script turns a dataset CT into a case.
- These viewer features:
  - Axial, coronal and sagittal planes, chosen with buttons. Each shows plane name, slice index
    and size, plus orientation markers (Sup/Inf, R/L, Ant/Post).
  - Slice navigation: a slider, prev/next buttons, mouse wheel, arrow keys and touch drag.
  - Zoom (−/+ and a percentage), Fit, and pan (a "Move" mode, plus drag when zoomed on desktop).
  - Window presets (soft tissue, liver, bone, lung) and a live HU readout under the cursor or finger.
  - **System toggles** (icon buttons), plus "All" and "None".
  - A **Structures** panel that lists every structure, grouped by system. Each one can be toggled,
    and tapping its name jumps to the slice where it is largest in the current plane.
  - **Labels with leader lines** for the visible structures on the current slice, stacked in
    left/right columns beside the image so they don't overlap it.
  - Tapping or clicking a structure on the image highlights it and shows its full name.
  - **Key levels**: named shortcut buttons (for example: esophageal hiatus / GE junction, celiac
    trunk, SMA origin, renal veins, aortic bifurcation) that jump to a curated slice.
  - **Focus** mode: the image fills the screen and the controls collapse.
  - Settings: overlay opacity, labels on/off, outline vs filled overlays.
- A footer with the dataset credit (CC BY 4.0) and "Educational use only — not for diagnosis."
- **Open source, community-reviewed.** The code lives in a public GitHub repo. Every structure
  (in the Structures panel and in the tap popup) has a "Report a problem" link. It opens a
  prefilled GitHub issue with the case, structure, plane, slice and a link to that exact view, so
  people can report wrong labels, wrong masks or wrong translations. Fixes come in as PRs to the
  data files (`structures.json`, the translations, key levels), or as a re-export of the case.
  The site says plainly that the labels come from automated segmentation and are reviewed by the
  community.
- **Multilingual from day one:** English, German, Spanish, Arabic, French, Italian and Dutch,
  and adding a language must be easy. That covers both the UI text and the structure names.

## Non-goals (for now)

- Users uploading their own scans, or live segmentation. That needs a GPU backend and raises
  patient-privacy problems.
- Accounts, progress tracking, quizzes, 3D volume rendering, DICOM import, MRI, other body regions.
  The case library makes body regions and MRI possible later, but none ship now.
- Lymph node and peritoneum systems. Open tools don't segment these at a quality worth showing.
  Leave them out rather than show bad masks.

## Anti-goals (would be a failure even if it "works")

- **Wrong anatomy that can't be reported or fixed.** Labels come from automated segmentation and
  ship without an expert sign-off (the owner's decision). The safeguard is the community: errors
  must be easy to report from the exact view where they're seen, and easy to fix through the repo.
  The builder still does a basic sanity pass and drops structures whose masks are obviously broken.
- **Slow on a phone.** The first image must appear quickly on a mid-range phone over 4G.
- **Looking like clinical software.** No diagnostic claims, and no "reports".

## Constraints

- **Data:** the [TotalSegmentator dataset](https://zenodo.org/record/6802614) (about 1,200 CTs
  with 100+ labeled structures, **CC BY 4.0**). Attribution is required, both on the site and in
  the README.
- **Couinaud liver segments** aren't in the dataset's labels. Generate them by running the
  TotalSegmentator model's `liver_segments` subtask on the chosen case. A mirror of its README
  lists that subtask as open (Apache-2.0). **Confirm this in the official
  [GitHub README](https://github.com/wasserth/TotalSegmentator) before using it.** If it needs a
  license, ship without the Segments system and say so.
- **Download size per case:** target ≤ 25 MB total. The viewer shows the first slice before the
  full case has finished loading if practical. Otherwise it shows a progress bar.
- **Static hosting only:** there's no server code, and the site can be hosted free (for example
  Cloudflare Pages or GitHub Pages).

## Approaches considered

1. **Own lightweight viewer (chosen).** An offline Python script exports each case as compact
   binary volumes plus a JSON manifest. A plain HTML/CSS/JS page reslices the volumes in the
   browser and draws overlays, labels and controls. Pros: full control of the look and the
   label layout, tiny and fast on phones, static hosting. Cons: we write the reslicing and
   interaction ourselves. That's a small amount of code.
2. **NiiVue (a WebGL medical viewer library).** It handles slicing, zoom and overlays for us.
   It wasn't chosen because the distinctive parts (leader-line labels, system toggles, the mobile
   layout) would be custom work fighting the library.
3. **OHIF (a full radiology DICOM viewer).** It was rejected as heavy and clinical, and built for
   hospital workflows, not a learning atlas.

The owner picked approach 1, set up as a library that starts with one case.

## Design

### Pipeline (Python, run offline by the maintainer)

`pipeline/make_case.py <dataset_case_dir> <case_id>` writes `site/cases/<case_id>/`:

- Loads the CT and the dataset's per-structure masks (NIfTI) with nibabel.
- Runs TotalSegmentator `liver_segments` on the CT and adds segments 1–8.
- Reorients everything to one canonical orientation (RAS or LPS). Pick one, document it, and use
  it everywhere.
- Crops to the body bounding box and the abdomen/pelvis range, then resamples. The builder
  chooses the voxel size to meet the 25 MB budget. A starting point is about 1.25 mm isotropic,
  using nearest-neighbour resampling for labels.
- Writes:
  - `ct.bin.gz`: int16 HU, gzipped.
  - `labels.bin.gz`: uint8 label map, one id per structure, 0 = background.
  - `meta.json`: dims, spacing, orientation, structures (id, name, system, color, and a
    per-plane "best slice" for tap-to-jump), key levels, and the dataset source and credit.
- Writes a gzipped binary, not `.nii.gz`, so the browser needs no NIfTI parser. It decompresses
  with the native `DecompressionStream`.
- Writes `site/cases/index.json`, which lists the cases.

**Structure → system mapping** lives in one file, `pipeline/structures.json`. It maps dataset
label name → display name, system and color, and anything not listed is dropped. Systems at
launch: Organs, Liver segments, Digestive, Urinary, Pelvis (bones), Spine (vertebrae — the landmarks
students use to find levels), Arteries, Veins. Muscles, ribs and lung bases are left for later. The builder
fills in the exact structure list from what the dataset provides and keeps only what passes the
visual check.

**Key levels** are curated by hand per case in `pipeline/cases/<case_id>.json`, as a name and an
axial slice index, then copied into `meta.json`. They aren't computed, because hand-picked is
accurate and there are only about 5 per case.

### Viewer (static site in `site/`)

- Plain HTML, CSS and JavaScript ES modules. There's no framework and no build step.
- It gets slices by indexing into the 3D typed arrays for the current plane and index, then
  applies the window to grayscale and draws to a `<canvas>`. Overlays are drawn from the label
  volume (filled with opacity, or as outlines). Labels and leader lines are an SVG layer on top.
- Label anchor: for each visible structure on the slice, use the in-slice centroid of its pixels,
  snapped to the nearest pixel that is inside the structure. Labels are placed on the side the
  anchor is on and sorted vertically to avoid overlap. Long names are truncated, with the full
  name shown on tap.
- On narrow screens (portrait phone), the label columns go in the dark margins of the canvas
  around the body, as in the reference. If they don't fit, show labels only for the
  selected/tapped structure. Labels can be turned off in Settings.
- Display uses the physical spacing so coronal and sagittal views aren't stretched.
- The URL hash holds the state (case, plane, slice, systems on, zoom), so a link reopens the same
  view. That's useful for teaching.
- The case picker only appears when `index.json` lists more than one case.
- The look is a dark theme with a monospace UI font, colored system buttons with icons, and
  rounded bordered controls. It's inspired by the reference, not a copy of it.

### Languages

- UI strings live in `site/i18n/<lang>.json`, one file per language, with flat keys. Structure
  names live in `structures.json` as `names: {en, de, es, ar, fr, it, nl}`, and `meta.json`
  carries them through. A missing translation falls back to English. Adding a language means
  adding one file, adding one column of names, and listing it in `site/i18n/index.json`.
- The language is taken from the browser at first visit. A language switcher changes it, and it's
  kept in the URL hash so shared links open in the same language.
- **Arabic is right-to-left.** Use `dir="rtl"` and CSS logical properties so the controls mirror.
  **The scan never mirrors.** Image orientation follows the radiological convention (the
  patient's right is on the viewer's left) in every language, and the R/L markers stay put.
  Label columns stay tied to the image side the anchor is on. Use a font stack with Arabic
  coverage (for example a monospace Latin font plus Noto Sans Arabic).
- The first translations are drafted by the builder, using standard anatomical terms (from
  Terminologia Anatomica where possible), and marked as community-reviewable.

### Community reporting

- "Report a problem" builds a GitHub new-issue URL (`/issues/new?title=…&body=…&labels=…`) with
  the case, structure id and name, language, plane, slice, and the share link. It needs no
  backend. The repo URL is a single constant.
- `CONTRIBUTING.md` explains how to fix a name or translation (edit JSON), drop or recolor a
  structure, or move a key level, and how to re-export a case with the pipeline.
- The code license is the builder's call (MIT suggested). The data stays CC BY 4.0, with
  credit.

### Checks

- The pipeline asserts that the volume shape matches `meta.json`, that every label id in the
  volume is in `meta.json`, and that the files fit the size budget.
- One small self-check for the reslice and orientation logic in the viewer: a tiny synthetic
  volume with known values, with each plane and index giving the expected pixels.
- Before launch: a quick sanity pass by the builder, dropping obviously broken masks. There's no
  expert sign-off; community reports take its place.
- A small check that every `site/i18n/*.json` file has the same keys as `en.json` (missing keys
  are warnings, since they fall back to English).

## Decided by the owner

- Audience: the owner, medical students and doctors.
- No expert sign-off before launch. It's open source, and the community reports and fixes labels.
- Languages: English, German, Spanish, Arabic, French, Italian, Dutch, with more to come.
- Use an open-source dataset.
- Approach 1 (own viewer), as a case library that starts with one case.

## My calls (correctable)

- Public, free, no login, mobile-friendly, educational disclaimer.
- The TotalSegmentator dataset, with the abdomen/pelvis region and venous-phase contrast if
  available.
- Drop lymph nodes and peritoneum at launch. Add a Spine system (vertebrae) as level landmarks.
- Portrait-phone labels: use the canvas margins, and fall back to tap-only labels.
- Plain JS with no build step, and Python for the pipeline.
- Reporting goes through prefilled GitHub issues (no backend), and fixes come in as PRs.
- The builder drafts the initial translations and picks the initial key levels. Both are
  community-correctable.
- The language is auto-detected and kept in the share link. Arabic mirrors the controls but never
  the scan.

## Left to the builder

- The exact dataset case. Choose a contrast-enhanced abdomen/pelvis CT with the full liver and
  pelvis in view, minimal artifacts, and adult anatomy.
- The resampling resolution, within the size budget.
- The color palette, icons and exact layout.
- The hosting provider and deploy setup.
- Which structures survive the sanity pass.
- Creating the public GitHub repo (the owner will need to create it or grant access).
