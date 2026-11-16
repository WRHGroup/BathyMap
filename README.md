# BathyMap

BathyMap publishes raw bathymetry survey data as an interactive map on GitHub Pages
(https://wrhgroup.github.io/BathyMap/). The raw files are stored in `data/`, and the website is built from them on a
local computer with one command (`BathyMap build`), which writes the website to `docs/`. GitHub Pages serves `docs/`
directly from the `main` branch; therefore, publishing an update requires only a commit and a push. The repository uses
no GitHub Actions workflow and no Jekyll theme.

## What the website offers

The website shows where each survey is located at three levels of detail: labelled location markers when the map is
zoomed out, survey tracks at intermediate zoom levels, and individual soundings from zoom level 15. Hovering over or
tapping a sounding shows its depth, position, date, and time (to a hundredth of a second, as recorded by the
instrument). The soundings are coloured by water depth by default, and the "Colour by" menu offers other variables
recorded with each sounding (e.g., bed elevation, GNSS height, time of day, platform speed, roll, pitch, and the age of
the RTK corrections). The basemap can be OpenStreetMap (the default), satellite imagery, or one of five other maps, with
optional place names and roads.

The survey lines are listed by location and survey day. The list opens collapsed and can be filtered by location or by
text. Also, its checkboxes show or hide individual lines, survey days, locations, or all lines on the map. Selecting a
line opens its details (i.e., statistics, platform, sensor, and other metadata) with download links for the original
`.dep` file and a CSV file with decimal-degree coordinates. Furthermore, every survey day and location can be opened in
a 3D view, in which the measured soundings are drawn over a shaded surface interpolated between them for visualisation
only. The soundings within a box or polygon drawn on the map can be downloaded as a CSV file, as can all lines
together. A link to a single line ends with `#<line id>`.

## Repository layout

```
BathyMap/
├── 1_site_config.json      settings of the website (see "Configuration")
├── data/                   raw survey files, organised in survey folders (see "Adding new data")
│   ├── metadata.json
│   └── 2026-10-16/
│       ├── metadata.json
│       ├── L0001_2026-10-16-00-24-42.dep
│       └── L0002_2026-10-16-00-52-33.dep
├── docs/                   published website, written by "BathyMap build" (not to be edited by hand)
├── site/                   website template (index.html, app.js, style.css, and in site/vendor/ the Leaflet map
│                           library, the three.js 3D library, and the fonts), copied into docs/ on every build
├── BathyMap/               Python package of the BathyMap command
│   ├── cli.py
│   └── site_builder.py
├── tests/                  pytest tests and small sample files
└── setup.py
```

## Setting up a computer (once)

BathyMap requires Python 3.9 or newer and Git. A separate conda environment is recommended because some packages of the
Anaconda base environment were compiled for an older version of NumPy and print warnings. In the Anaconda Prompt, from
the repository folder (i.e., the folder that contains `setup.py`), run:

```
conda create -n bathymap python=3.12 -y
conda activate bathymap
pip install -e .
```

This installs the `BathyMap` command and its requirements: click, pandas, numpy, scipy (for the interpolated surface),
and pyproj (for converting coordinates to meters). The `-e` option links the command to the repository folder, so
changes to the code take effect without reinstalling. However, `pip install -e .` should be run again after an update
that adds new requirements. In every new terminal, `conda activate bathymap` is needed before using the command.

## Publishing on GitHub Pages (once)

The repository is `wrhgroup/BathyMap`. In its "Settings → Pages", under "Build and deployment", set "Source" to "Deploy
from a branch", choose the branch `main` and the folder `/docs`, and save. GitHub publishes the website around two
minutes later, and again after every push that changes `docs/`. Setting `repository_url` in `1_site_config.json` to
`https://github.com/wrhgroup/BathyMap` adds a "Data repository" link to the website.

## Adding new data

1. Copy the raw files into a new survey folder in `data/`. To name the location, or if the platform or sensor differs,
   add a `metadata.json` file (see "Metadata").
2. From the repository folder, build the website:

   ```
   BathyMap build
   ```

   The command reads `1_site_config.json` in the current folder (`BathyMap build -f other_config.json` uses another
   settings file). For each data file, it prints the location, platform, sensor, number of soundings, depth range, and
   number of soundings removed by cleaning. It ends with "website written to ...".
3. Preview the website if needed (see "Previewing").
4. Commit and push the data and the rebuilt website:

   ```
   git add data docs
   git commit -m "Add survey 2026-11-03"
   git push
   ```

If new files are in the repository but not on the website, either the build was not run or `docs/` was not committed.
In both cases, running the build and pushing again resolves the issue. After a push, a hard refresh (Ctrl+F5) ensures
that the browser loads the new version.

### Organising the data folder

Each survey (usually one survey day) has its own folder, named with the date first so that the folders sort in time
order. The raw files are copied in unchanged:

```
data/
├── metadata.json                         applies to all data (e.g., platform and sensor)
├── 2026-10-16/
│   ├── metadata.json                     applies to this survey only (e.g., its location)
│   ├── L0001_2026-10-16-00-24-42.dep
│   └── L0002_2026-10-16-00-52-33.dep
└── 2026-11-03_credit-river/
    ├── metadata.json
    ├── L0001_2026-11-03-14-02-10.dep
    ├── L0002_2026-11-03-14-40-55.dep
    └── L0002_2026-11-03-14-40-55.json    applies to this file only
```

Folder names should use lowercase letters, digits, and hyphens, without spaces; sub-folders of any depth are read. A
published file should not be renamed or moved because its folder and file name form the identifier of the line, which
is used in shared links (e.g., `…/BathyMap/#2026-10-16__L0001_2026-10-16-00-24-42`) and in download file names. The
list on the website is grouped by the `location` in the metadata and by the survey date and area name recorded in each
file, not by folder. The line name shown on the website is the part of the file name before the first underscore
(e.g., `L0001`).

### Metadata

Each line is described by entries from JSON files, merged from the general to the specific: (1) `survey_metadata` in
`1_site_config.json` (empty by default), (2) the `metadata.json` files from the top of `data/` down to the folder of
the file, each applying to its folder and all folders inside it, and (3) a `.json` file with the same name as the data
file, which applies to that file only. A later level overrides only the entries it sets and inherits the rest. The
`data/metadata.json` file of the repository describes the current platform and sensor:

```json
{
    "platform": "CHCNAV Apache 4",
    "platform_type": "Uncrewed surface vessel (USV)",
    "sensor": "Apache 4 single-beam echosounder"
}
```

The `metadata.json` file of a survey folder usually names only the location:

```json
{
    "location": "Credit River"
}
```

The `location` entry groups the lines in the list, fills the location menu, labels the markers on the zoomed-out map,
and appears in the line details. Lines are grouped by the exact text, so a location should be spelled the same way in
every survey; lines without a location are listed under "Location not specified". The `platform`, `platform_type`, and
`sensor` entries have their own rows in the line details, and the platform and sensor are also written as columns in
every CSV download. If no platform is given at any level, the antenna type recorded in the file header is used. Any
other entry (e.g., `operator`, `project`, `weather`, or `notes`) appears in the line details and can be found with the
text filter.

## Previewing

```
BathyMap build
python -m http.server -d docs 8000
```

The website is then available at http://localhost:8000. The server should be stopped with Ctrl+C before the next
build because, while it runs, Windows and OneDrive can lock files in `docs/`. Opening `docs/index.html` directly from
disk does not work because browsers do not load the data files of a page opened that way.

## Using the website

### Disclaimer

A disclaimer appears every time the website is opened and remains until the visitor selects "I understand" or presses
Esc. It states that the data are provided "as is", without warranty, that they can contain errors and must not be used
for navigation, and that no liability is accepted for their use. "Read the disclaimer", under "About this data", shows
it again. Its title, paragraphs, and button text are set by `disclaimer` in `1_site_config.json`, and
`show_disclaimer: false` prevents it from appearing when the website opens. The wording follows the disclaimers of
other bathymetry and open-data publishers, namely GEBCO, the United States Geological Survey (USGS), and Ontario Open
Data. However, it is not legal advice, and it should be reviewed by the institution if required.

### Appearance

The website has a classical appearance: titles are set in Source Serif 4, the interface and figures in Source Sans 3,
on white and light grey grounds (or dark grey in dark mode) with a muted navy for controls. Selected lines and
selected areas are drawn in near-black (white on the satellite and dark maps) because neither colour appears in the
depth scale. The colours and fonts are defined at the top of `site/style.css`.

### Basemaps

The layers button at the top right of the map selects the basemap and the overlays. None of them requires an account
or an API key.

| Basemap | `default_basemap` | Source | Highest native zoom |
| --- | --- | --- | --- |
| OpenStreetMap (default) | `openstreetmap` | OpenStreetMap standard tiles | 19 |
| Satellite | `satellite` | Esri World Imagery | 19 |
| Street map | `street` | Esri World Street Map | 19 |
| Topographic | `topographic` | Esri World Topographic Map | 19 |
| Light grey | `light` | Esri Light Gray Canvas | 16 |
| Dark grey | `dark` | Esri Dark Gray Canvas | 16 |
| Ocean | `ocean` | Esri World Ocean Base | 16 |

The "Place names" and "Roads" overlays (Esri reference layers) can be added to any basemap. Beyond the highest native
zoom of a basemap, its last tiles are enlarged; therefore, the light grey, dark grey, and ocean maps become blurred
when zoomed in to the soundings. The choice of basemap and overlays is remembered in the browser of the visitor, so the
default applies only on a first visit. The OpenStreetMap tiles are served by volunteer-run servers, and close-up tiles
of rarely viewed places can take a few seconds to appear the first time. CARTO basemaps have required an API key since
25 September 2026. CARTO offers free keys for non-commercial use (https://carto.com), and a key in `carto_api_key` adds
"CARTO Voyager" and "CARTO Positron" to the menu. The key is visible in the published website, as with any web-map key.
Free tile services can change their terms; however, if one service stops working, the others are unaffected.

### Finding the data

Any line drawn smaller than 40 pixels on the screen is shown as a labelled marker with its location, number of lines,
and number of soundings. Markers closer than 70 pixels merge into one marker labelled "N locations", and selecting a
marker zooms to it. The map opens with all data in view, and the "Zoom to all data" button, under the zoom buttons,
returns to that view.

### The line list

The list opens with every location collapsed (or every survey day, when no locations are named). The arrow next to a
location or survey day opens and closes it, and "Collapse all" and "Expand all" act on the whole list. Selecting the
name of a location or survey day zooms the map to its lines without opening it. The checkboxes show or hide lines on
the map at four levels: all lines (or all lines matching the filter, when one is set), each location, each survey day,
and each line. A checkbox with a dash indicates that some of its lines are hidden. Selecting a line opens its details
above the list, and the list keeps its position.

### 3D view

Each location and survey day has a "3D" button in the list, and the details of each line have a "3D view of this
survey day" button. The 3D view of a location combines all its survey days into one surface; the panel states when it
combines several dates because the bed could have changed between them. A location surveyed on a single day uses the
files of that day. The "Map" and "3D bed" tabs at the top switch between the two views. "3D bed" opens the survey in
the current map view (i.e., among the lines shown in the view, the location with the most lines or, for lines without
a location, the survey day with the most lines), framed on the area of the map view when that area is smaller than the
survey. When no survey is in view, a note says so. The map view returns with the "Map" tab, the selection of a line,
the selection of a location or survey day name, or "Zoom to all data". Also, hiding lines that the open 3D view is
built from returns to the map, zoomed to their area.

The 3D view has two layers coloured by water depth. The first layer is the measured soundings (points with a dark
rim), thinned as on the map (`max_map_points_per_line`). The second layer is a continuous surface, shaded as if lit
from the north-west, which shows the bed interpolated between the soundings. This surface is for visualisation only: it
is not a measurement and is not available for download, and the panel states this next to the layer. To build it, the
soundings of the survey day (or location) are triangulated (Delaunay triangulation) in meters in the local UTM zone,
and the depth is interpolated linearly onto a regular grid (`bed_grid_spacing`, 0.5 m by default). A triangle is
filled when it connects two different passes of the survey and none of its sides is longer than `bed_max_gap` (30 m by
default). As a result, the surface is continuous between neighbouring passes but does not cross wider gaps, and it
never extends beyond the outermost passes because triangles exist only between soundings. Nothing is filled beside a
single pass, which shows only its soundings, because values there could only be extended sideways from that pass.
Also, a gap that is enclosed on all sides by the surface (e.g., at a turn where the boat crossed its own track) is
filled when `bed_fill_enclosed_holes` is true (the default), provided that none of its triangles has a side longer
than `bed_max_gap`. A gap that opens onto the edge of the survey is left empty, because filling it would extend the
surface beyond the soundings.
Setting `bed_max_distance` above 0 adds a band of that width around every sounding. However, beside a single pass, the
values of this band come from triangles made of two neighbouring soundings of the pass and one sounding of the nearest
other line, however distant.

Two soundings belong to different passes when they come from different lines or survey days, or when the distance
travelled along the track between them is more than `bed_pass_ratio` (2 by default) times the straight distance
between them, as between the legs of a back-and-forth survey. A bend within one pass does not qualify; therefore, the
inside of a curve sailed once is not filled. Each survey day is interpolated separately, so surveys of the same place
on different dates are never combined, except in the 3D view of a location, as described above.

The view is rotated by dragging, zoomed by scrolling or pinching, and moved by right-dragging or dragging with two
fingers. "Oblique", "From above", and "From the side" reset the camera. A basemap is laid as a flat sheet at the water
surface around the survey, with the surveyed area removed so that the surface below is visible. The surveyed area is
the outline of the survey (i.e., every triangle of soundings with no side longer than `bed_max_gap`), including the
gaps inside the surface; therefore, no part of the basemap remains inside the survey. The "Water surface" option draws
a transparent surface over the same outline. The "Basemap at the water surface" menu offers the basemaps of the map and
"None (plain background)" for the surface alone over a grid. Until the visitor selects one, it follows the basemap of
the map, and the selection is then remembered in the browser. The tiles are downloaded by the browser when the 3D view
opens and are credited in the corner of the view.

Survey areas are much wider than they are deep, so depths are exaggerated vertically. The 3D view opens with the
exaggeration at which the deepest point lies one tenth of the survey width below the water surface (between 1× and
30×), or with the value of `vertical_exaggeration`; for example, the Credit River survey (around 160 m wide and 1.8 m
deep) opens at 9×. The slider changes the exaggeration from 1× to 60×. The panel also sets the size of the sounding
points and the layers shown. Hovering over a sounding shows its line and depth, and hovering over the surface shows its
approximate depth, its distance from the nearest sounding, and that it is interpolated for visualisation only. With
"Fade the surface away from soundings" (selected by default), the surface fades towards the background with distance
from the nearest sounding, reaching its faintest at one third of `bed_max_gap`, so that the parts of the surface
supported by fewer measurements appear less certain. The colour scale follows the "This view" or "All data" choice of
the map. The 3D library is downloaded only when a visitor opens a 3D view.

### Colouring the soundings

The "Colour by" menu in the legend switches between the variables set in `map_variables` (see "Configuration"). With
the default settings and the CHC files, the menu offers the following variables.

| Group | Variable | Column | Description |
| --- | --- | --- | --- |
| Bathymetry | Water depth | `Depth` | Depth as recorded by the echosounder (the draft recorded in the file header is listed in the line details). |
| | Bed elevation | `Height` − `Depth` | Shape of the bed (see "Heights are relative to the ellipsoid"). |
| | GNSS height | `Height` | Height of the GNSS antenna or water surface (see "Heights are relative to the ellipsoid"). |
| Survey | Time of day | `Time` | Order in which the soundings were collected. |
| | Distance along line | `Trail Distance` | Distance travelled since the first sounding of the line. The raw column counts from the start of the survey session in the CHC software and continues from one file to the next (L0001 starts at 80 m and L0002 at 1,206 m); therefore, the first value of each line is subtracted. The CSV files keep the raw values. |
| | Platform speed | `Speed` | Higher speeds give sparser soundings. |
| | Flow velocity | `Flow Velocity` | Shown once a survey records it (zero in the current data). |
| Quality | Roll, pitch | `Roll`, `Pitch` | Tilt of the platform, converted from radians to degrees. A tilted single-beam transducer measures away from the vertical. Blue is negative, red positive, and white zero. |
| | Correction age | `Diff Delay` | Age of the RTK corrections in seconds; older corrections give less accurate positions. |
| | Horizontal and vertical precision | `HRMS`, `VRMS` | Shown once a survey records them (zero in the current data). |
| | GPS state | `GPS State` | Shown once it varies (every sounding is RTK fixed in the current data). The state is a code rather than a quantity, so each state has its own colour: RTK fixed green, RTK float yellow, DGPS orange, and single GPS red. |

The remaining columns are not offered. `Azimuth` and `Trail Direction` are directions, which wrap around at north and
suit no colour scale, and `Line Distance`, `Base ID`, and `Data ID` are not survey measurements. However, every column
is included in the CSV downloads.

The two buttons under the colour scale set its range. "This view" (the default) stretches the colours over the 2nd to
98th percentile of the soundings in view and is updated after each pan or zoom, so that small differences are visible
in any part of a survey. "All data" keeps one scale for all surveys, so that colours can be compared between places.
In both cases, the legend marks the ends of the scale with ≤ and ≥ because the few soundings beyond these percentiles
take the end colours.

### Exporting an area

The two dashed buttons below "Zoom to all data" select soundings with a box (press, drag, and release) or a polygon
(select each corner, then close the polygon on the first corner, with a double-click, or with "Finish"). The bar at
the top of the map then shows the number of soundings selected, the number of lines, their depth range, and their time
span, with a "Download CSV" button; Esc cancels a shape being drawn. The export is taken from the full CSV file of each
line, so it includes every selected sounding, even where the map shows a thinned line. Its columns are `Line`,
`Datetime`, `Latitude`, `Longitude`, `Depth`, `Platform`, and `Sensor`, followed by every other column of the original
file. Hidden lines are excluded.

## Configuration (`1_site_config.json`)

Paths are relative to the JSON file, which stays at the top of the repository. Every key is optional except
`data_directory`. A key that is left out takes its default value, and the build prints a line stating so.

| Key | Default | Description |
| --- | --- | --- |
| `data_directory` | required | Folder with the raw files. |
| `site_template_directory` | `site` | Website template copied into the output. |
| `output_directory` | `docs` | Folder in which the website is written; it must match the Pages folder. It is emptied on each build, and the build does not empty a folder that a previous build did not create (it checks for the `.bathymap-build` file it leaves there). |
| `site_title`, `site_description` | `BathyMap`, empty | The title is shown in the header and the browser tab, and the description in "About this data". |
| `organisation`, `contact`, `licence` | empty | Shown in "About this data" when set. |
| `show_disclaimer` | `true` | Shows the disclaimer every time the website is opened. |
| `disclaimer` | no warranty, not for navigation, no liability | Text of the disclaimer: `title`, `paragraphs` (a list with one text per paragraph), and `button`. |
| `repository_url` | empty | GitHub address of the repository. It adds a "Data repository" link and is needed when `copy_raw_files` is `false`. |
| `repository_branch` | `main` | Branch used for the links to the raw files when `copy_raw_files` is `false`. |
| `file_extensions` | `[".dep"]` | File types read from the data folder. |
| `accepted_gps_states` | `[]` (keep all) | GPS states kept by cleaning; for example, `[4]` keeps RTK-fixed soundings only. |
| `max_map_points_per_line` | `3000` | Soundings drawn on the map for each line. The downloads always contain every sounding. |
| `max_track_points_per_line` | `200` | Points of the simplified track drawn when the map is zoomed out. |
| `copy_raw_files` | `true` | Copies the raw files into `docs/` so that they are downloaded from the website. With `false`, the download links point to the files in `data/` on GitHub, which keeps the published website smaller. |
| `write_combined_csv` | `true` | Writes `data/all_lines.csv` with every line, for the "Download all lines" button. |
| `survey_metadata` | `{}` | Metadata applied to every line before the `metadata.json` files are read. |
| `metadata_file_name` | `metadata.json` | Name of the metadata files of the folders. |
| `time_reference` | `as recorded by the instrument` | Description of the clock of the times (e.g., `UTC`). |
| `depth_reference` | `as recorded by the instrument` | Description of the reference of the depths. |
| `height_reference` | `as recorded by the instrument` | Description of the vertical reference of the GNSS heights, shown as "Heights" in "About this data". |
| `depth_colour_range` | automatic | `[min, max]` in meters for the "All data" depth scale; automatic uses the 2nd to 98th percentile of all depths. |
| `map_variables` | the 13 variables listed under "Colouring the soundings" | Variables of the "Colour by" menu (see below). |
| `default_basemap` | `openstreetmap` | Basemap on the first visit: `openstreetmap`, `satellite`, `street`, `topographic`, `light`, `dark`, or `ocean` (or `carto-voyager` and `carto-positron` with a CARTO key). |
| `carto_api_key` | empty | CARTO key; when set, the CARTO basemaps are added to the menu. |
| `start_with_list_collapsed` | `true` | Opens the line list collapsed. |
| `interpolate_bed` | `true` | Interpolates the surface of each survey day and location for the 3D view. With `false`, no 3D view is offered. |
| `bed_grid_spacing` | `0.5` | Grid spacing of the interpolated surface, in meters. |
| `bed_max_distance` | `0` | When above 0, the surface is also filled within this distance (in meters) of every sounding, including beside a single pass, where values are extended sideways from that pass. |
| `bed_max_gap` | `30` | Largest gap (in meters) between passes across which the surface is filled. It should be slightly larger than the usual line spacing of the surveys. |
| `bed_pass_ratio` | `2` | Two soundings of one line belong to different passes when the track between them is more than this number of times their straight distance apart. |
| `bed_fill_enclosed_holes` | `true` | Fills the gaps in the surface that are enclosed on all sides by the surface. Gaps that open onto the edge of the survey remain empty. |
| `vertical_exaggeration` | `auto` | Initial vertical exaggeration of the 3D view: `auto` (the deepest point one tenth of the survey width below the water surface, between 1× and 30×) or a number such as `5`. |
| `bed_max_points` | `250000` | Largest number of interpolated points for each survey day or location. When a survey requires more, the build widens the grid spacing and reports it. |

### `map_variables`

Each entry describes one item of the "Colour by" menu. Four of the default entries are shown below.

```json
"map_variables": [
    {"column": "Depth", "label": "Water depth", "unit": "m", "colours": "depth", "decimals": 3, "group": "Bathymetry"},
    {"column": "Height - Depth", "label": "Bed elevation", "note": "GNSS height minus water depth, relative to the ellipsoid (not sea level).", "unit": "m", "colours": "elevation", "decimals": 3, "group": "Bathymetry"},
    {"column": "Time of day", "label": "Time of day", "unit": "", "colours": "sequential", "decimals": 0, "format": "time", "group": "Survey"},
    {"column": "Roll", "label": "Roll", "note": "Recorded in radians and shown in degrees.", "unit": "°", "scale": 57.29578, "colours": "diverging", "decimals": 1, "group": "Quality"}
]
```

The `column` entry is a column of the raw file, the difference of two columns written as `"A - B"`, or `"Time of day"`
(i.e., the time of each sounding). The `label`, `unit`, `decimals`, and `note` entries (the note is optional and is
shown under the scale) control the display, `group` places the variable under a heading in the menu, and
`format: "time"` shows values as clock times. The optional `scale` entry multiplies the values (e.g., 57.29578 to
convert radians to degrees), and `from_line_start: true` subtracts the value of the first sounding of each line, so
that the values start at zero on every line.

The `colours` entry selects the colour scale: `depth` (red for shallow, through yellow, green, and blue, to purple for
deep), `elevation` (the same scale reversed, so a low bed is purple), `sequential` (light grey to charcoal, which is not
used by the depth scale and therefore cannot be mistaken for depth), `diverging` (blue below zero, white at zero, and
red above, with zero kept in the middle of the scale), or `categories`. The `categories` option is for codes rather
than quantities, such as the GPS state, and requires a `categories` entry that gives each value a label and a colour
(e.g., `{"4": {"label": "RTK fixed", "colour": "#1a9850"}}`). The legend then lists the values found in the data with
their colours, and hovering over a sounding shows its label. The optional `range` entry (e.g., `[0, 3]`) fixes the "All
data" scale; otherwise, the scale spans the 2nd to 98th percentile of all values.

Water depth is always the first entry. A column that no file contains, or that has the same value everywhere (e.g.,
`GPS State` when every sounding is RTK fixed), is left out of the menu, and the build log reports it. Derived and
converted values (i.e., bed elevation, time of day, and roll and pitch in degrees) are computed for the map only, and
the CSV downloads keep the original columns. The map files grow with each variable (around 210 KB for a line of 2,000
soundings with the default variables); however, they are loaded only when a line is selected or zoomed in to.

## Heights are relative to the ellipsoid

The `Height` column of the CHC files is the height measured by the GNSS receiver. No geoid model was applied in the
survey software; therefore, the height is relative to the ellipsoid (i.e., the smooth mathematical shape of the Earth
used by GNSS) rather than to sea level, as on topographic maps. The difference between the two (i.e., the geoid height)
depends on the location. In Canada, it is tens of meters and changes by several meters across a province. As a result,
GNSS height and bed elevation differ from the contours of the topographic basemap, and the difference is not the same
at every survey site. The official geoid height of any point in Canada is given by the GPS-H tool of Natural Resources
Canada (https://webapp.csrs-scrs.nrcan-rncan.gc.ca/geod/tools-outils/gpsh.php?locale=en).

The relative values are unaffected. In the 2026-10-16 survey, `Height` varies within 20 cm (standard deviation 3 cm);
therefore, `Height` − `Depth` represents the shape of the bed correctly. The height could also include the height of
the GNSS antenna above the water (the file header records 0.20 m as "Antenna H"). To obtain heights above sea level
(CGVD2013 in Canada), the height system of the survey project should be set to CGVD2013 with the CGG2013a geoid model
in the CHC software before export. The website states this in three places: the "Heights" line in "About this data"
(from `height_reference`) and the notes under the colour scale for GNSS height and bed elevation.

## What the build does

1. Reads `1_site_config.json`.
2. Finds every file with a listed extension in `data/` and its sub-folders.
3. Empties `docs/` and copies the template from `site/` into it.
4. For each file, reads the header (area, date, antenna type, draft, and sound velocity) and the soundings, converts
   the coordinates from degrees, minutes, and seconds to decimal degrees, assigns a full date and time to every sounding
   (including lines that cross midnight), removes invalid soundings, and merges the metadata.
5. For each line, writes the map points (`docs/data/points/`), a full-resolution CSV file (`docs/data/csv/`), a copy of
   the raw file (`docs/data/raw/`), and its rows in `docs/data/all_lines.csv`.
6. Interpolates the surface of each survey day (date, area, and location) and each named location (all its survey days
   together) and writes it to `docs/data/bed/` as a JSON file for the 3D view. No download of the surface is written.
7. Writes `docs/data/index.json`, the summary that the website reads first: lines, survey days and locations with a 3D
   view, statistics, simplified tracks, metadata, colour scales, and download links.

### Cleaning

A sounding is removed when its depth is missing or not positive, when a coordinate is missing or out of range, or
(when `accepted_gps_states` is set) when its GPS state is not accepted. The build log reports the number of soundings
removed from each file, and the raw file download is always the unchanged original. GPS states follow the National
Marine Electronics Association (NMEA) convention used by the receiver: 1 = GPS, 2 = DGPS, 4 = RTK fixed, and 5 = RTK
float.

## Tests

From the repository folder, with the environment active:

```
pip install pytest
pytest
```

The tests build a small website from the sample files in `tests/files/` into `tests/files/_test_site/`, which Git
ignores.

## Limits

GitHub recommends keeping a repository under 1 GB, a published Pages website cannot exceed 1 GB, and Git rejects
single files over 100 MB. Git stores identical files only once, so the raw copies in `docs/data/raw/` add nothing to
the size of the repository. However, the CSV and map files in `docs/` add around two to three times the size of the
raw data, and each survey day adds its interpolated surface (around 1.3 MB for the 2026-10-16 survey at 0.5 m; a
coarser `bed_grid_spacing` reduces it). When the archive grows large, setting `copy_raw_files` to `false` reduces the
size of the published website. For a much larger archive, the raw files could be kept in GitHub Releases or a DOI
archive such as Zenodo, with this repository kept for the map.

## Third-party components

The map uses Leaflet 1.9.4 (https://leafletjs.com; BSD-2-Clause licence), the 3D view uses three.js r147
(https://threejs.org; MIT licence), and the website uses the fonts Source Serif 4 and Source Sans 3 (SIL Open Font
Licence). All of them are included in `site/vendor/` with their licences, so the website loads nothing from font or
script content delivery networks. The basemap tiles come from OpenStreetMap and Esri and are credited in the corner of
the map.
