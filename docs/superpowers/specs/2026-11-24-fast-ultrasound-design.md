# FAST ultrasound trainer: a virtual probe on a real CT

The site's fourth module, beside CT, ECG and the heart simulator.

## Intent

The owner wants students to **learn the standard FAST windows**: where to put the probe, which way
its marker points, and how sliding, rocking, fanning and rotating it changes the picture. Then they
should recognise each view, **normal and positive** (free fluid). A FAST trainer that never shows a
positive scan misses the point of the exam, so simulated fluid is in scope (owner-approved).

**Who it's for:** the same audience as the rest of the site: medical students, the owner, and
doctors brushing up. It must work on a phone.

**Success:** a student opens the RUQ window, sees liver over right kidney with a thin bright line
between them, rocks the probe until the kidney's lower pole drops out, and fans back. They switch
fluid on and watch a black stripe open in Morison's pouch. Then they go through all four windows on
the same body without help.

## Goals

- A new page `echo.html` with a home tile, in all 7 languages (rtl for ar).
- One new **chest-to-pelvis case** from the TotalSegmentator dataset (a "ct polytrauma" study marked
  `no_pathology`, with heart, liver, spleen, both kidneys and bladder fully in the field of view).
  Built with `total` plus `heartchambers_highres`, so the myocardium and the blood pools are separate.
- A **live virtual probe** (approach A, owner-approved): the browser cuts the fan's plane through
  the CT and labels at any pose and turns it into an ultrasound-looking image every frame.
- **Probe placement on a 2D outline** (owner-approved), no 3D/three.js on this page.
- The **four FAST windows**: RUQ (hepatorenal), LUQ (splenorenal), pelvic (transverse and
  sagittal), and subxiphoid (heart and pericardium).
- **Simulated free fluid** at four sites (Morison's pouch/right paracolic, splenorenal/left
  subphrenic, pelvis behind the bladder, pericardium), each with none/small/large, labelled on
  screen as simulated.

## Non-goals (for now)

- eFAST lung views (sliding, B-lines, lung point): these are motion artefacts a static CT can't give.
- Doppler, M-mode, cardiac echo views beyond subxiphoid, a beating heart, breathing.
- Real ultrasound clips or images: open echo datasets are non-commercial or research-only.
- A 3D torso. It could come later, behind `import()` as on the CT page.
- Probe types other than one curvilinear abdominal probe.
- A quiz (owner: later).

## Anti-goals (would be a failure even if it "works")

- Fluid that sits where fluid can't go (inside an organ, in fat that isn't a dependent space, in bone).
- Image features painted per view. Shadows, enhancement, edges and fluid must come from the
  physics model acting on the volume, as on the heart page. A feature the model can't make is left
  out, not faked.
- Left/right or marker convention mistakes. These are what students most need to get right.
- The 2D page fetching three.js, or the image stuttering on a mid-range phone.

## Constraints (from the project)

- No backend, no build step, no npm dependencies. ES modules. DOM-free modules for anything Node
  should test (only `echoapp.js` and its DOM view helpers touch the DOM).
- Case format unchanged: RAS+ `[x,y,z]`, on disk C-order `[z][y][x]`, gzipped, int16 HU and uint8
  labels. Reuse `loadCase` from `site/js/volume.js` and `pipeline/make_case.py` for the case itself.
- Titles in all 7 languages, teaching texts in English (others fall back), as for heart rhythms.
- Credit: TotalSegmentator dataset, CC BY 4.0, and say the fluid is simulated.

## Approaches considered

