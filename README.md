# BathyMap

BathyMap publishes raw bathymetry survey data as an interactive map with GitHub Pages. The raw data lives in `data/`,
the published website lives in `docs/`, and GitHub Pages serves `docs/` straight from the `main` branch. There is no
GitHub Actions workflow to maintain: you build the website on your own computer with one command and push it.

The website lets visitors:

- see every survey line on a street map or satellite basemap, grouped by survey day;
- zoom in to the individual soundings, coloured by depth, and hover or tap one to read its depth, date, time (to a
  hundredth of a second, as logged) and position;
- draw a box or a polygon on the map and download every sounding inside it as a CSV;
- see the platform and sensor that collected each line;
- download each line as the original instrument file (`.dep`) or as a CSV with decimal-degree coordinates;
- download every line in one CSV;
- link straight to a line (the address ends with `#<line id>` when a line is selected).

## One-time setup

### On your computer

You need Python 3.9 or newer and Git. In a terminal, inside this folder, install BathyMap once:

```
pip install -e .
```

The `-e` keeps the installed command linked to this folder, so later changes to the code take effect without
reinstalling. Check that it works with `BathyMap build -f 1_site_config.json`; it prints one block per data file and
ends with "website written to ...".

### On GitHub

1. Create a repository named `bathymap` (public, unless your plan supports Pages for private repositories). Leave the
   README, .gitignore and licence options unticked.
2. Open `1_site_config.json` and set `repository_url` to the repository address, for example
   `https://github.com/<owner>/bathymap`. This adds a "Data repository" link to the website.
3. Push this folder:

   ```
   git init -b main
   git add .
   git commit -m "First version of BathyMap"
   git remote add origin https://github.com/<owner>/bathymap.git
   git push -u origin main
   ```

4. In the repository, open **Settings → Pages**. Under **Build and deployment**, set **Source** to
   **Deploy from a branch**, then choose branch **main** and folder **/docs**, and click **Save**.
5. After a minute or two the address appears at the top of the Pages settings, normally
   `https://<owner>.github.io/bathymap/`.

## Adding new data

Every time you have new data:

1. Copy the files into a survey folder in `data/` (see the structure below), with a `metadata.json` or per-file
   `.json` if the platform, sensor or other details differ.
2. Rebuild the website:

   ```
   BathyMap build -f 1_site_config.json
   ```

3. Commit and push both the data and the rebuilt `docs/` folder:

   ```
   git add data docs
   git commit -m "Add survey 2026-11-03"
   git push
   ```

GitHub Pages republishes `docs/` a minute or two after the push. If new files are in the repository but not on the
map, step 2 was skipped: run the build and push again.

The build log is worth a glance before pushing. It lists each file with its platform, sensor, number of soundings and
depth range, and reports any soundings it removed (see "What is cleaned").

### Recommended folder structure

Keep one folder per survey (usually one per survey day), named with the date first so folders sort in time order, and
drop the raw files in unchanged:

```
data/
├── metadata.json                         defaults for all data (platform, sensor)
├── 2026-10-16/
│   ├── L0001_2026-10-16-00-24-42.dep
│   └── L0002_2026-10-16-00-52-33.dep
└── 2026-11-03_credit-river/
    ├── metadata.json                     overrides for this survey only
    ├── L0001_2026-11-03-14-02-10.dep
    ├── L0002_2026-11-03-14-40-55.dep
    └── L0002_2026-11-03-14-40-55.json    overrides for this one file only
```

A few rules keep things working:

- Use lowercase letters, digits and hyphens in folder names; avoid spaces.
- Don't rename or move a file once it is published. The folder and file name form the line's identifier, which is used
  in shared links (`…/#2026-10-16__L0001_2026-10-16-00-24-42`) and in the download file names.
- The website groups lines by the survey date and area name recorded inside each file, not by folder, so the folders
  are only for keeping the repository tidy. Any depth of sub-folders works.
- Never edit files inside `docs/` by hand. The build empties and rewrites it every time; change `site/` (the template)
  or `1_site_config.json` instead.

## Describing the platform, sensor and other metadata

Each line is labelled with the platform and sensor that collected it, plus any other entries you want to record. They
come from JSON files in the data folder, merged from the general to the specific. A later level overrides only the
entries it sets and inherits the rest:

1. `survey_metadata` in `1_site_config.json` (empty by default).
2. `metadata.json` files, from the top of `data/` down to the file's own folder. Each applies to its folder and every
   folder inside it.
3. A `.json` file with the same name as the data file, for example `L0002_2026-11-03-14-40-55.json` next to
   `L0002_2026-11-03-14-40-55.dep`. It applies to that file only.

The repository starts with `data/metadata.json`, which describes the current data:

```json
{
    "platform": "CHCNAV Apache 4",
    "platform_type": "Uncrewed surface vessel (USV)",
    "sensor": "Apache 4 single-beam echosounder"
}
```

A per-file JSON only needs the entries that differ. For example, a line run with a different echosounder and a note:

```json
{
    "sensor": "Second single-beam echosounder",
    "notes": "Transducer remounted after line 1"
}
```

That line then shows platform `CHCNAV Apache 4` (from the folder or `data/` level) and the new sensor and notes.

