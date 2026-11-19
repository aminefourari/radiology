# Contributing

Thanks for helping make the atlas more accurate. Most fixes are edits to JSON files.

## Report a problem

In the atlas, tap a structure (or open **Structures**) and choose **Report a problem**. A GitHub
issue opens with the case, structure, plane, slice and a link to the exact view. Just add what's
wrong.

## Fix a name or a translation

- **Structure names** live in `pipeline/structures.json` (`names.<lang>`). Edit them, then
  rebuild the affected cases (see below) so `site/cases/<id>/meta.json` picks up the change.
  For a quick fix you can also edit `names` in `meta.json` directly, but the next rebuild will
  overwrite it unless `structures.json` is fixed too.
- **Interface text** lives in `site/i18n/<lang>.json`. A missing key falls back to English.

## Add a language

1. Copy `site/i18n/en.json` to `site/i18n/<code>.json` and translate it.
2. Add `{"code": "<code>", "name": "<native name>"}` to `site/i18n/index.json`. Add
   `"dir": "rtl"` for right-to-left scripts. The scan is never mirrored.
3. Add `<code>` to the `names` of each structure in `pipeline/structures.json`, and to the key
   levels and title in `pipeline/cases/<id>.json`. Then rebuild the cases.
4. Run `npm test`. It checks that no language file has keys that `en.json` lacks.

## Drop, recolour or regroup a structure

Edit or delete its entry in `pipeline/structures.json` (`system`, `color`, `parent`). Order
matters: later entries paint over earlier ones, so liver segments come after `liver`. Then
rebuild.

## Move a key level

Key levels are axial slice indices (0-based, counted from the bottom of the exported volume) in
`pipeline/cases/<id>.json`. The viewer shows them 1-based, so subtract 1 from what the slice
counter says. Then rebuild.

## Rebuild or add a case

```sh
uv venv -p 3.12 .venv && uv pip install -p .venv -r pipeline/requirements.txt

# Fetch one case from the 35 GB TotalSegmentator zip without downloading all of it:
.venv/bin/python - <<'EOF'
from remotezip import RemoteZip
url = "https://zenodo.org/api/records/22688904/files/Totalsegmentator_dataset_v300.zip/content"
case = "s0010"
with RemoteZip(url) as z:
    for n in z.namelist():
        if n.startswith(f"Totalsegmentator_dataset_v300/{case}/") and n.endswith(".nii.gz"):
            z.extract(n, "data/ts")
EOF

# Build it (on a Mac, --device mps runs the liver-segment model on the GPU in minutes):
.venv/bin/python pipeline/make_case.py data/ts/Totalsegmentator_dataset_v300/s0010 s0010 --device mps
```

`make_case.py` writes `site/cases/<id>/`, updates `site/cases/index.json`, and fails if the case
is over 25 MB or inconsistent. Use `--voxel-mm 2` or `--z-range LO:HI` to shrink a large case.
For a new case, also create `pipeline/cases/<id>.json` with its `title` and `keyLevels`.

## Adding an ECG

Add `{"id": <PTB-XL ecg_id>, "group": "rhythm|conduction|hypertrophy|ischaemia|other|normal", "title": {"en": …, …}}`
to `pipeline/ecgs.json`, then:

```sh
.venv/bin/python pipeline/make_ecg.py   # downloads only the listed records, writes site/ecg/
```

It also fetches each record's wave boundaries from PTB-XL+. If a new rhythm has no regular P waves,
add its SCP code to `NO_P_CODES` in `make_ecg.py`.

Pick records with `validated_by_human` set and no noise flags in `ptbxl_database.csv`.

## Tests

```sh
npm test
.venv/bin/pytest pipeline -q
```
