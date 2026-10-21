# BathyMap

BathyMap publishes raw bathymetry survey data as an interactive map with GitHub Pages. The data sits in this
repository, and the website lets anyone explore and download it. Every time a new file is pushed to the `data/` folder, a GitHub Actions workflow
rebuilds the map, so the website always shows everything in the repository.

The website lets visitors:

- see every survey line on a street map or satellite basemap, grouped by survey day;
- zoom in to the individual soundings, coloured by depth, and hover or tap one to read its depth, date, time (to a
  hundredth of a second, as logged) and position;
- draw a box or a polygon on the map and download every sounding inside it as a CSV;
- see the platform and sensor that collected each line;
- download each line as the original instrument file (`.dep`) or as a CSV with decimal-degree coordinates;
- download every line in one CSV;
- link straight to a line (the address ends with `#<line id>` when a line is selected).

## Adding new data

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

1. Create the survey folder and copy the instrument's `.dep` files into it. Keep the original file names.
2. If the survey's platform or sensor differs from the defaults, add a `metadata.json` to the folder. If a single
   file differs, add a `.json` with the same name as that file (see below).
3. Commit and push to `main`.
4. Wait a minute or two. The **Actions** tab shows the build; when it turns green, the map is up to date.

A few rules keep things working:

- Use lowercase letters, digits and hyphens in folder names; avoid spaces.
- Don't rename or move a file once it is published. The folder and file name form the line's identifier, which is used
  in shared links (`…/#2026-10-16__L0001_2026-10-16-00-24-42`) and in the download file names.
- The website groups lines by the survey date and area name recorded inside each file, not by folder, so the folders
  are only for keeping the repository tidy. Any depth of sub-folders works.

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

## One-time setup on GitHub

1. Create a repository (public, unless your plan supports Pages for private repositories) and push this folder to its
   `main` branch.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Push a commit, or run the workflow by hand from **Actions → Build and publish the bathymetry map → Run workflow**.
   The website address appears in the workflow summary and in Settings → Pages
   (normally `https://<user-or-organisation>.github.io/<repository>/`).

## How it works

```
data/*.dep  ──►  BathyMap build (Python, runs in GitHub Actions)  ──►  _site/  ──►  GitHub Pages
                 • converts DMS coordinates to decimal degrees           index.html, app.js, style.css
                 • removes invalid soundings                             data/index.json      (line list, stats, tracks)
                 • thins each line for the map                           data/points/*.json   (map soundings, each with its time)
                 • writes CSV files and copies the raw files             data/csv/*.csv, data/raw/**, data/all_lines.csv
```

- `BathyMap/site_builder.py` reads the CHC `.dep` files and writes the website data. It is configured by
  `1_site_config.json`.
- `site/` is the website template (Leaflet map). It is copied into `_site/` on every build.
- `.github/workflows/build-pages.yml` installs BathyMap, runs the tests, builds `_site/` and publishes it.
- `_site/` is never committed; it is rebuilt every time.

## Exporting an area from the map

The two buttons under the zoom controls select soundings:

- **Box**: press, drag and release over the soundings.
- **Polygon**: click or tap each corner, then click the first corner, double-click, or press **Finish**.

The bar at the top of the map then shows how many soundings were selected, from how many lines, their depth range and
the time span, with a **Download CSV** button. Esc cancels a shape that is being drawn.

The export always contains the complete record of every selected sounding, even where the map shows a thinned line:
it is cut from the full CSV of each line. The columns are the same as in `data/all_lines.csv`: `Line`, `Datetime`,
`Latitude`, `Longitude`, `Depth`, `Platform`, `Sensor`, followed by every other column of the original file. Lines hidden with their
checkbox are left out of the selection.

## Configuration (`1_site_config.json`)

All paths are relative to the JSON file.

| Key | Default | What it does |
| --- | --- | --- |
| `data_directory` | required | Folder with the raw files. |
| `site_template_directory` | `site` | Website template copied into the output. |
| `output_directory` | `_site` | Where the website is written. It is emptied on each build (only if a previous build created it). |
| `site_title`, `site_description` | | Shown in the header and the About section. |
| `organisation`, `contact`, `licence` | empty | Shown in the About section when set. |
| `repository_url` | read from GitHub Actions | Adds a "Data repository" link to the header. |
| `file_extensions` | `[".dep"]` | File types read from the data folder. |
| `accepted_gps_states` | `[]` (keep all) | For example `[4]` keeps RTK-fixed soundings only. |
| `max_map_points_per_line` | `3000` | Soundings drawn on the map per line. Downloads always contain every sounding. |
| `max_track_points_per_line` | `200` | Points in the simplified track drawn when zoomed out. |
| `copy_raw_files` | `true` | Copies the raw files into the website. Set to `false` to link to the files in the repository instead, which halves the size of the website. |
| `write_combined_csv` | `true` | Writes `data/all_lines.csv` with every line. |
| `survey_metadata` | `{}` | Metadata applied to every line before the `metadata.json` files are read. |
| `metadata_file_name` | `metadata.json` | Name of the per-folder metadata files. |
| `depth_colour_range` | automatic | `[min, max]` in metres for the colour scale; automatic uses the 2nd to 98th percentile of all depths. |
| `time_reference` | `as logged by the instrument` | Describes the clock used for the times, for example `UTC` or `Eastern Time`. |
| `depth_reference` | `as logged by the instrument` | Describes what the depths are measured from, for example `below water surface, transducer draft applied`. |

## Building and previewing on your own computer

```
pip install -e .
BathyMap build -f 1_site_config.json
python -m http.server -d _site 8000
```

Then open http://localhost:8000. Opening `_site/index.html` directly from disk does not work, because browsers
block the data files from loading that way.

Run the tests with `pytest` from the repository root.

## What is cleaned

Soundings are removed when the depth is missing or not positive, a coordinate is missing or out of range, or (when
`accepted_gps_states` is set) the GPS state is not accepted. The build log in GitHub Actions reports how many soundings
were removed from each file. The raw file download is always the untouched original.

GPS states follow the NMEA convention used by the receiver: 1 = GPS, 2 = DGPS, 4 = RTK fixed, 5 = RTK float.

## Limits to keep in mind

GitHub recommends keeping a repository under 1 GB, and a published Pages site cannot exceed 1 GB. Single files over
100 MB are rejected by Git. With `copy_raw_files` on, the website holds roughly three times the size of the raw data
(raw copy, CSV and map points); turn it off when the archive grows. For a much larger archive, keep the raw files in
GitHub Releases or a DOI archive such as Zenodo and keep this repository for the map.