`platform`, `platform_type` and `sensor` have their own rows in the line details; any other entry (for example
`operator`, `project`, `weather` or `notes`) is shown there too and can be searched with the line filter. Platform and
sensor are also written as columns in every CSV download, so exported data keeps its provenance. If no platform is
given at any level, the instrument model recorded in the file header is used.

## Exporting an area from the map

The two buttons under the zoom controls select soundings:

- **Box**: press, drag and release over the soundings.
- **Polygon**: click or tap each corner, then click the first corner, double-click, or press **Finish**.

The bar at the top of the map then shows how many soundings were selected, from how many lines, their depth range and
the time span, with a **Download CSV** button. Esc cancels a shape that is being drawn.

The export always contains the complete record of every selected sounding, even where the map shows a thinned line:
it is cut from the full CSV of each line. The columns are the same as in `data/all_lines.csv`: `Line`, `Datetime`,
`Latitude`, `Longitude`, `Depth`, `Platform`, `Sensor`, followed by every other column of the original file. Lines
hidden with their checkbox are left out of the selection.

## How it works

```
data/*.dep  ──►  BathyMap build (on your computer)  ──►  docs/  ──►  git push  ──►  GitHub Pages (main, /docs)
                 • converts DMS coordinates to decimal degrees    index.html, app.js, style.css
                 • removes invalid soundings                      data/index.json      (line list, stats, tracks)
                 • merges the metadata files                      data/points/*.json   (map soundings, each with its time)
                 • thins each line for the map                    data/csv/*.csv, data/all_lines.csv
                 • writes CSV files and copies the raw files      data/raw/**          (untouched originals)
```

- `BathyMap/site_builder.py` reads the CHC `.dep` files and writes the website. It is configured by
  `1_site_config.json`.
- `site/` is the website template (Leaflet map). It is copied into `docs/` on every build.
- `docs/` is the published website. It is generated, but it must be committed, because GitHub Pages serves it as it is
  in the branch. The `.nojekyll` file inside it tells Pages to publish the files without processing them.

## Configuration (`1_site_config.json`)

All paths are relative to the JSON file, which should stay at the top of the repository.

| Key | Default | What it does |
| --- | --- | --- |
| `data_directory` | required | Folder with the raw files. |
| `site_template_directory` | `site` | Website template copied into the output. |
| `output_directory` | `docs` | Where the website is written. It is emptied on each build (only if a previous build created it). Must match the Pages folder. |
| `site_title`, `site_description` | | Shown in the header and the About section. |
| `organisation`, `contact`, `licence` | empty | Shown in the About section when set. |
| `repository_url` | empty | GitHub address of the repository. Adds a "Data repository" link, and is needed when `copy_raw_files` is `false`. |
| `repository_branch` | `main` | Branch used for raw-file links when `copy_raw_files` is `false`. |
| `file_extensions` | `[".dep"]` | File types read from the data folder. |
| `accepted_gps_states` | `[]` (keep all) | For example `[4]` keeps RTK-fixed soundings only. |
| `max_map_points_per_line` | `3000` | Soundings drawn on the map per line. Downloads always contain every sounding. |
| `max_track_points_per_line` | `200` | Points in the simplified track drawn when zoomed out. |
| `copy_raw_files` | `true` | Copies the raw files into `docs/` so they download from the website. Set to `false` to link to the files in `data/` on GitHub instead, which keeps the published site smaller. |
| `write_combined_csv` | `true` | Writes `data/all_lines.csv` with every line. |
| `survey_metadata` | `{}` | Metadata applied to every line before the `metadata.json` files are read. |
| `metadata_file_name` | `metadata.json` | Name of the per-folder metadata files. |
| `depth_colour_range` | automatic | `[min, max]` in metres for the colour scale; automatic uses the 2nd to 98th percentile of all depths. |
| `time_reference` | `as logged by the instrument` | Describes the clock used for the times, for example `UTC` or `Eastern Time`. |
| `depth_reference` | `as logged by the instrument` | Describes what the depths are measured from, for example `below water surface, transducer draft applied`. |

## Previewing before you push

```
BathyMap build -f 1_site_config.json
python -m http.server -d docs 8000
```

Then open http://localhost:8000 and stop the server with Ctrl+C. Opening `docs/index.html` directly from disk does
not work, because browsers block the data files from loading that way.

Run the tests with `pytest` from the repository root (`pip install pytest` once).

## What is cleaned

Soundings are removed when the depth is missing or not positive, a coordinate is missing or out of range, or (when
`accepted_gps_states` is set) the GPS state is not accepted. The build log reports how many soundings were removed from
each file. The raw file download is always the untouched original.

GPS states follow the NMEA convention used by the receiver: 1 = GPS, 2 = DGPS, 4 = RTK fixed, 5 = RTK float.

## Limits to keep in mind

GitHub recommends keeping a repository under 1 GB, and a published Pages site cannot exceed 1 GB. Single files over
100 MB are rejected by Git.

Git stores identical files only once, so the raw copies in `docs/data/raw/` add nothing to the size of the repository.
The CSV and map files in `docs/` do add roughly two to three times the size of the raw data, and the published site
counts everything in `docs/`. When the archive grows large, set `copy_raw_files` to `false` to shrink the published
site. For a much larger archive, keep the raw files in GitHub Releases or a DOI archive such as Zenodo and keep this
repository for the map.
