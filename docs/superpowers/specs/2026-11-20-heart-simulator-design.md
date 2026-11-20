# Cardiac EP & 12-lead ECG simulator: schematic heart, 78 rhythms

Replaces the first heart page (`2026-11-20-heart-electrophysiology-design.md`, merged in #16).
That page's simulation model (activation by shortest path, heart vector projected on lead
axes, rhythm engine) stays. What changes: the heart, the views and the rhythm count.

## Intent

The owner asked for a web-based cardiac electrophysiology and 12-lead ECG simulator for
learning to read ECGs alongside the heart's electrical activity. It must have:

- a searchable rhythm picker with 78 rhythms in clinical categories;
- a synchronised, scrubbable tracing with labels and a ladder;
- close-up, rhythm-strip and 12-lead view modes;
- side-by-side comparison of two rhythms with a split slider;
- an educational panel;
- a heart view, slice or 3D, with section planes, colour modes, the conduction system and the heart vector;
- frontal and horizontal vector diagrams;
- a torso view with the 10 electrodes.

The owner then rejected Z-Anatomy as the heart. They showed the target look: a **textbook
schematic** four-chamber cut-away. It has a labelled conduction system, walls coloured by
electrical state, a wavefront arrow and a blocked bundle marked ✕. Numbered sites carry their own
action-potential plots. There is a frontal vector diagram and a 3-lead strip at 100 mm/s with
lead pickers and P/PR/QRS/ST/T chips. A clock reads "463 ms after SA node fires", over a phase
caption.

**Success:** a student opens "Left anterior fascicular block". The schematic shows the ✕ on the
anterior fascicle and the LV filling from the posterior fascicle upwards. The frontal vector
loop swings superiorly, so the student sees why II/III/aVF go negative. They then compare it
side by side with NSR and drag the split slider across the two hearts.

## Decisions (owner-approved or builder's calls)

1. **Our own idealised heart (owner-approved).** It is built from smooth shapes, generated in
   the browser by a DOM-free module:
   - the LV a truncated prolate ellipsoid shell (wall about 10 mm);
   - the RV a crescent wrapped round its right-anterior side (wall 4 mm);
   - two atrial shells above the AV plane (3 mm);
   - all in textbook orientation, long axis pointing left, down and forward.

   It needs no mesh file, licence or Blender. The Z-Anatomy heart pipeline and files are deleted.
2. **The simulation runs in 3D on that heart**, on a voxel lattice (2 mm) of the walls. Every view is a
   window onto the same activation, so the schematic, the 3D heart and the tracing can never
   disagree. The vector model is unchanged in principle. Weights become voxel volume, so the
   RV no longer needs a "thin shell" fudge.
3. **The schematic is the four-chamber slice of that heart**, rendered live as follows:
   - a canvas fill of the walls coloured per pixel from the voxel under it;
   - under crisp SVG outlines, computed analytically from the same shapes;
   - with labels, conduction system, numbered sites and the wavefront arrow.

   The short-axis slider re-slices the same lattice at any level.
4. **Never fake (kept):** a rhythm's teaching feature must come from the vector model. A rhythm
   that can't pass its ECG criteria test is left out, and the picker count says the real number.
   Pacing spikes are the one drawn element. They are device artefacts, not heart activity, and
   are marked as such in code.
