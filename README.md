# BathyMap

BathyMap publishes raw bathymetry survey data as an interactive map on GitHub Pages:
https://wrhgroup.github.io/BathyMap/

The raw files live in `data/`, and the website is built from them on your own computer with one command
(`BathyMap build`), which writes it to `docs/`. GitHub Pages serves `docs/` straight from the `main` branch, so publishing
an update means committing and pushing. There is no GitHub Actions workflow and no Jekyll theme.

## What visitors can do

- See where every survey is: labelled location markers when zoomed out, survey tracks closer in, and individual
  soundings from zoom level 15.
- Choose the basemap: OpenStreetMap (the default), satellite, street, topographic, light grey, dark grey or ocean.
  Place names and roads can be laid over any of them.
- Hover over or tap a sounding to read its depth, date, time (to a hundredth of a second, as logged) and position.
- Colour the soundings by water depth (the default) or by another column: bed elevation, GNSS height, time of day,
  distance along line, platform speed, roll, pitch or RTK correction age. The colour scale is fitted to the soundings
  in view or fixed for all data.
- Browse the lines in a list grouped by location and survey day. The list opens collapsed, can be filtered by location
  or by text, and has checkboxes that show or hide lines on the map one at a time or all at once.
- Open a line to see its statistics, platform, sensor and other metadata, and download it as the original `.dep`
  file or as a CSV with decimal-degree coordinates.
- Open any survey day in 3D: the measured soundings with an interpolated bed between them, to rotate and zoom, with an
  adjustable vertical exaggeration, and the interpolated bed as a CSV download.
- Draw a box or a polygon on the map and download every sounding inside it as a CSV.
- Download every line in one CSV, and share a link straight to a line (the address ends with `#<line id>`).
- Return to the full view with the **Zoom to all data** button under the zoom buttons.

## Repository layout

```
BathyMap/
├── 1_site_config.json      settings for the website (see "Configuration")
├── data/                   the raw survey files, organised in survey folders (see "Adding new data")
│   ├── metadata.json
│   └── 2026-10-16/
│       ├── L0001_2026-10-16-00-24-42.dep
│       └── L0002_2026-10-16-00-52-33.dep
├── docs/                   the published website, written by "BathyMap build"; never edit it by hand
├── site/                   the website template (index.html, app.js, style.css, and in site/vendor/ the Leaflet
│                           map library, the three.js 3D library and the fonts), copied into docs/ on every build
├── BathyMap/               the Python package behind the BathyMap command
│   ├── cli.py
│   └── site_builder.py
├── tests/                  pytest tests and small sample files
└── setup.py
```

## Setting up your computer (once)

You need Python 3.9 or newer and Git. A separate conda environment keeps BathyMap away from the packages in the
Anaconda base environment, some of which were compiled for an older NumPy and print warnings. In the Anaconda Prompt,
go to the repository folder (the one that contains `setup.py`) and run:

```
conda create -n bathymap python=3.12 -y
conda activate bathymap
pip install -e .
```

This installs the `BathyMap` command with its requirements: click, pandas, numpy, scipy (for the interpolated bed) and
pyproj (for converting coordinates to metres). After updating BathyMap to a version with new requirements, run
`pip install -e .` again in the environment. The `-e` keeps the command
linked to this folder, so changes to the code take effect without reinstalling. In every new terminal, run
`conda activate bathymap` before using the command.

## Publishing on GitHub Pages (once)

The repository is `wrhgroup/BathyMap`. In it, open **Settings → Pages**. Under **Build and deployment**, set
**Source** to **Deploy from a branch**, choose branch **main** and folder **/docs**, and save. GitHub publishes the site
a minute or two later, and again after every push that changes `docs/`.

To add a "Data repository" link to the website, set `repository_url` in `1_site_config.json` to
`https://github.com/wrhgroup/BathyMap`.

## Adding new data

1. Copy the raw files into a new survey folder in `data/`. To name the location, or if the platform or sensor
   differs, add a `metadata.json` file (see below).
