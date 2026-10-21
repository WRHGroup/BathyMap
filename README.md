# BathyMap

BathyMap publishes raw bathymetry survey data as an interactive map with GitHub Pages. The raw data lives in `data/`,
the published website lives in `docs/`, and GitHub Pages serves `docs/` straight from the `main` branch. There is no
GitHub Actions workflow to maintain: you build the website on your own computer with one command and push it.

The website lets visitors:

- see every survey line on a satellite image (the default) or one of six other basemaps, optionally with place names
  and roads laid over it, and jump back to the full view with one button;
- browse the lines grouped by location and survey day, in a list that opens collapsed, with labelled markers showing
  where the surveys are when the map is zoomed out;
- filter the lines by location, or by any text in their date, name or metadata;
- zoom in to the individual soundings, coloured by water depth or, through the "Colour by" menu, by bed elevation,
  GNSS height or platform speed, and hover or tap one to read its value, depth, date, time (to a hundredth of a
  second, as logged) and position, with the colour scale fitted to the soundings in view or fixed for all data;
- draw a box or a polygon on the map and download every sounding inside it as a CSV;
- see the platform and sensor that collected each line;
- download each line as the original instrument file (`.dep`) or as a CSV with decimal-degree coordinates;
- download every line in one CSV;
- link straight to a line (the address ends with `#<line id>` when a line is selected).

## One-time setup

### On your computer

You need Python 3.9 or newer and Git. A separate environment keeps BathyMap's packages apart from everything else on
your computer. With Anaconda, open the Anaconda Prompt, go to this folder, and run once:

```
conda create -n bathymap python=3.12 -y
conda activate bathymap
pip install -e .
```

After that, run `conda activate bathymap` in each new terminal before using `BathyMap build`. (Without Anaconda,
`python -m venv .venv` followed by `.venv\Scripts\activate` on Windows or `source .venv/bin/activate` on macOS does
the same job; add `.venv/` to `.gitignore`.)

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
    ├── metadata.json                     overrides for this survey only, e.g. its location
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

### Naming the location

Give each survey a place name with a `location` entry, normally in the `metadata.json` of its survey folder:

```json
{
    "location": "Credit River, Streetsville"
}
```

The location is used in four places:

- **The line list** groups the survey days under their location.
- **The location menu** above the text filter lists every location with its number of lines. Choosing one filters the
  list and zooms the map to it.
- **The location markers** on the zoomed-out map are labelled with it.
- **The line details** show it.

Use the same spelling every time you return to a place, because lines are grouped by the exact text. A per-file
`.json` can give one line a different location. Lines without a location are listed under "No location given".

`location`, `platform`, `platform_type` and `sensor` have their own rows in the line details; any other entry (for example
`operator`, `project`, `weather` or `notes`) is shown there too and can be searched with the line filter. Platform and
sensor are also written as columns in every CSV download, so exported data keeps its provenance. If no platform is
given at any level, the instrument model recorded in the file header is used.

## Finding the data on the map

A survey covers only a few hundred metres, so when the map is zoomed out to show several places, the lines would be
too small to see. Any line drawn smaller than 40 pixels is shown as a labelled marker instead, with its location, its
number of lines and its number of soundings. Markers closer than 70 pixels merge into one labelled "N locations".
Clicking a marker zooms in to it, and the lines and soundings take over as you zoom in. The map opens showing all the
data, so a first-time visitor sees at once where every survey is.

## Basemaps

The layers button at the top right of the map chooses the basemap and the overlays. None of them needs an account or
an API key:

| Basemap | `default_basemap` | Source | Closest native zoom |
| --- | --- | --- | --- |
| Satellite (default) | `satellite` | Esri World Imagery | 19 |
| Street map | `street` | Esri World Street Map | 19 |
| Topographic | `topographic` | Esri World Topographic Map | 19 |
| OpenStreetMap | `openstreetmap` | OpenStreetMap standard tiles | 19 |
| Light grey | `light` | Esri Light Gray Canvas | 16 |
| Dark grey | `dark` | Esri Dark Gray Canvas | 16 |
| Ocean | `ocean` | Esri World Ocean Base | 16 |

The overlays **Place names** and **Roads** (Esri reference layers) can be ticked over any basemap, for example to label
the satellite image. Beyond a basemap's closest native zoom, its last tiles are enlarged, so the light grey, dark grey
and ocean maps turn soft when you zoom in to the soundings. The satellite image or street map are the better choice
there. Visitors' choices are remembered in their browser.