5. **Text scope (builder's call):** rhythm titles in all 7 languages. "Why", "looks" and
   "takeaways" are written in English. The other languages fall back to English, as the site's
   i18n rule allows. The 17 existing rhythms keep their translations.
6. **The what-if panel is removed.** Comparison and the larger rhythm list do its job (RBBB vs NSR
   etc.).

## Rhythms (78)

Each row names the teaching feature that the row's test checks on the simulated leads and events.
A row that can't pass is cut and listed in the PR. The picker shows the shipped count.

| # | key | Rhythm | Criterion (the teaching feature) |
|---|-----|--------|----------------------------------|
| **Sinus** ||||
| 1 | nsr | Normal sinus rhythm | rate 60–100, PR 120–200, QRS < 120, axis 30°–75°, V1 rS, V6 qR, T concordant |
| 2 | sbrad | Sinus bradycardia | rate < 60, normal P and PR |
| 3 | stach | Sinus tachycardia | rate > 100, normal P and PR |
| 4 | sarr | Sinus arrhythmia | PP varies (CV > 0.08) with identical P axis and PR |
| 5 | sarrest | Sinus arrest with junctional escape | a pause with no P that is not a multiple of PP, ended by a narrow beat without a preceding P |
| 6 | sablock | 2:1 SA exit block | one pause equal to 2 × PP (± 10 ms) |
| 7 | wap | Wandering atrial pacemaker | ≥ 3 distinct P axes, rate < 100 |
| 8 | lowatrial | Low atrial (ectopic) rhythm | P negative in II, III, aVF; PR ≥ 120 |
| **Atrial** ||||
| 9 | afib | AF, rapid response | irregularly irregular RR, rate > 100, no repeating P |
| 10 | afib_slow | AF, controlled response | as AF, rate 60–100 |
| 11 | aflt | Typical flutter 2:1 | FF 200 ms, negative flutter waves in II/III/aVF, RR = 2 FF |
| 12 | aflt31 | Typical flutter 3:1 | RR = 3 FF |
| 13 | aflt41 | Typical flutter 4:1 | RR = 4 FF |
| 14 | afltvar | Flutter, variable block | every RR a multiple of FF, at least two different multiples |
| 15 | afltrev | Reverse typical flutter | flutter waves positive in II/III/aVF |
| 16 | at | Focal atrial tachycardia (LA focus) | regular, rate 150–220, P negative in I/aVL |
| 17 | at21 | Atrial tachycardia with 2:1 block | twice as many P as QRS, constant PR |
| 18 | mat | Multifocal atrial tachycardia | rate > 100, ≥ 3 P axes, irregular |
| 19 | pac | Premature atrial complex | early P with a different axis; the pause is less than compensatory |
| 20 | pacbig | Atrial bigeminy | every other beat a PAC |
| 21 | pacblocked | Blocked PAC | early P with no QRS after it |
| 22 | pacaberrant | PAC with aberrant conduction | the PAC's QRS ≥ 120 with rSR′ in V1; the sinus beats narrow |
| **AV nodal and junctional** ||||
| 23 | avnrt | Typical AVNRT | existing |
| 24 | avnrt_atyp | Atypical (fast–slow) AVNRT | regular narrow, RP > PR, retrograde P negative in II/III/aVF |
| 25 | avrt | Orthodromic AVRT | existing |
| 26 | avrt_anti | Antidromic AVRT | regular wide (≥ 120) tachycardia, pre-excited (QRS starts at the pathway) |
| 27 | jescape | Junctional escape rhythm | no sinus P, narrow regular 40–60, retrograde P after QRS |
| 28 | jaccel | Accelerated junctional rhythm | narrow regular 60–100, retrograde P |
| 29 | jtach | Junctional tachycardia | narrow regular > 100, retrograde P |
| 30 | pjc | Premature junctional complex | early narrow QRS, negative P in II right before or after it |
| **AV blocks** ||||
| 31 | 1avb | First-degree AV block | existing |
| 32 | mob1 | Mobitz I 4:3 | existing; 3 conducted per 4 P |
| 33 | mob1_32 | Mobitz I 3:2 | PR lengthens, 2 conducted per 3 P |
| 34 | mob2 | Mobitz II | existing |
| 35 | avb21 | 2:1 AV block, narrow | 2 P per QRS, QRS < 120, block level node |
| 36 | avb21bbb | 2:1 AV block with RBBB | 2 P per QRS, QRS ≥ 120 with rSR′, block level his (text: level inferred, not seen) |
| 37 | avbhigh | High-grade AV block 3:1 | 3 P per QRS, constant PR |
| 38 | 3avb_node | Complete block, junctional escape | existing |
| 39 | 3avb | Complete block, ventricular escape | existing |
| **Bundle branch and fascicular** ||||
| 40 | rbbb | RBBB | existing |
| 41 | irbbb | Incomplete RBBB | QRS 100–119, rSr′ in V1 (bundle slowed, not cut) |
| 42 | lbbb | LBBB | existing |
| 43 | lafb | LAFB | axis ≤ −45°, qR in aVL, rS in II/III/aVF, QRS < 120 |
| 44 | lpfb | LPFB | axis ≥ +90°, rS in I/aVL, qR in III/aVF, QRS < 120 |
| 45 | rbbb_lafb | RBBB + LAFB | RBBB criteria + axis ≤ −45° |
| 46 | rbbb_lpfb | RBBB + LPFB | RBBB criteria + axis ≥ +90° |
| 47 | trifasc | Bifascicular block with 1st-degree AV block ("trifascicular") | RBBB + axis ≤ −45° + PR > 200 |
| 48 | lbbb_1avb | LBBB with 1st-degree AV block | LBBB criteria + PR > 200 |
| 49 | ratelbbb | Rate-related LBBB | the rate rises mid-strip; QRS < 120 before, ≥ 120 with LBBB shape after |
| 50 | altbbb | Alternating bundle branch block | consecutive beats alternate RBBB and LBBB shapes |
| **Pre-excitation** ||||
| 51 | wpw | WPW, left lateral pathway | existing |
| 52 | wpw_ps | WPW, posteroseptal pathway | short PR, delta wave, delta net negative in III/aVF |
| 53 | wpw_int | Intermittent pre-excitation | some beats short PR and wide, others normal PR and narrow |
| 54 | afpre | Pre-excited AF | irregular, wide QRS with varying width, some RR < 250 ms |
| **Ventricular** ||||
| 55 | pvc | PVC (LV) | existing |
| 56 | pvc_rvot | PVC from the RV outflow tract | QRS ≥ 120, V1 negative (LBBB-like), net positive in II/III/aVF |
| 57 | vbig | Ventricular bigeminy | every other beat a PVC |
| 58 | vtrig | Ventricular trigeminy | every third beat a PVC |
| 59 | couplet | Ventricular couplet | two consecutive PVCs |
| 60 | fusion | Fusion beat | one beat narrower than the PVC and wider than sinus, with a P before it |
| 61 | aivr | Accelerated idioventricular rhythm | wide regular 50–110, P unrelated |
| 62 | idiov | Idioventricular escape rhythm | no P waves, wide regular 20–40 |
| 63 | vt | Monomorphic VT (scar) | existing |
| 64 | vt_rvot | RVOT VT | wide regular > 120/min, LBBB-like V1, inferior axis |
| 65 | vt_fasc | Fascicular VT | regular, QRS 110–150, rSR′/RsR′ in V1, axis ≤ −30° |
| 66 | nsvt | Non-sustained VT | 3–10 consecutive wide fast beats inside sinus rhythm |
| 67 | tdp | Torsades de pointes | long QT on the sinus beats, then wide beats whose axis turns ≥ 180° across the run |
| 68 | vf | Ventricular fibrillation | no two consecutive deflections alike (irregular peaks, no isoelectric line) |
| **Paced** ||||
| 69 | aai | Atrial pacing | spike before each P, normal QRS |
| 70 | vvi | RV apical pacing | spike before each wide QRS, LBBB-like V1, axis ≤ −30° |
| 71 | ddd | Dual-chamber pacing | atrial spike, P, AV interval, ventricular spike, wide QRS |
| 72 | biv | Biventricular pacing | spike, QRS narrower than VVI, net negative in I |
| 73 | capfail | Failure to capture | some ventricular spikes not followed by a QRS |
| **Repolarisation and leads** ||||
| 74 | peakedt | Peaked T (early hyperkalaemia) | T in V2–V4 taller and narrower than NSR's (text: later signs not modelled) |
| 75 | longqt | Long QT | QTc > 480 |
| 76 | shortqt | Short QT | QTc < 340 |
| 77 | lareversal | LA/RA electrode reversal | lead I inverted (P, QRS, T negative); II and III swapped; aVR and aVL swapped; aVF unchanged; by lead algebra on the NSR leads, labelled as such |
| 78 | highv12 | V1–V2 placed one space too high | V1/V2 show rSr′ and a negative P, from electrode positions moved up 20 mm |

**Changed at build time:**
- Compare in 3D overlays two views behind the split, the same way as the schematic, not scissor viewports.
- 12-lead compare stacks A's 3×4 grid above B's.
- LBBB's axis comes out at about −50°. LBBB with left axis is common; its criteria are about morphology, not axis.

**Cut at build time:**
- `lpfb` and `rbbb_lpfb`. An orientation search over frontal angle, tilt, roll and fascicle territories found no heart
  that gives LPFB ≥ +90° while LBBB keeps a monophasic R in I/V5/V6. The best was +68°, and LBBB and its spin-offs
  were kept instead.
- `afltrev` (reverse typical flutter): reversing the circuit leaves the flutter waves net negative in II/III/aVF in
  this model, so the teaching feature (positive inferior flutter waves) can't be shown.
- The NSR axis criterion is the clinical normal (−30° to +90°). The heart gives about +16°.

Duplicate checks: an escape *rhythm* (27, 62) is the whole strip, while a single escape *beat* ends a pause (5).
Complete block (38, 39) has sinus P waves; the escape rhythms have none.

"Existing" means the criterion in today's `heartrhythms.test.js`.

## The page (`site/heart.html`, replaces the current one)

```
[≡ Left anterior fascicular block ▾ (search 78)] [Compare ▢]  View: [Close-up|Strip|12-lead] [Ladder ▢]
┌ tracing (mode-dependent) ───────────────────────────────┐ ┌ Educational panel ──────┐
│ close-up: 3 leads with pickers, 100 mm/s, ±600 ms around │ │ What's happening (why)   │
│ cursor; strip: lead II 8 s at 25 mm/s; 12-lead 3×4       │ │ ECG features (looks)     │
│ P/PR/QRS/ST/T chips; ladder A / AV / V when on           │ │ Clinical takeaways       │
└──────────────────────────────────────────────────────────┘ │ See a real one →         │
 ▶ ⟲ ━━━━●━━━━ 8 s   [0.1 0.2 0.5 1×]  "463 ms after SA node fires"            └──────────┘
 Caption: "T wave: ventricular repolarisation, starting at the epicardium…"
┌ Heart: [Slice|3D|Torso]  section [4-chamber|Short axis ─●─]  colour [State|Activation time]   ┐
│ schematic / 3D canvas          ① ② ③ action-potential plots   legend   frontal + horizontal  │
│ [Conduction system ▣] [Heart vector ▣]                                     vector diagrams     │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Picker:** a modal dialog (native `<dialog>`) with a search box and the rhythms grouped by
  category. The trigger reads "Search N rhythms", where N is the count actually shipped. Arrow keys and
  Enter work.
- **Tracing:** same paper and code as now (`ecgplot.js`, one SVG in mm), with mode-dependent
  panels:
  - **Close-up:** three leads (default I, V1, V6, each with a lead `<select>`) at 100 mm/s
    over a window that follows the cursor. Its label reads "100 mm/s · 10 mm/mV · one small box is
    10 ms".
  - **Strip:** lead II over the full strip at 25 mm/s.
  - **12-lead:** 3×4 at 25 mm/s.

  A scale label, chips that highlight the wave bands from the events, and the ladder sit under
  the tracing when on.
- **Playback:**
  - play/pause, replay, scrubber, speeds 0.1/0.2/0.5/1×;
  - a clock "N ms after SA node fires". For non-sinus beats it uses the latest atrial (or
    ventricular, when there is no atrial) origin event, with the matching wording;
  - the phase caption (existing `eventAt` texts);
  - hash state: rhythm, compare rhythm, view, speed, time, heart mode.
- **Heart, Slice mode (default):**
  - the schematic: SVG chamber outlines and labels (RA, LA, RV, LV) and the conduction system
    (SA node, Bachmann's bundle, AV node, His, RBB, LBB, anterior and posterior fascicles,
    Purkinje), lit as the impulse passes and ✕ where cut;
  - an accessory pathway when present;
  - a wavefront arrow from the mean front direction in the slice.

  The section control switches between four-chamber and short axis, with a base→apex slider.
- **Heart, 3D mode:** three.js (loaded only then), a smooth surface (surface nets on the shape's
  distance field) coloured per vertex from the nearest voxel. Sections: outside, four-chamber
  cut, short-axis cut (slider). The conduction system is drawn as tubes, and an optional
  heart-vector arrow.
- **Torso mode:** the same 3D heart inside a translucent torso, with labelled RA, LA, LL, RL and V1–V6
  electrodes and the heart vector.
- **Colour modes:** electrical state (resting, depolarising front, depolarised, repolarising,
  conduction system), or activation time (isochrones colour scale with ms legend).
- **Numbered sites ①②③:** RA, septum and LV lateral wall, each with its action-potential trace
  (+20 to −90 mV, a synthetic AP shape timed by that voxel's activation and recovery) and a cursor.
- **Vector diagrams:** frontal (hexaxial I, II, III, aVR, aVL, aVF) and horizontal (V1–V6) planes.
  Each shows the loop traced so far this beat and the current vector arrow.
- **Compare:** a second rhythm picker. The tracing stacks A then B in the same mode. The heart
  pane shows A and B in the same view, overlaid with a draggable vertical split (A left of the
  divider, B right). Both share the clock.

Phones: the panels stack; the picker is full-screen; the compare split still works by touch.

## Model changes

- **`heartshape.js` (new, DOM-free):**
  - the shape parameters and signed-distance functions per chamber wall;
  - `buildHeart()` → the existing graph JSON format (pos, chamber, area = voxel volume,
    purkinje regions, lines, links, landmarks, electrodes, centre), voxelised at 2 mm, plus the
    lattice index for slicing;
  - `slicePlane()` → pixel → voxel map;
  - `outline()` → SVG paths for the four-chamber plane.

  Landmarks are named points on the shapes: SA node, AV node, His, bundle and fascicle paths, foci
  (RVOT, LV, high RA, LA, low RA), accessory pathways (left lateral, posteroseptal), VT scar and
  exit, flutter ring and CTI.
- **`heartsim.js` extensions:**
  - extra fast links (Bachmann's bundle);
  - atrial foci and per-beat sites;
  - a sinus cycle list;
  - SA exit block; PACs / PJCs with sites;
  - per-beat bundle refractoriness (aberrancy, rate-related and alternating BBB);
  - pacing (atrial / RV / biventricular sources, spike markers in the events);
  - polymorphic VT (exit cycling through sites);
  - VF (ventricular wavelets, as AF);
  - APD per rhythm; limb-lead reversal.
- **CHAMBER_WEIGHT** is retuned for volume weights; the vector model is otherwise the same.

## Review resolutions (builder check, 25 items)

- **Build phases (one branch, each gated by tests passing before the next):**
  - **(a)** heart + engine on voxels; the 17 existing rhythms + LAFB + LPFB pass.
  - **(b)** the page: schematic, picker, three tracing modes, playback, clock, educational panel.
  - **(c)** compare, vector diagrams, AP sites, 3D, torso.
  - **(d)** the remaining rhythms, category by category.
- **Axis is a geometry requirement (phase a gate).** It is found by search over orientation and fascicle territories,
  and the chosen values are recorded in `SHAPE`. The two anatomical choices that made it work:
  - the RBB gives no septal branches above the apical third, so the right septal surface is activated from the
    apex up, not all at once;
  - the anterior fascicle's territory includes the anterior septum.

  With both, activation of a blocked territory sweeps one way instead of converging from both edges.
- **Front contributions** are weighted by the activation-time gradient × muscle velocity (capped at 1). Tissue swept
  almost at once by the Purkinje network contributes little, since a front's dipole integral is ∝ ∇τ.
- **AV insulation:** no muscle edge joins atrial and ventricular voxels (the existing chamber-group rule, plus a
  3 mm gap). A test checks it.
- **RVOT:** the RV gets an outflow cone towards the pulmonary valve (up, left, forward) with its own landmark, so RVOT
  ectopy has an inferior axis.
- **Ladder:** an optional SA row (sinus rhythms with SA block or arrest), and an AP lane when a pathway exists.
- **Clock wording:**
  - "N ms after SA node fires" (sinus);
  - "after the atrial focus fires" (focal or flutter);
  - "after the junction fires";
  - "after the ventricular focus fires";
  - "after the pacing spike";
  - none in AF/VF, where the caption says why.
- **Schematic conduction system:** projected onto the four-chamber plane and labelled as a projection. The ✕ is always
  drawn. In short axis, only the bundle or fascicle crossings at that level are shown. The canvas fill is clipped to
  the analytic outlines.
- **Compare:**
  - one clock and one shared view and mode;
  - a clock label per side;
  - 3D uses one renderer with two scissor viewports;
  - 12-lead compare shows six leads per rhythm (I, II, III, V1, V4, V6).
- **atlasEcg** is optional. The test checks only rows that set it.
- **Speed:** the worst-case rhythm (VF) must simulate in under 5 s in Node; the time is logged. The heart is built
  once per page, and wavefronts are memoised by source signature.
- **Old hashes:** unknown keys (`whatif=`) are ignored. Kept: reduced motion starts paused, Space plays, ←/→ step 10 ms.
- **"Labels"** means both the wave chips and P/QRS/T letters drawn above the close-up trace at each wave's peak.
- **Titles:** they live in `rhythms.json` (all 7 languages). The texts are English, with the old 17 keeping their
  translations.

## Acceptance checks

- `tests/heartrhythms.test.js` keeps every existing criterion, re-run on the new heart, and adds:
  - NSR axis 30°–90°;
  - LAFB ≤ −45° with qR in aVL / rS in II, III, aVF;
  - LPFB ≥ +90° with rS in I;
  - bifascicular = both sets;
  - one criterion per new rhythm (rate, regularity, PR, width, P polarity, ratio, or the named
    morphology).
- `heartshape.test.js`:
  - the heart is watertight per chamber;
  - every landmark sits in its wall;
  - the slice map hits only wall voxels;
  - the outline paths are closed.
- **Speed:** building the heart < 1 s and one rhythm < 1.5 s in Node on the dev machine. A
  test asserts the build bound.
- i18n tests: every rhythm has a title in all 7 languages and en texts; every category label is
  translated.

## Files

- New: `site/js/heartshape.js`, `site/js/heartschematic.js` (DOM: slice canvas and SVG),
  `site/js/heartpicker.js` (DOM), `tests/heartshape.test.js`.
- Changed:
  - `heartsim.js`;
  - `heartview.js` (procedural surface, torso);
  - `heartapp.js`, `heart.html`, `style.css`;
  - `heartstate.js` (hash: compare, mode, section; what-if removed);
  - `rhythms.json` (+ `category`, `takeaways`);
  - i18n, README, CLAUDE.md.
- Deleted:
  - `site/heart/heart.glb`, `site/heart/heart-graph.json` and `site/heart/LICENSE.txt`;
  - `pipeline/heart_export.py`, `pipeline/heart_landmarks.json`, `pipeline/heartlib.py` and its
    test;
  - the `heart` command in `make_atlas.py`.

## Non-goals

- Ischaemia and infarction (ST injury currents), and drugs beyond the APD knob.
- Realistic anatomy. The heart is deliberately a schematic.
- Translating the 61 new rhythm texts into 6 languages in this round.