2. From the repository folder, build the website:

   ```
   BathyMap build
   ```

   The command reads `1_site_config.json` in the current folder. (`BathyMap build -f other_config.json` uses another
   settings file.) It prints one block per data file: its location, platform, sensor, number of soundings and depth
   range, and how many soundings were removed by cleaning. It ends with "website written to ...".
3. Optionally, preview the site (see "Previewing").
4. Commit and push the data and the rebuilt website:

   ```
   git add data docs
   git commit -m "Add survey 2026-11-03"
   git push
   ```

If new files are in the repository but not on the website, the build was skipped or `docs/` was not committed. Run the
build, then commit and push again. After a push, a hard refresh (Ctrl+F5) makes sure the browser loads the new version.

### Organising the data folder

Keep one folder per survey (usually one per survey day), named with the date first so folders sort in time order, and
drop the raw files in unchanged:

```
data/
├── metadata.json                         applies to all data (platform, sensor)
├── 2026-10-16/
│   ├── metadata.json                     applies to this survey only, e.g. its location
│   ├── L0001_2026-10-16-00-24-42.dep
│   └── L0002_2026-10-16-00-52-33.dep
└── 2026-11-03_credit-river/
    ├── metadata.json
    ├── L0001_2026-11-03-14-02-10.dep
    ├── L0002_2026-11-03-14-40-55.dep
    └── L0002_2026-11-03-14-40-55.json    applies to this one file only
```

- Use lowercase letters, digits and hyphens in folder names, without spaces. Any depth of sub-folders works.
- Don't rename or move a file once it is published. The folder and file name form the line's identifier, which is used
  in shared links (for example `…/BathyMap/#2026-10-16__L0001_2026-10-16-00-24-42`) and in the download file names.
- The list on the website is grouped by the `location` in the metadata and by the survey date and area name recorded
  inside each file, not by folder.
- The line name shown on the website is the part of the file name before the first underscore (`L0001`).

### Metadata: location, platform, sensor and anything else

Each line is described by entries from JSON files, merged from the general to the specific. A later level overrides
only the entries it sets and inherits the rest:

1. `survey_metadata` in `1_site_config.json` (empty by default).
2. `metadata.json` files, from the top of `data/` down to the file's own folder. Each applies to its folder and every
   folder inside it.
3. A `.json` file with the same name as the data file, next to it. It applies to that file only.

The repository's `data/metadata.json` describes the current platform and sensor:

```json
{
    "platform": "CHCNAV Apache 4",
    "platform_type": "Uncrewed surface vessel (USV)",
    "sensor": "Apache 4 single-beam echosounder"
}
```

A survey folder's `metadata.json` usually only names the location:

```json
{
    "location": "Credit River"
}
```

- `location` groups the lines in the list, fills the location menu, labels the markers on the zoomed-out map and
  appears in the line details. Spell it the same way every time you return to a place, because lines are grouped by
  the exact text. Lines without one are listed under "No location given".
- `platform`, `platform_type` and `sensor` have their own rows in the line details. Platform and sensor are also
  written as columns in every CSV download. If no platform is given at any level, the antenna type recorded in the file
  header is used.
- Any other entry (for example `operator`, `project`, `weather` or `notes`) appears in the line details and can be found
  with the text filter.

## Previewing

```
BathyMap build
python -m http.server -d docs 8000
```

Then open http://localhost:8000. Stop the server with Ctrl+C before the next build, because while it runs Windows (and
OneDrive) can keep files in `docs/` locked. Opening `docs/index.html` directly from disk does not work, because browsers
block the data files from loading that way.

## Using the map

### Basemaps

The layers button at the top right of the map chooses the basemap and the overlays. None of them needs an account or
an API key:

| Basemap | `default_basemap` | Source | Closest native zoom |
| --- | --- | --- | --- |
| OpenStreetMap (default) | `openstreetmap` | OpenStreetMap standard tiles | 19 |
| Satellite | `satellite` | Esri World Imagery | 19 |
| Street map | `street` | Esri World Street Map | 19 |
| Topographic | `topographic` | Esri World Topographic Map | 19 |
| Light grey | `light` | Esri Light Gray Canvas | 16 |
| Dark grey | `dark` | Esri Dark Gray Canvas | 16 |
| Ocean | `ocean` | Esri World Ocean Base | 16 |