- **A. Live virtual probe (chosen).** Cut a fan plane through CT and labels at any pose. Map tissue
  to echogenicity, then march each scan line from the probe to make shadows, enhancement and
  depth falloff, and add speckle. Free exploration is exactly the goal. It is the most new code
  (angled cutting doesn't exist yet) and the look needs tuning.
- **B. Pre-rendered views.** Simple and polishable offline, but tilting jumps between steps, so a
  student can't wander into a wrong view and correct it. Rejected.
- **C. A but brightness from HU only.** Less code, but liver, spleen and kidney have nearly the same
  HU, so the image is flat and Morison's pouch is hard to read. Rejected.
- Probe placement: a **2D outline (chosen)** keeps three.js off the page. A 3D torso is clearer
  for tilt but heavier; it is a possible later step.

## Design

### 1. The case and the fluid (pipeline)

- `make_case.py` builds the case as usual (a new `region`, e.g. `trunk`), with its key structures
  in `structures.json`.
- A new step, `pipeline/make_fluid.py <case dir>`, writes `fluid.bin.gz` (uint8, same grid). It
  grows fluid only into **voxels no organ label claims and whose HU is soft tissue or fat** (not
  bone, not air), and only in the real potential spaces:
  - **Morison's pouch:** voxels close to both the liver and the right kidney (distance transforms),
    spreading downward along the right paracolic gutter at "large".
  - **Splenorenal/left subphrenic:** close to both the spleen and the left kidney, and between the
    spleen and the diaphragm.
  - **Pelvis:** posterior/superior to the bladder (rectovesical pouch for a male, pouch of Douglas
    for a female), against the bladder wall.
  - **Pericardium:** a shell just outside the myocardium, thicker posteriorly-inferiorly where it
    collects, never into lung.
  - Each voxel stores **site and the smallest amount at which it is fluid** (for example
    `site * 4 + level`, level 1 = small, 2 = large), so the browser thresholds without a reload.
  - The exact distances are the builder's to tune. The check is anatomical: a small amount looks
    like a thin dark stripe in the right place, a large one like a wedge, and none of it lands
    inside an organ.
- `pipeline/cases/<id>.json` also carries the **target pose for each FAST window** (skin point,
  beam direction, marker direction), found once and checked by tests.

### 2. The ultrasound image (DOM-free, `site/js/usrender.js`)

- **Fan geometry:** curvilinear probe, ~60° sector, depth 8–24 cm (the student can change depth),
  scan lines × samples about 192 × 384, drawn into a canvas with the fan shape.
- **Angled cutting:** sample CT (trilinear) and labels (nearest) along each scan line in world mm.
  Test: an axial-aligned "plane" matches `extractSlice`.
- **Tissue → echogenicity:** an `echo` value per structure (a grey level plus a texture strength),
  defaulting from its system. Examples: liver/spleen mid-grey and fine-grained, renal cortex a bit
  darker than liver, renal sinus fat bright, myocardium mid-grey, blood pools, bladder, gallbladder
  and fluid black. Unlabelled tissue goes by HU: fat bright, muscle darker and striated.
- **Along each scan line** (the physics that makes it look like ultrasound):
  - attenuation with depth, with a fixed time-gain compensation curve (plus a gain slider);
  - a bright line at strong interfaces (a jump in acoustic impedance);
  - bone (HU > ~300): a bright surface and a full black shadow below, so ribs throw shadows;
  - gas (HU < ~−300): a bright surface, a "dirty" shadow and reverberation lines below;
  - fluid and blood pools: almost no attenuation, so tissue behind looks brighter (posterior
    acoustic enhancement).
- **Speckle:** a noise field fixed to the body (hash of world position), so the grain moves with
  the anatomy when the probe slides, as on a real machine, blurred along the beam.
- **Labels overlay (toggle):** outlines and names of the structures in the fan, from the label
  volume.

### 3. The probe (DOM-free, `site/js/usprobe.js`)

- **Pose** = a skin point plus three angles about it: **rock** (tilt in the image plane), **fan**
  (tilt out of the plane, sweeping through the organ) and **rotate** (spin about the beam, turning
  the marker). **Slide** moves the skin point along the skin.
- The skin surface comes from the case's body mask (largest connected non-air region). The
  default beam is the inward skin normal.
- **Marker convention:** the probe marker points to the patient's head (longitudinal) or right
  (transverse), and shows on the **left of the screen**, as in abdominal ultrasound. The pose text
  says which way the marker points, in words.
- Each window's **closeness** to its target pose (distance and angles) drives a guide.

### 4. The page (`echo.html`, `site/js/echoapp.js`)

```
┌──────────────────────────────┬───────────────────────────┐
│  RUQ  LUQ  Pelvic  Subxiph.  │  [front body outline]     │
│ ┌──────────────────────────┐ │    • probe dot, drag it   │
│ │   ◤ ultrasound fan ◥     │ │  [axial ring at level]    │
│ │      (marker dot ●)      │ │    • spot round the body  │
│ │                          │ │  rock ◀▶  fan ◀▶  rot ↻   │
│ └──────────────────────────┘ │  depth  gain   labels ☐   │
│  Fluid: Morison ▢ Spleen ▢   │  [small CT: the fan's     │
│         Pelvis ▢ Pericard ▢  │   plane drawn on it]      │
│  [What you should see …]     │  Show me                  │
└──────────────────────────────┴───────────────────────────┘
```

- **Placement:** a front silhouette of the body picks the level and side. An axial cross-section
  outline at that level picks the spot round the body (front, flank, back). This is what reaches
  the mid-axillary line for RUQ/LUQ. Dragging on either moves the probe; the probe glyph shows
  marker direction.
- **Tilt controls:** rock, fan and rotate as drag handles and sliders, plus keys. On a phone the
  ultrasound image goes on top and the controls below.
- **Reference CT:** a small CT image of the fan's own plane, with the fan drawn on it, so the student
  sees what the beam is cutting.
- **Windows:** each FAST window button gives a short text (where to put the probe, what you should
  see, common mistakes) and a **Show me** that animates the probe to the target pose. A guide shows
  "warmer/colder" from the closeness, and says "view found" when the key landmarks are in the fan
  (for example RUQ: liver, right kidney and the hepatorenal interface within depth).
- **Fluid:** per site none/small/large, and an "all positive" shortcut. A visible badge says
  "simulated fluid".
- **Quiz: later** (owner's call). The first version is free exploration, Show me and the view-found guide.
- URL hash keeps window, pose, fluid and depth, so a view can be shared, as on the other pages.

### 5. Tests (Node)

- Angled cutting matches `extractSlice` for an axial pose.
- A bone block in a synthetic volume shadows everything below it. A fluid block is black and
  brightens what's behind it.
- For each window's target pose on the real case, the fan contains that window's landmarks
  (RUQ: liver + right kidney; LUQ: spleen + left kidney; pelvic: bladder; subxiphoid: heart chambers
  + liver).
- With fluid at "small", each site's fluid sits in the fan at its window's target pose, and no
  fluid voxel shares a voxel with an organ label (also checked in the pipeline's pytest).
- Pose math: rotate by 90° swaps longitudinal and transverse, and the marker side is correct.

## Left to the builder

- Which polytrauma case, as long as it meets the criteria above (normal, all four windows' organs
  in field, good quality).
- Echogenicity numbers, speckle look, TGC curve, and the fluid distances, tuned by eye against
  typical textbook FAST images.
- File split inside the page, the exact controls and keys, and the text content for each window.
- Whether the outline is drawn from the CT at load or exported by the pipeline.
- Branch: a new branch from `origin/main` (the heart work is already merged there).

## Calls made while writing this up (owner to check)

- **Download size:** keep 1.5 mm voxels (thinner fluid stripes need them). Crop the case to the body
  and from just above the heart to just below the bladder, arms excluded if the scanner left them
  in. Aim for about 30 MB gzipped in total, and show load progress (`loadCase` already reports it).
- **The new case also appears in the CT viewer**, with a `trunk` region added to the region list and
  named in all 7 languages. It's a useful CT case in its own right.
