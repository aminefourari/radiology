<img src="assets/icon.svg" width="64" height="64" alt="">

# CT Anatomy Atlas

An open, multilingual web atlas of cross-sectional anatomy on real CT scans. Pick a region (head,
neck, chest, abdomen & pelvis, lower limb, hands) and scroll through it in axial, coronal or sagittal view. Switch coloured
structures on and off by system, read the labels, and jump to key levels such as the lateral
ventricles, the thyroid cartilage or the celiac trunk.

It's for medical students, doctors, and anyone learning anatomy. **Educational use only — not
for diagnosis.** The labels are generated automatically and reviewed by the community. If
you spot a mistake, use "Report a problem" on the structure.

![Axial slice at the celiac trunk with liver segments, vessels and labels](assets/screenshot.png)

The landing page links both atlases. The CT atlas is `ct.html`. The **ECG atlas** (`ecg.html`) has 29 real
12-lead ECGs from PTB-XL, grouped by rhythm, conduction, hypertrophy, ischaemia and more, drawn as
sharp vector graphics on standard paper, with 3×4 or 12×1 layouts, speed and gain, calipers,
P, QRS, ST and T wave shading (each on or off), and a quiz mode that hides the diagnosis until you open the interpretation.
It teaches how to *find* the pathology:

- **Study:** under each tracing, a reading card walks the same steps every time (rate, rhythm,
  axis, PR, QRS, QTc, ST) with the measured value, the normal range and a verdict, followed by
  clues for the pathology. Tapping a clue lights up the leads that show it.
- **Learn:** a scored checklist on a random ECG. Answer each step, get feedback with the
  measurement and a teaching note, then pick the diagnosis from four.

Languages: English, Deutsch, Español, العربية, Français, Italiano, Nederlands.

## Run it locally

```sh
python3 -m http.server -d site 8000   # then open http://localhost:8000
```

There's no build step and there are no dependencies. `site/` is the whole website.

## Deploy

Upload `site/` to any static host (GitHub Pages, Cloudflare Pages, Netlify, …). Each case is
3–20 MB compressed and loads in the browser.

## Tests

```sh
npm test                      # viewer modules (Node built-in test runner, no npm install needed)
uv venv -p 3.12 .venv && uv pip install -p .venv -r pipeline/requirements.txt
.venv/bin/pytest pipeline -q  # case pipeline
```

## Adding a case, fixing a label, adding a language

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits and licences

- CT data and segmentations come from the **TotalSegmentator dataset**
  ([doi:10.5281/zenodo.6802613](https://doi.org/10.5281/zenodo.6802613)), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Case `s0010` uses that dataset's
  masks, plus Couinaud liver segments generated with the open `liver_segments` model from
  [TotalSegmentator](https://github.com/wasserth/TotalSegmentator) (Apache-2.0).
  The other cases add masks from more TotalSegmentator models, listed per case in
  `pipeline/cases/<id>.json` (`tasks`) and in each case's `meta.json` (`source.tasks`). Open
  models (Apache-2.0): `ventricle_parts`, `head_glands_cavities`, `oculomotor_muscles`,
  `headneck_bones_vessels`, `head_muscles`, `headneck_muscles`, `lung_vessels`. Licensed models:
  `brain_structures` (head `s1508`), `heartchambers_highres` (chest `s0739`) and
  `appendicular_bones` (lower limb `s0783`, hands `s1489`). Their author, Jakob Wasserthal, gave permission on
  2026-11-19 to publish their outputs in this free, non-commercial atlas. Rebuilding those
  cases needs your own TotalSegmentator licence key; the others build with open models only.
- ECGs come from **PTB-XL** (Wagner et al., PhysioNet,
  [doi:10.13026/kfzx-aw45](https://doi.org/10.13026/kfzx-aw45)), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Interpretations are the dataset's
  cardiologist-validated SCP-ECG statements. P/QRS/T boundaries come from **PTB-XL+**
  ([doi:10.13026/g6h6-7g88](https://doi.org/10.13026/g6h6-7g88), CC BY 4.0), computed
  automatically by ECGDeli. P bands are hidden for AF, flutter, SVT and 2nd/3rd-degree AV block.
  The reading card's measurements are PTB-XL+'s GE 12SL features (same DOI, CC BY 4.0). Clues are
  teaching notes reviewed by the community: use "Report a problem" next to any clue.
- Code: [MIT](LICENSE).