The **Place names** and **Roads** overlays (Esri reference layers) can be ticked over any basemap. Beyond a basemap's
closest native zoom, its last tiles are enlarged, so the light grey, dark grey and ocean maps turn soft when zoomed in
to the soundings. The visitor's choice of basemap and overlays is remembered in their browser, so the default only
applies on a first visit.

OpenStreetMap's tiles are drawn by volunteer-run servers, and close-up tiles of rarely viewed places can take a moment
to appear the first time. CARTO basemaps have required an API key since 25 September 2026. CARTO offers free keys for
non-commercial use at https://carto.com, and with one in `carto_api_key`, **CARTO Voyager** and **CARTO Positron** are
added to the menu. (The key is visible in the published website, as with any web-map key.) Free tile services can
change their terms; if one stops working, the others are unaffected.

### Finding the data

Any line drawn smaller than 40 pixels on screen is shown as a labelled marker with its location, number of lines and
number of soundings. Markers closer than 70 pixels merge into one labelled "N locations". Clicking a marker zooms to it.
The map opens showing all the data, and **Zoom to all data** returns to that view.

### The line list

The list opens with every location collapsed (or every survey day, when no locations are named). The arrows fold and
unfold each location and survey day, and **Collapse all** / **Expand all** do it for the whole list. Clicking the name
of a location or survey day zooms the map to its lines and opens it in the list. The checkboxes
show or hide lines on the map: **All lines** at the top (only the lines matching the current filter, when one is set),
one per location, one per survey day and one per line. A checkbox with a dash means some of its lines are hidden.
Selecting a line opens its details above the list, and the list keeps its place.

### 3D view of the bed

Each survey day has a **3D** button next to its date in the list, and each line's details have **3D view of this survey
day**. The 3D view replaces the map; the **Map** and **3D bed** tabs at the top switch between the two, and choosing a
line, a location or **Zoom to all data** returns to the map.

The view shows two point clouds, coloured by water depth:

- **Measured soundings** (points with a dark rim): the soundings of the survey day, thinned like the map
  (`max_map_points_per_line`).
- **Interpolated bed** (plain points): the bed estimated between the soundings. The build triangulates the soundings of
  the survey day and interpolates the depth linearly onto a regular grid (`bed_grid_spacing`, 0.5 m by default), in
  metres in the local UTM zone. Grid points farther than `bed_max_distance` (4 m by default) from a sounding are left
  out, so the bed is not invented across gaps the survey did not cover.

Drag to rotate, scroll or pinch to zoom, and right-drag or two-finger-drag to move. The panel at the bottom right sets
the vertical exaggeration (20× by default; survey areas are much wider than they are deep), the point size, which
clouds are shown, and a transparent water surface. **Oblique**, **From above** and **From the side** reset the camera.
Hovering over a point says whether it is a measured sounding (with its line) or an interpolated estimate, and gives its
depth. The colour scale follows the **This view** / **All data** choice of the map: this survey day's depths, or the
scale shared by all surveys.

**Interpolated bed (CSV)** downloads the grid as `Latitude`, `Longitude`, `Interpolated depth`. The interpolated values
are estimates, not measurements: a single-beam survey measures one depth per sounding, and the bed between survey
lines is only as good as the line spacing allows. The 3D view and the CSV say so. Each survey day is interpolated on its
own, so surveys of the same place on different dates are never blended. The 3D library is only downloaded when a
visitor opens a 3D view.

### Colouring the soundings

The **Colour by** menu in the legend switches between the map variables set in `map_variables` (see
"Configuration"). With the default settings and the CHC files, the menu offers:

