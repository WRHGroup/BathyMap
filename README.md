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

1. Copy the `.dep` files exported from the instrument into `data/`. Sub-folders are fine and are a good way to keep
   things tidy, for example one folder per survey day: `data/2026-10-16/L0001_2026-10-16-00-24-42.dep`.
2. If the data comes from a platform or sensor that is not yet described, add a `metadata.json` to its folder (see
   below).
3. Commit and push to `main`.
4. Wait a minute or two. The **Actions** tab shows the build; when it turns green, the map is up to date.

Nothing else needs to change. Files are found by extension, so the folder layout is up to you.

## Describing the platform and sensor

Each line is labelled with the platform and sensor that collected it. They are read from `metadata.json` files in the
data folder. A file applies to its own folder and every folder inside it, and a file deeper down overrides the entries
of one higher up. The repository starts with `data/metadata.json`, which describes the current data:

```json
{
    "platform": "CHCNAV Apache 4",
    "platform_type": "Uncrewed surface vessel (USV)",
    "sensor": "Apache 4 single-beam echosounder"
}
```

When data from another platform arrives, put it in its own folder with its own `metadata.json`, for example
`data/kayak-2027/metadata.json`. `platform`, `platform_type` and `sensor` have their own rows in the line details;
any other entry you add (for example `operator`, `project` or `notes`) is shown there too. Platform and sensor are also
written as columns in every CSV download, so exported data keeps its provenance. If no platform is given, the instrument
model recorded in the file header is used.

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
