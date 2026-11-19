# 3D body atlas (Z-Anatomy) linked to the CT scans — design

Supersedes `2026-11-19-atlas-3d-design.md` (3D built from each scan's segmentation, dropped: it looked
messy — organs cut off at the scan edge, lumpy automatic outlines).

## Intent

The owner wants the 3D view to look like an anatomy-atlas app (Visible Body): clean, artist-made
models, names pinned on them, hide / fade / isolate. Instead of building 3D from each patient's
scan, use the open **Z-Anatomy** atlas and **link it to the scans**:

Slices and 3D are shown **side by side** (3D is a toggle that splits the viewer, not a fourth
plane):

- **A — by structure.** Selection is shared: tapping a linked structure in either pane selects it in
  both. In 3D the popup offers "Show in CT", which jumps the slices to that structure's best slice
  (opening the region that labels it if the current case doesn't). In the slices the popup offers
  "Show in 3D", which centres the atlas on it.
- **B — where am I.** In 3D, a see-through plane shows where the current CT slice sits in the body,
  and moves live as the slice changes.

## Goals

- Z-Anatomy body (bones, muscles, vessels, nerves, organs) in the existing three.js view, with the
  look already built: tissue materials, ambient occlusion, studio backdrop.
- Atlas systems toggled on/off in 3D; names pinned to structures; hide / fade / isolate / show all.
- Links A and B as above, for every structure the five CT cases label that the atlas also has.
- Fast: the 2D views never fetch three.js or atlas files; opening 3D loads only the systems that are
  on (target: first view in ≲3 s on broadband, ≤6 MB); other systems load when toggled.

## Non-goals

- Fitting/warping the atlas to the patient (the plane in B is approximate, by landmarks).
- A female body (BodyParts3D has only a male model; female cases still show it).
- Scan-derived 3D (removed, with its pipeline step and files).
- Translating atlas-only structure names (nerves, small muscles) into all 7 languages — they show in
  English with the Latin term; linked structures use the site's existing 7-language names.

## Anti-goals

- Shipping any component under a non-commercial licence.
- Mirrored anatomy: default view anterior, patient right on the viewer's left.
- "Show in CT" that lands on a slice where the structure isn't visible.

## Constraints

- Static site, no build step; three.js 0.170.0 from jsDelivr, loaded only for 3D (already in place).
- Atlas data: Z-Anatomy, CC BY-SA 4.0, derived from BodyParts3D (CC BY-SA 2.1 JP). Published atlas
  files stay CC BY-SA 4.0 with both attributions in the footer and in `site/atlas/LICENSE.txt`.
  Exclude the non-commercial parts Z-Anatomy credits (inner ear: CC BY-NC-SA; kidney by Lissie
  Cowley: CC BY-NC). If the atlas kidney is the non-commercial one, use the BodyParts3D kidney
  (Kevin Moerman's STL clone, CC BY-SA) instead.
- 7 languages for all new UI strings.

## Approaches

1. **Z-Anatomy, exported from its Blender file** — *chosen*. Cleaned, coloured, organised atlas with
   nerves and more muscles; closest to the Visible Body look.
2. Raw BodyParts3D (Kevin Moerman's STL clone) — easier to extract (one STL per FMA ID) but older
   and incomplete (few nerves/muscles), uncleaned. Kept only as the kidney fallback.
3. NIH Human Reference Atlas — CC BY 4.0, web-ready, but organs only, not a full atlas.

## Design

### Pipeline: `pipeline/make_atlas.py` (+ `pipeline/atlas_export.py` run inside Blender)

- Download `Z-Anatomy.zip` from `github.com/Z-Anatomy/Models-of-human-anatomy` into `data/` (gitignored).
- Headless Blender (`/Applications/Blender.app/Contents/MacOS/Blender -b --python`) exports one GLB
  per atlas system (Z-Anatomy's collections: skeleton, joints/ligaments, muscles, cardiovascular,
  nervous, respiratory, digestive, urinary, reproductive, lymphatic/glands, skin), each mesh named by
  a stable key, with its English and Latin name and Z-Anatomy colour in `extras`. Excluded parts
  (above) are skipped by name.
- Compress with `gltfpack` (meshopt, quantised, simplified where the triangle count is high) into
  `site/atlas/<system>.glb` + `site/atlas/index.json` (systems, structures: key, system, names,
  colour, anchor point, centroid, bounding box).
- Coordinates: converted to RAS mm (Z-Anatomy is Blender Z-up; scale to mm), so the atlas uses the
  same axes as the scans.

### Mapping: `pipeline/atlas_map.json` (curated, committed)

- `{ "<site structure key>": ["<atlas key>", ...] }` for every key in `pipeline/structures.json` that
  the atlas has. A helper drafts it by name matching (English names, `TA2.csv` synonyms, left/right),
  then it is reviewed by hand. Several-to-one is fine (liver segments → liver; ribs → each rib).
- `make_atlas.py` fails if the map points at an atlas key that doesn't exist.

### Plane (B): `site/cases/<id>/atlaslink.json` (per case, built by `make_atlas.py`)

- Landmarks = structures present in both the case and the atlas, bones first (vertebrae, hips,
  femurs, skull, ribs, sternum…). For each, the centroid in the case (from `labels.bin.gz`, mm) and in
  the atlas.
- Per axis, a least-squares fit `atlas = a·ct + b` from the landmark centroids (needs ≥2 landmarks on
  that axis; otherwise the plane is not shown for that case). Stored as `{x:[a,b], y:[a,b], z:[a,b]}`.
- In 3D, the current plane (axial / coronal / sagittal) at the current slice is mapped through the
  fit and drawn as a see-through quad clipped to the body's extent, with a thin outline.

### Viewer

- `view3d.js` (kept from the scan-3D work: renderer, lights, AO, materials, picking, `project`)
  loads atlas GLBs with `GLTFLoader` + `MeshoptDecoder`; per-structure meshes keyed by atlas key.
  Materials from tissue: Z-Anatomy colours, with the tissue type (bone, vessel, muscle, organ, nerve)
  from its system.
- `atlasdata.js` (DOM-free, Node-tested): visibility (systems on, hidden, faded, isolated); mapping
  lookups in both directions; the plane transform (`ctToAtlas(fit, plane, sliceMm)`).
- Layout: the plane selector loses its "3D" option; a separate **3D** toggle splits the viewer into
  slices (left) and atlas (right), stacked (slices on top) below ~700 px wide. Each pane keeps its own
  controls: slice slider, window, zoom for the slices; Fit for the 3D. The 2D views never fetch
  three.js until the toggle is first switched on; the toggle state is remembered in the URL.
- The 3D pane has its own atlas system toggles (a compact bar inside the pane, default: skeleton +
  the organ systems for the case's region); the CT system bar keeps driving the slice overlay.
- Popup in 3D: name (site's 7-language name if linked, else English + Latin), Hide, Fade/Unfade,
  Isolate, **Show in CT** (only if linked; prefers the current case, else the first case that labels
  it; jumps to its best slice in the current plane and selects it). Popup in 2D: **Show in 3D** (only
  if linked and 3D is on: centres the atlas on it).
- Pinned labels and "Show all" as in the previous design.
- Footer: atlas credit line (BodyParts3D, Z-Anatomy, CC BY-SA) shown on the CT page.

### Removed

`pipeline/meshlib.py`, `pipeline/make_meshes.py`, their test, `site/cases/*/mesh.bin.gz`,
`meshes.json`, `site/js/meshdata.js` + test (its visibility/tissue logic moves into `atlasdata.js`).

### Tests

- pytest: mapping validation (unknown atlas key fails); plane fit on synthetic landmarks (known
  scale/offset recovered; <2 landmarks → no fit); RAS conversion of a known Blender point.
- Node: `atlasdata.js` visibility rules, mapping both ways, `ctToAtlas`.
- Browser: side-by-side layout at desktop and phone widths; each case — Show in CT lands on a slice showing the structure; Show in 3D selects it;
  plane tracks the slider at sensible body levels (e.g. L1 slice ↔ atlas L1); orientation; speed.

## Left to the builder

gltfpack settings, triangle budgets per system, exact default systems per region, the drafting
heuristics for the map, materials per tissue.