| Group | Variable | From the column | Use |
| --- | --- | --- | --- |
| Bathymetry | Water depth | `Depth` | The depth as logged by the echosounder (the draft recorded in the file header is listed in each line's details). |
| | Bed elevation | `Height` − `Depth` | The shape of the bed (see "Heights are ellipsoidal"). |
| | GNSS height | `Height` | The height of the GNSS antenna or water surface (see "Heights are ellipsoidal"). |
| Survey | Time of day | `Time` | The order in which the soundings were collected. |
| | Distance along line | `Trail Distance` | How far the platform had travelled since the first sounding of the line. The raw column counts from the start of the survey session in the CHC software and carries on from one file to the next (L0001 starts at 80 m, L0002 at 1,206 m), so the first value of each line is subtracted. The CSV keeps the raw values. |
| | Platform speed | `Speed` | Fast runs give sparser soundings. |
| | Flow velocity | `Flow Velocity` | Shown once a survey records it (zero in the current data). |
| Quality | Roll, Pitch | `Roll`, `Pitch` | Tilt of the platform, converted from radians to degrees. A tilted single-beam transducer measures off vertical. Blue is negative, red positive, white zero. |
| | Correction age | `Diff Delay` | Age of the RTK corrections in seconds; older corrections mean less accurate positions. |
| | Horizontal and vertical precision | `HRMS`, `VRMS` | Shown once a survey records them (zero in the current data). |
| | GPS state | `GPS State` | Shown once it varies (every sounding is RTK fixed in the current data). |

The remaining columns are not offered. `Azimuth` and `Trail Direction` are directions, which wrap around at north and
suit no colour scale, and `Line Distance`, `Base ID` and `Data ID` are not measurements of the survey. Every column is
still in the CSV downloads.

The two buttons under the colour scale set its range:

- **This view** (the default) stretches the colours over the 2nd to 98th percentile of the soundings in view, updated
  after each pan or zoom, so small differences stand out wherever you look.
- **All data** keeps one scale for every survey, so colours can be compared between places.

### Exporting an area

The two dashed buttons below **Zoom to all data** select soundings:

- **Box**: press, drag and release over the soundings.
- **Polygon**: click or tap each corner, then click the first corner, double-click, or press **Finish**.

The bar at the top of the map then shows how many soundings were selected, from how many lines, their depth range and
time span, with a **Download CSV** button. Esc cancels a shape being drawn. The export is cut from the full CSV of each
line, so it contains every selected sounding even where the map shows a thinned line. Its columns are `Line`,
`Datetime`, `Latitude`, `Longitude`, `Depth`, `Platform`, `Sensor`, followed by every other column of the original
file. Hidden lines are left out.

## Configuration (`1_site_config.json`)

Paths are relative to the JSON file, which stays at the top of the repository. Every key is optional except
`data_directory`. A key that is left out takes its default, and the build prints a line saying so.

| Key | Default | What it does |
| --- | --- | --- |
| `data_directory` | required | Folder with the raw files. |
| `site_template_directory` | `site` | Website template copied into the output. |
| `output_directory` | `docs` | Where the website is written; must match the Pages folder. It is emptied on each build, and the build refuses to empty a folder that a previous build did not create (it looks for the `.bathymap-build` file it leaves there). |
| `site_title`, `site_description` | `BathyMap`, empty | The title is shown in the header and the browser tab, the description in "About this data". |
| `organisation`, `contact`, `licence` | empty | Shown in "About this data" when set. |
| `repository_url` | empty | GitHub address of the repository. Adds a "Data repository" link, and is needed when `copy_raw_files` is `false`. |
| `repository_branch` | `main` | Branch used for the raw-file links when `copy_raw_files` is `false`. |
| `file_extensions` | `[".dep"]` | File types read from the data folder. |
| `accepted_gps_states` | `[]` (keep all) | For example `[4]` keeps RTK-fixed soundings only. |
| `max_map_points_per_line` | `3000` | Soundings drawn on the map per line. Downloads always contain every sounding. |
| `max_track_points_per_line` | `200` | Points in the simplified track drawn when zoomed out. |
| `copy_raw_files` | `true` | Copies the raw files into `docs/` so they download from the website. With `false`, the download links point to the files in `data/` on GitHub instead, which keeps the published site smaller. |
| `write_combined_csv` | `true` | Writes `data/all_lines.csv` with every line, for the "Download all lines" button. |
| `survey_metadata` | `{}` | Metadata applied to every line before the `metadata.json` files are read. |
| `metadata_file_name` | `metadata.json` | Name of the per-folder metadata files. |
| `time_reference` | `as logged by the instrument` | Describes the clock of the times, for example `UTC`. |
| `depth_reference` | `as logged by the instrument` | Describes what the depths are measured from. |
| `height_reference` | `as logged by the instrument` | Describes the vertical reference of the GNSS heights; shown as "Heights" in "About this data". |
| `depth_colour_range` | automatic | `[min, max]` in metres for the "All data" depth colour scale; automatic uses the 2nd to 98th percentile of all depths. |
| `map_variables` | the 13 variables listed under "Colouring the soundings" | The "Colour by" menu (see below). |
| `default_basemap` | `openstreetmap` | Basemap on a visitor's first visit: `openstreetmap`, `satellite`, `street`, `topographic`, `light`, `dark` or `ocean` (or `carto-voyager` and `carto-positron` with a CARTO key). |
| `carto_api_key` | empty | CARTO key; when set, the CARTO basemaps are added to the menu. |
| `start_with_list_collapsed` | `true` | Opens the line list collapsed. |
| `interpolate_bed` | `true` | Interpolates the bed of each survey day for the 3D view. With `false`, no 3D view is offered. |
| `bed_grid_spacing` | `0.5` | Grid spacing of the interpolated bed, in metres. |
| `bed_max_distance` | `4` | The bed is only interpolated within this distance (metres) of a measured sounding. |
| `bed_max_points` | `250000` | Largest number of interpolated points per survey day. When a survey would need more, the build widens the grid spacing and says so. |

### `map_variables`

Each entry describes one item of the "Colour by" menu. A few of the defaults:

```json
"map_variables": [
    {"column": "Depth", "label": "Water depth", "unit": "m", "colours": "depth", "decimals": 3, "group": "Bathymetry"},
    {"column": "Height - Depth", "label": "Bed elevation", "note": "GNSS height minus water depth. Above the ellipsoid, not sea level", "unit": "m", "colours": "elevation", "decimals": 3, "group": "Bathymetry"},
    {"column": "Time of day", "label": "Time of day", "unit": "", "colours": "sequential", "decimals": 0, "format": "time", "group": "Survey"},
    {"column": "Roll", "label": "Roll", "note": "Logged in radians, shown in degrees", "unit": "°", "scale": 57.29578, "colours": "diverging", "decimals": 1, "group": "Quality"}
]
```

- `column` is a column of the raw file, the difference of two columns written as `"A - B"`, or `"Time of day"` (the
  time of each sounding).
- `label`, `unit`, `decimals` and `note` (optional, shown under the scale) control how it is shown. `group` places it
  under a heading in the menu. `format: "time"` shows the values as clock times.
- `scale` (optional) multiplies the values, for example 57.29578 to turn radians into degrees.
- `from_line_start: true` (optional) subtracts the value of each line's first sounding, so the values start at zero on
  every line.
- `colours` is `depth` (pale shallow to dark deep), `elevation` (the same ramp reversed, so a low bed is dark),
  `sequential` (purple to yellow, kept distinct so it is never read as depth) or `diverging` (blue below zero, white at
  zero, red above, with zero kept in the middle of the scale).
- `range` (optional, for example `[0, 3]`) fixes the "All data" scale; otherwise it spans the 2nd to 98th percentile of
  all values.
- Water depth is always the first entry. A column that no file has, or that has the same value everywhere (for example
  `GPS State` when every sounding is RTK fixed), is left out of the menu, and the build log says so.
- Derived and converted values (bed elevation, time of day, roll and pitch in degrees) are computed for the map only;
  the CSV downloads keep the original columns.
- Points files grow with each variable (about 210 KB per line of 2,000 soundings with the defaults). They are only
  loaded when a line is selected or zoomed in to.

## Heights are ellipsoidal, not above sea level

The `Height` column of the CHC files is the height measured by the GNSS receiver. No geoid model was applied in the
survey software, so it is the height above the ellipsoid, the smooth mathematical shape of the Earth that GNSS works
with, and not the height above sea level used on maps. The difference between the two, the geoid height, depends on
the location: in Canada it is tens of metres, and it changes by several metres across a province. GNSS height and bed
elevation are therefore far from the contours of the topographic basemap, and the gap is not the same at every
survey site. The official geoid height of any point in Canada is given by NRCan's GPS-H tool
(https://webapp.csrs-scrs.nrcan-rncan.gc.ca/geod/tools-outils/gpsh.php?locale=en).

The relative values are unaffected. In the 2026-10-16 survey Height stays within 20 cm (standard deviation 3 cm), so
Height − Depth shows the shape of the bed correctly. It may also include the height of the GNSS antenna above the water
(the file header records 0.20 m as "Antenna H"). To obtain heights above sea level (CGVD2013 in Canada), set the
survey project's height system to CGVD2013 with the CGG2013a geoid model in the CHC software before exporting.

The website says this in three places: the "Heights" line in "About this data" (from `height_reference`), and the
notes under the colour scale for GNSS height and bed elevation.

## What the build does

1. Reads `1_site_config.json`.
2. Finds every file with a listed extension in `data/` and its sub-folders.
3. Empties `docs/` and copies the template from `site/` into it.
4. For each file: reads the header (area, date, antenna type, draft, sound velocity) and the soundings; converts the
   coordinates from degrees-minutes-seconds to decimal degrees; gives every sounding a full date and time (handling
   lines that cross midnight); removes invalid soundings; and merges the metadata.
5. Writes, for each line, the map points (`docs/data/points/`), a full-resolution CSV (`docs/data/csv/`), a copy of the
   raw file (`docs/data/raw/`) and its rows in `docs/data/all_lines.csv`.
6. Interpolates the bed of each survey day (date, area and location) and writes it to `docs/data/bed/`: a JSON file
   for the 3D view and a CSV file for download.
7. Writes `docs/data/index.json`, the summary the website reads first: lines, survey days with a 3D view,
   statistics, simplified tracks, metadata, colour scales and download links.

### What is cleaned

Soundings are removed when the depth is missing or not positive, a coordinate is missing or out of range, or (when
`accepted_gps_states` is set) the GPS state is not accepted. The build log reports how many soundings were removed from
each file. The raw file download is always the untouched original. GPS states follow the NMEA convention used by the
receiver: 1 = GPS, 2 = DGPS, 4 = RTK fixed, 5 = RTK float.

## Tests

From the repository folder, with the environment active:

```
pip install pytest
pytest
```

The tests build a small site from the sample files in `tests/files/` into `tests/files/_test_site/`, which Git ignores.

## Limits

GitHub recommends keeping a repository under 1 GB, a published Pages site cannot exceed 1 GB, and Git rejects single
files over 100 MB. Git stores identical files only once, so the raw copies in `docs/data/raw/` add nothing to the size
of the repository. The CSV and map files in `docs/` do add roughly two to three times the size of the raw data, and each survey day adds
its interpolated bed (about 1.3 MB for the 2026-10-16 survey at 0.5 m; a coarser `bed_grid_spacing` shrinks it). When the
archive grows large, set `copy_raw_files` to `false` to shrink the published site. For a much larger archive, keep the
raw files in GitHub Releases or a DOI archive such as Zenodo and keep this repository for the map.

## Third-party components

The map uses [Leaflet](https://leafletjs.com) 1.9.4 (BSD-2-Clause), the 3D view uses [three.js](https://threejs.org)
r147 (MIT), and the site uses the fonts Barlow Semi Condensed, Source Sans 3
and JetBrains Mono (SIL Open Font License). All of them are included in `site/vendor/` with their licences, so the
website loads nothing from font or script CDNs. Basemap tiles come from OpenStreetMap and Esri, and are credited in the
corner of the map.
