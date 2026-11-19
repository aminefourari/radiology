<img src="assets/icon.svg" width="64" height="64" alt="">

# CT Anatomy Atlas

An open, multilingual web atlas of cross-sectional anatomy on real CT scans. Scroll through a
scan in axial, coronal or sagittal view. Switch coloured structures on and off by system (organs,
Couinaud liver segments, digestive, urinary, pelvis, spine, arteries, veins), read the labels, and
jump to key levels such as the celiac trunk or the renal veins.

It's for medical students, doctors, and anyone learning anatomy. **Educational use only — not
for diagnosis.** The labels are generated automatically and reviewed by the community. If
you spot a mistake, use "Report a problem" on the structure.

![Axial slice at the celiac trunk with liver segments, vessels and labels](assets/screenshot.png)

The **ECG atlas** (`ecg.html`) is a separate page with real 12-lead ECGs from PTB-XL: classic
patterns (normal, MI, bundle branch blocks, AF, flutter, LVH, AV block, WPW) on standard paper,
with 3×4 or 12×1 layout, speed and gain, calipers for intervals and rate, and a quiz mode that
hides the diagnosis until you open the interpretation.

Languages: English, Deutsch, Español, العربية, Français, Italiano, Nederlands.

## Run it locally

```sh
python3 -m http.server -d site 8000   # then open http://localhost:8000
```

There's no build step and there are no dependencies. `site/` is the whole website.

## Deploy

Upload `site/` to any static host (GitHub Pages, Cloudflare Pages, Netlify, …). Each case is
about 21 MB and loads in the browser.

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
- ECGs come from **PTB-XL** (Wagner et al., PhysioNet,
  [doi:10.13026/kfzx-aw45](https://doi.org/10.13026/kfzx-aw45)), licensed
  [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Interpretations are the dataset's
  cardiologist-validated SCP-ECG statements.
- Code: [MIT](LICENSE).
