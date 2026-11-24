# Fracture & operation atlas — design

## Intent
A page like SkeleTour (bone → classification → type, drawn on the bone), aimed at **residents planning an
operation**. So after "which type is this" each fracture page continues: should it be fixed (cited, dated
recommendations), which approach, what is at risk, how to reduce and fix it, what to check, and aftercare.

## Decisions (user)
- Audience: residents planning an approach and fixation.
- Depth first: five high-volume fractures done fully before adding breadth:
  calcaneus (Sanders), ankle (Weber, Lauge-Hansen in text), tibial plateau (Schatzker, three-column in text),
  distal radius (AO/OTA 2R3), femoral neck (Garden).
- Approach "A + 2D sections": everything is drawn on the real Z-Anatomy bones in 3D, plus a 2D section
  view where the classification is read on a section (Sanders coronal, ankle mortise-level coronal, …).

## Approaches considered
- **A. 3D on the atlas bones** (picked): reuses `site/atlas/skeleton.glb` + nerves/vessels/muscles; fractures are
  data, so new fractures need no code.
- B. Hand-drawn 2D schematics per type + 3D only for the approach: exact but ~30 hand drawings and two visual languages.
- C. Real fractured CTs: no open dataset covers calcaneus/ankle/plateau/radius fractures; ruled out.

## Design
- `site/fracture.html` + `js/fractureapp.js` (DOM) + `js/fractureview.js` (three.js, lazily imported like the
  other 3D views) + DOM-free `js/fracturegeom.js` (fragment classification, fragment transforms, mesh
  sectioning) tested in `tests/fracturegeom.test.js`.
- **Fragments** are convex regions: each an intersection of half-spaces `[nx,ny,nz,d]` (world RAS mm) with a
  colour and an optional displacement (translate + rotate about a pivot). A vertex belongs to the first
  fragment that contains it, else the intact bone. The shader colours by fragment, darkens a thin band at
  fragment boundaries (the fracture line) and applies the displacement in the vertex shader, so a type
  switch can animate from reduced to displaced.
- **2D section**: the bone mesh is cut by a plane in JS (`fracturegeom.section`) and drawn as SVG with the
  fragments filled — generated from the same model as the 3D, never hand-drawn.
- **Approach**: incision as a polyline tube in world mm, structures at risk highlighted from the atlas
  (nerves/vessels/muscles of that region), the rest faded.
- **Content** per fracture in `site/fracture/<id>.json` (English text; titles in 7 languages, other text falls
  back to English like the heart texts). Every management statement carries reference ids; every reference
  has year, type (guideline / RCT / meta-analysis / technique) and DOI/URL. A `reviewed` date is shown.
  Geometry (fragments per type, section planes, incisions, camera) lives in `site/fracture/shapes.json`.
- Page chrome strings in `i18n/*.json` (7 languages). Home gets a tile.

## Non-goals / anti-goals
- Not a substitute for local protocols or the AO Surgery Reference; the page says so.
- No invented evidence: a statement without a verifiable source is left out.
- No backend, no build step, no npm deps; three.js only via the existing CDN import map.

## Left to the builder
Exact plane placements per type (tuned against the mesh and screenshots), quiz mode (later), more fractures.
