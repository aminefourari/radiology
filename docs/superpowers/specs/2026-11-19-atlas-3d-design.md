# Atlas-style 3D view — design

## Intent

The CT atlas has a 3D button (PR #9) that ray-casts the label voxels on the CPU. It works but looks
like stacked sugar cubes, has no names on the model, and can only show or hide whole systems.
The owner wants the 3D view to feel like an anatomy-atlas app: **realistic-looking smooth organs,
names pinned to them, and hide / fade / isolate per structure** — all three matter. The site must
stay fast; dependencies are fine as long as it does.

## Goals

- Smooth, softly lit, slightly glossy organ models from each case's existing label map.
- Names pinned in 3D: tap a structure to pin its name; optional auto-labels for the larger visible
  structures, with leader lines, that follow the model as it rotates.
- Per-structure **Hide**, **Fade** (see-through), **Isolate** (hide everything else), and **Show all**.
- Orbit, zoom, pan with mouse and touch (pinch). Double-click/tap a structure to centre on it.
- Fast: the 2D views load exactly as today; 3D opens in ≲2 s on broadband once the case is loaded;
  60 fps on a laptop, ≥30 fps on a mid-range phone.

## Non-goals

- Textured or hand-sculpted art; structures not in the segmentation (nerves, small vessels).
- A whole-body model — each region stays its own case.
- 3D mode in the share link (can follow later).
- Raw-CT volume rendering (skin, soft tissue) in 3D.

## Anti-goals (failure even if it works)

- Blobby or blocky surfaces.
- A slower 2D site, or a 3D view that stutters on phones.
- Labels cluttering the whole screen.
- Mirrored anatomy: the default view is anterior with the patient's right on the viewer's left.

## Constraints

- Static site, no build step, no backend. ES modules in `site/js`.
- Volumes RAS+, `[z][y][x]` on disk, `meta.spacing` in mm; label ids 1–255 per `meta.structures`.
- 7 languages (en, de, es, ar rtl, fr, it, nl); never mirror the image for RTL.
- Changes the project rule "no npm dependencies": a CDN library is now allowed. Update CLAUDE.md.

## Approaches

1. **Offline meshes + hand-written WebGL** — no dependency, ~300 lines of renderer to own.
2. **Offline meshes + three.js from a CDN** — *chosen*. The owner is fine with dependencies if the
   site stays fast; three.js gives orbit controls, picking, transparency sorting and good
   materials/lighting for free, and loading it only when 3D opens keeps the 2D site unaffected.
3. Polish the CPU ray caster — ruled out: stays soft/blobby, transparency is slow on phones.

## Design

### Pipeline: `pipeline/make_meshes.py`

- Input: a built case directory (`site/cases/<id>/meta.json` + `labels.bin.gz`). Works on the
  committed cases; no raw dataset needed. Run for all cases; output committed.
- Per structure mask: Gaussian-smooth the binary mask (σ ≈ 1 voxel), `skimage.measure.marching_cubes`
  at 0.5 with `spacing = meta.spacing`, then decimate (`fast-simplification`, added to
  `requirements.txt` along with `scikit-image`) to a per-structure triangle budget proportional to
  surface area, total ≈150k triangles per case. Thin structures that vanish under smoothing fall back
  to a smaller σ.
- **Parents** (e.g. liver, whose voxels carry segment ids): also build a mesh from the union of
  the parent's and its children's voxels, so the parent shows as one seamless organ when only its
  system is on and the segment meshes show when the segment system is on (mirrors `colorTable`).
- Output `mesh.bin.gz` + a `meshes` entry in `meta.json`: per structure `{id, offset, vertexCount,
  indexCount, anchor:[x,y,z]}`. Positions quantised to uint16 over the case bounding box (box stored
  in meta), indices uint16 per structure (split if >65 535 vertices). Normals are computed in the
  browser. Target ≤1.5 MB gzipped per case.
- `anchor`: a surface vertex near the structure's centroid, used for the label pin.
- Coordinates are RAS mm, same as the volume, so 2D and 3D agree.

### Viewer

- `site/js/meshdata.js` (DOM-free, Node-tested): decode `mesh.bin.gz` + meta into typed arrays per
  structure; pure helpers for which mesh ids are shown given systems/hidden/faded/isolated state.
- `site/js/view3d.js` (DOM + three.js): loaded with dynamic `import()` the first time 3D opens.
  three.js is pinned to an exact version via an import map in `ct.html` (jsDelivr). Replaces
  `render3d.js` and its test.
- Rendering: `MeshPhysicalMaterial` per structure colour (low roughness, light clearcoat for a wet,
  anatomical look), hemisphere + key + rim lights, dark gradient background matching the viewer.
  Ambient occlusion only if it holds the frame-rate targets on a phone; otherwise skip.
  Render on demand (only when the camera or state changes), not a constant loop.
- Faded structures: opacity ≈0.15, `depthWrite: false`, drawn after opaque ones.
- Picking: `Raycaster` on tap; ignores hidden and faded structures (so you can reach what's behind).
- Labels: HTML/SVG overlay. The selected structure always gets a pin at its `anchor` with a leader
  line. "Show labels" (existing setting) adds auto-labels for the largest visible structures, laid
  out to the sides with the existing `layoutLabels`, hidden when their anchor is behind the model.
- Tools in the selection popup: Hide, Fade/Unfade, Isolate, and the existing report link; a
  "Show all" button in the viewer head appears whenever anything is hidden, faded or isolated.
  Hide uses the existing `ui.hidden`, so it also applies to the 2D views.
- Controls: `OrbitControls` (rotate, pinch/scroll zoom, right-drag/two-finger pan); default camera
  anterior, patient right on viewer's left; double-tap centres on the structure.
- System toggles, structure list checkboxes and language switching keep working in 3D.
- Loading: show the existing progress bar while three.js + `mesh.bin.gz` load; cache both per case.
- New strings (hide, fade, unfade, isolate, show all) in all 7 languages.

### Tests

- pytest: a synthetic sphere/box label map → mesh is closed, lies inside the box in mm, file
  round-trips; parent union mesh exists.
- Node: `meshdata.js` decoding and visibility rules (parent vs children, hidden, faded, isolate).
- Browser check on every case: look, orientation, picking, tools, frame rate, file sizes.

## Left to the builder

Exact smoothing/decimation numbers, the three.js version, light and material values, the auto-label
count, and the binary layout details — within the targets above.
