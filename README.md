<img src="assets/icon.svg" width="64" height="64" alt="">

# CT Anatomy Atlas

A free, open, multilingual web atlas of anatomy on real CT scans, with a companion ECG atlas.
It's for medical students, doctors and anyone learning anatomy.

**Educational use only. Not for diagnosis.** Labels are generated automatically and reviewed by
the community. If you spot a mistake, use "Report a problem" on the structure.

![Axial CT at the celiac trunk: liver segments, pancreas, spleen, aorta and IVC, labelled](assets/screenshot.png)

## What's inside

**CT atlas** (`ct.html`)

- Six regions, each a real scan: head, neck, chest, abdomen & pelvis, lower limb, upper limb (hands & wrists).
- Scroll in axial, coronal or sagittal. Zoom, pan, and choose the window (soft tissue, lung, bone…).
- Coloured structures grouped by system (organs, liver segments, arteries, veins, spine…), each
  system toggled on and off, with labels pinned to the image.
- Key levels jump straight to landmarks such as the lateral ventricles, the thyroid cartilage or
  the celiac trunk.
- A rotatable 3D view of the labelled structures, loaded only when you open it.
- Every view has its own link, so you can share the exact slice.

**ECG atlas** (`ecg.html`)

- 29 real 12-lead ECGs from PTB-XL, grouped by rhythm, conduction, hypertrophy, ischaemia and more.
- Sharp vector tracings on standard paper: 3×4 or 12×1 layout, speed and gain, calipers, and
  P / QRS / ST / T shading, each on or off.
- **Study:** a reading card under each tracing walks rate, rhythm, axis, PR, QRS, QTc and ST, with
  the measured value, the normal range and a verdict, then clues for the diagnosis. Tap a clue to
  light up the leads that show it.
- **Learn:** a scored checklist on a random ECG, with feedback at each step, then pick the
  diagnosis from four.
- Quiz mode hides the diagnosis until you open the interpretation.

**How the ECG is made** (`heart.html`)

- A 3D heart depolarises and recovers in step with a simulated 12-lead ECG, a ladder diagram and a
  live caption, so each deflection has a visible cause.
- 16 rhythms: normal and sinus brady/tachycardia; 1st-degree, Mobitz I, Mobitz II and complete
  heart block; right and left bundle branch block; WPW; AVNRT and AVRT; atrial flutter and
  fibrillation; PVC; ventricular tachycardia. Each has a numbered "why", what it looks like on the
  ECG, and a link to a real tracing in the ECG atlas.
- Outside, four-chamber, short-axis and in-the-chest views (electrodes, heart vector, lead axis).
- What-ifs on the normal heart: cut a bundle, lengthen the AV delay, block the AV node, add an
  accessory pathway or an early beat.
- The tracing comes from the model, not a template: activation spreads over the heart mesh at
  real conduction speeds; the moving fronts add up to the heart vector; each lead is its
  projection. Tests check every rhythm against the ECG criteria it teaches.

**Languages:** English, Deutsch, Español, العربية, Français, Italiano, Nederlands.
Scans are always shown radiologically (patient right on the viewer's left), in every language.

## Run it locally

```sh
python3 -m http.server -d site 8000   # then open http://localhost:8000
```

No build step, no dependencies: `site/` is the whole website.

## Deploy

Upload `site/` to any static host (GitHub Pages, Cloudflare Pages, Netlify…). Each CT case is
3–20 MB compressed and loads in the browser.

## Tests

```sh
npm test                      # viewer modules (Node's built-in runner, no npm install)

uv venv -p 3.12 .venv && uv pip install -p .venv -r pipeline/requirements.txt
.venv/bin/pytest pipeline -q  # case pipeline
```

## How it's built

An offline Python pipeline (`pipeline/`) turns open-dataset CTs and their segmentations into
compact case files in `site/cases/`. The static site reslices and labels them in the browser.
ECGs are converted the same way into `site/ecg/`.

## Contributing

Adding a case, fixing a label or translation, adding a language: see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Credits and licences

- **CT data and segmentations:** the
  [TotalSegmentator dataset](https://doi.org/10.5281/zenodo.6802613),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Case `s0010` uses that dataset's
  masks plus Couinaud liver segments from the open `liver_segments` model of
  [TotalSegmentator](https://github.com/wasserth/TotalSegmentator) (Apache-2.0). The other cases
  add masks from more TotalSegmentator models, listed per case in `pipeline/cases/<id>.json`
  (`tasks`) and each case's `meta.json` (`source.tasks`).
  - Open models (Apache-2.0): `ventricle_parts`, `head_glands_cavities`, `oculomotor_muscles`,
    `headneck_bones_vessels`, `head_muscles`, `headneck_muscles`, `lung_vessels`.
  - Licensed models: `brain_structures` (head `s1508`), `heartchambers_highres` (chest `s0739`),
    `appendicular_bones` (lower limb `s0783`, hands `s1489`) and `thigh_shoulder_muscles` (lower
    limb `s0783`). Their author, Jakob Wasserthal, gave permission on 2026-11-19 to publish their
    outputs in this free, non-commercial atlas. Rebuilding those cases needs your own
    TotalSegmentator licence key; the others build with open models only.
- **ECGs:** [PTB-XL](https://doi.org/10.13026/kfzx-aw45) (Wagner et al., PhysioNet),
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Interpretations are the dataset's
  cardiologist-validated SCP-ECG statements. Wave boundaries and the reading card's measurements
  (ECGDeli and GE 12SL) come from [PTB-XL+](https://doi.org/10.13026/g6h6-7g88), CC BY 4.0.
  P bands are hidden for AF, flutter, SVT and 2nd/3rd-degree AV block. Clues are teaching notes
  reviewed by the community: use "Report a problem" next to any clue.
- **Heart model** (`site/heart/`): [Z-Anatomy](https://github.com/Z-Anatomy/Models-of-human-anatomy),
  CC BY-SA 4.0, from BodyParts3D (DBCLS, CC BY-SA 2.1 JP); see `site/heart/LICENSE.txt`.
- **Code:** [MIT](LICENSE).