The street map used before came from CARTO, which has required an API key since 25 September 2026 and shows "API KEY
REQUIRED" on its tiles without one. CARTO offers free keys for non-commercial use (up to 5 million tile requests a
month) at https://carto.com. With a key in `carto_api_key`, the menu also offers **CARTO Voyager** and **CARTO
Positron**. The key is visible in the published website, as with any web-map key.

Esri marks several of these services as "in mature support; no longer updated", and any free tile service can change
its terms, as CARTO did. If a basemap stops working, the others are unaffected. The button under the zoom buttons
(**Zoom to all data**) returns the map to the full view.

## Colour scale

The two buttons under the colour scale set its range:

- **This view** (the default): the colours stretch over the 2nd to 98th percentile of the soundings in the map view.
  The range updates after each pan or zoom, so a 30 cm depression stands out even in a survey that spans several
  metres of depth. The legend gives the range and the number of soundings it is based on.
- **All data**: one scale for every survey (the 2nd to 98th percentile of all soundings, or the `range` given in
  `map_variables`), so colours mean the same everywhere and places can be compared.

The visitor's choice is remembered in their browser.

## Colouring the map by other columns

The map opens coloured by water depth. The **Colour by** menu in the legend switches the colours to another column; the
visitor's choice is remembered in their browser. The menu is set by `map_variables` in `1_site_config.json`:

```json
"map_variables": [
    {"column": "Depth", "label": "Water depth", "unit": "m", "colours": "depth", "decimals": 3},
    {"column": "Height - Depth", "label": "Bed elevation", "note": "GNSS height minus water depth", "unit": "m", "colours": "elevation", "decimals": 3},
    {"column": "Height", "label": "GNSS height", "unit": "m", "colours": "sequential", "decimals": 3},
    {"column": "Speed", "label": "Platform speed", "unit": "m/s", "colours": "sequential", "decimals": 2}
]
```

- `column` is a column of the raw file, or the difference of two columns written as `"A - B"`.
- `colours` is `depth` (pale shallow to dark deep), `elevation` (the same ramp reversed, so a low bed is dark) or
  `sequential` (a purple-to-yellow ramp, kept distinct so it is never read as depth).
- `range` (optional, for example `[0, 3]`) fixes the colour scale; otherwise it spans the 2nd to 98th percentile of
  all values. `note` (optional) is shown under the scale.
- Water depth is always the first entry. A column that no file has, or that has the same value everywhere (for
  example `GPS State` when every sounding is RTK fixed), is left out of the menu, and the build log says so.

Bed elevation is computed for the map only; the CSV downloads keep the original columns, from which it can be
recomputed. It is only as good as the `Height` column. In the CHC files `Height` is the GNSS-derived height recorded
with each sounding, in the vertical reference set up in the survey software (often the ellipsoid, unless a geoid
model or local datum was configured), and it may refer to the antenna rather than the water surface. Its values
across the sample lines stay within 20 cm (standard deviation 3 cm), so Height − Depth shows the shape of the bed
correctly. The absolute level, though, is only a true bed elevation once the vertical reference and any antenna
offset are confirmed. Record what you confirm in `depth_reference` or in `metadata.json` so visitors can see it.

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
| `map_variables` | depth, bed elevation, GNSS height, speed | Columns offered in the "Colour by" menu; see "Colouring the map by other columns". |
| `default_basemap` | `satellite` | Basemap shown on a visitor's first visit: `satellite`, `street`, `topographic`, `openstreetmap`, `light`, `dark` or `ocean` (or `carto-voyager` and `carto-positron` with a CARTO key). After that, the visitor's own choice is remembered. |
| `carto_api_key` | empty | CARTO basemaps key; when set, CARTO Voyager and Positron are added to the basemap menu. |
| `start_with_list_collapsed` | `true` | Opens the line list with every location (or, without locations, every survey day) collapsed. |
| `depth_colour_range` | automatic | `[min, max]` in metres for the colour scale; automatic uses the 2nd to 98th percentile of all depths. |
| `time_reference` | `as logged by the instrument` | Describes the clock used for the times, for example `UTC` or `Eastern Time`. |
| `depth_reference` | `as logged by the instrument` | Describes what the depths are measured from, for example `below water surface, transducer draft applied`. |

## Previewing before you push

```
BathyMap build -f 1_site_config.json
python -m http.server -d docs 8000
```

Then open http://localhost:8000 and stop the server with Ctrl+C. Stop the server before the next build: while it runs,
Windows can keep files in `docs/` locked. Opening `docs/index.html` directly from disk does
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
