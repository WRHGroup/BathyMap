/* BathyMap. Reads data/index.json (written by the BathyMap build), draws every survey line as a track,
   and loads the soundings of a line when it is selected or when the map is zoomed in far enough to see it. */
(function () {
  'use strict';

  var POINT_ZOOM = 15;            // soundings of lines in view are loaded from this zoom level
  /* Basemaps in the order of the layers menu. key is the name used for default_basemap in the site configuration;
     dark marks the ones on which tracks and soundings are outlined in white. */
  var BASEMAPS = [
    { key: 'openstreetmap', name: 'OpenStreetMap', osm: true },
    { key: 'satellite', name: 'Satellite', esri: 'World_Imagery', maxNativeZoom: 19, dark: true,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community' },
    { key: 'street', name: 'Street map', esri: 'World_Street_Map', maxNativeZoom: 19,
      attribution: 'Map &copy; Esri, HERE, Garmin, USGS, NRCan, &copy; OpenStreetMap contributors, and the GIS User Community' },
    { key: 'topographic', name: 'Topographic', esri: 'World_Topo_Map', maxNativeZoom: 19,
      attribution: 'Map &copy; Esri, HERE, Garmin, USGS, NRCan, GEBCO, &copy; OpenStreetMap contributors, and the GIS User Community' },
    { key: 'light', name: 'Light grey', esri: 'Canvas/World_Light_Gray_Base', maxNativeZoom: 16,
      attribution: 'Map &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS User Community' },
    { key: 'dark', name: 'Dark grey', esri: 'Canvas/World_Dark_Gray_Base', maxNativeZoom: 16, dark: true,
      attribution: 'Map &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS User Community' },
    { key: 'ocean', name: 'Ocean', esri: 'Ocean/World_Ocean_Base', maxNativeZoom: 16,
      attribution: 'Map &copy; Esri, Garmin, GEBCO, NOAA NGDC, and other contributors' },
    { key: 'carto-voyager', name: 'CARTO Voyager', carto: 'voyager' },
    { key: 'carto-positron', name: 'CARTO Positron', carto: 'light_all' }
  ];
  function baseKey(k) { return k || 'openstreetmap'; }
  function isDarkBase() { return BASEMAPS.some(function (b) { return b.name === state.base && b.dark; }); }
  var RAMP = ['#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494', '#081d58'];
  var GPS_LABELS = { '0': 'Invalid', '1': 'GPS', '2': 'DGPS', '3': 'PPS', '4': 'RTK fixed', '5': 'RTK float', '6': 'Estimated' };
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var state = {
    site: null,
    lines: [],
    byId: {},
    hidden: {},
    selected: null,
    points: {},
    projected: {},
    pointLayers: {},
    tracks: {},
    loading: {},
    failed: {},
    scaleMode: 'view',   // 'view': colour scale fitted to the soundings in view; 'all': one scale for all data
    viewRange: null,
    viewCount: 0,
    location: '',        // location chosen in the location filter ('' = all)
    beds: {},            // interpolated bed of each survey day, keyed '<date>|<area>|<location>'
    collapsed: {},       // collapsed list sections, keyed 'loc:<location>' or 'day:<date>|<area>|<location>'
    variable: 0,         // index of the map variable the soundings are coloured by (0 = water depth)
    base: null,          // name of the basemap shown
    filter: '',
    mode: null,          // 'box' or 'polygon' while the visitor is drawing a selection
    draft: null,         // shape being drawn
    shape: null,         // finished selection shape
    csv: {},             // full-resolution CSV of each line, parsed on demand for exports
    selection: null,     // { lines, rows, header, depthMin, depthMax, first, last }
    selectionRun: 0
  };

  var el = function (id) { return document.getElementById(id); };
  var map, renderer, probeRing;

  /* ---------- formatting ---------- */
  function fmtDate(iso) {
    if (!iso) return '';
    var p = iso.slice(0, 10).split('-');
    return parseInt(p[2], 10) + ' ' + MONTHS[parseInt(p[1], 10) - 1] + ' ' + p[0];
  }
  function fmtTime(iso) { return iso ? iso.slice(11, 16) : ''; }
  function pad(n, w) { n = String(n); while (n.length < (w || 2)) n = '0' + n; return n; }
  // "2026-10-16T00:24:42.78" -> "16 Oct 2026, 00:24:42.78". Clock times are shown exactly as logged; no time-zone conversion.
  function fmtDateTime(iso) { return fmtDate(iso) + ', ' + iso.slice(11, 22); }

  /* Date and time of one map sounding, rebuilt from the line start and the sounding's offset in seconds.
     Date.UTC is used only as arithmetic on the logged clock, so the browser's own time zone never shifts the values. */
  function soundingDateTime(p, i) {
    if (p._base == null) {
      var m = p.start.match(/(\d+)-(\d+)-(\d+)T(\d+):(\d+):(\d+(?:\.\d+)?)/);
      p._base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0) + Math.round(parseFloat(m[6]) * 1000);
    }
    var d = new Date(p._base + Math.round(p.t[i] * 1000));
    var hundredths = Math.round(d.getUTCMilliseconds() / 10);
    return {
      date: d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()] + ' ' + d.getUTCFullYear(),
      time: pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ':' + pad(d.getUTCSeconds()) + '.' + pad(Math.min(hundredths, 99))
    };
  }
  function fmtNum(n) { return Number(n).toLocaleString('en-CA'); }
  function fmtDepth(d) { return Number(d).toFixed(2); }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  /* ---------- colour scale ---------- */
  /* Each map variable has a colour scale. Depth runs from pale (shallow) to dark blue (deep); elevation is the same
     ramp reversed, so a low bed is dark as it is on the depth map; any other variable uses a separate ramp so it is
     never mistaken for depth. Values outside the range take the end colours; a missing value is grey. */
  var RAMPS = {
    depth: RAMP,
    elevation: RAMP.slice().reverse(),
    sequential: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
    // Blue below zero, white at zero, red above: for signed values such as roll and pitch.
    diverging: ['#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b']
  };
  var MISSING_COLOUR = '#9aa5ad';
  function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  var RAMPS_RGB = {};
  Object.keys(RAMPS).forEach(function (k) { RAMPS_RGB[k] = RAMPS[k].map(hexToRgb); });
  function rampColour(v, range, kind) {
    if (v == null || isNaN(v)) return MISSING_COLOUR;
    var rgb = RAMPS_RGB[kind] || RAMPS_RGB.sequential;
    var t = (v - range[0]) / ((range[1] - range[0]) || 1);
    t = Math.max(0, Math.min(1, t));
    var x = t * (rgb.length - 1);
    var i = Math.min(Math.floor(x), rgb.length - 2);
    var f = x - i;
    var a = rgb[i], b = rgb[i + 1];
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }
  function depthColour(d) { return rampColour(d, state.site.depth_colour_range, 'depth'); }

  /* Map variables come from the build (site.map_variables); older builds only have depth. */
  function mapVariables() {
    var v = state.site.map_variables;
    if (v && v.length) return v;
    return [{ column: 'Depth', label: 'Water depth', unit: 'm', colours: 'depth', decimals: 3, range: state.site.depth_colour_range }];
  }
  function currentVariable() { return mapVariables()[state.variable] || mapVariables()[0]; }
  function valueAt(p, i, variable) {
    if (variable.column === 'Depth') return p.depth[i];
    if (variable.column === 'Time of day') {   // seconds after midnight, from the line start and each sounding's offset
      if (p._startOfDay == null) {
        var m = p.start.match(/T(\d+):(\d+):(\d+(?:\.\d+)?)/);
        p._startOfDay = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
      }
      return p._startOfDay + p.t[i];
    }
    var arr = p.values && p.values[variable.column];
    return arr ? arr[i] : null;
  }
  function fmtClock(seconds, withSeconds) {
    var x = ((Math.round(seconds) % 86400) + 86400) % 86400;
    return pad(Math.floor(x / 3600)) + ':' + pad(Math.floor(x / 60) % 60) + (withSeconds ? ':' + pad(x % 60) : '');
  }
  function fmtValue(v, variable) {
    if (v == null || isNaN(v)) return 'no value';
    if (variable.format === 'time') return fmtClock(v, true);
    return Number(v).toFixed(variable.decimals) + (variable.unit ? (variable.unit === '°' ? '' : ' ') + variable.unit : '');
  }

  function drawLegend() {
    var variable = currentVariable(), ramp = RAMPS[variable.colours] || RAMPS.sequential;
    var c = el('legend-ramp'), ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, c.width, 0);
    ramp.forEach(function (col, i) { g.addColorStop(i / (ramp.length - 1), col); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    var r = colourRange(), digits = Math.min(variable.decimals, 2);
    if (r[1] - r[0] < 0.1 && digits < 3) digits = 3;
    var ticks = [r[0], (r[0] + r[1]) / 2, r[1]];
    el('legend-ticks').innerHTML = ticks.map(function (t, i) {
      var label = variable.format === 'time' ? fmtClock(t, r[1] - r[0] < 600) : Number(t).toFixed(digits);
      if (i === 0) label = '≤ ' + label;
      if (i === 2) label = '≥ ' + label;
      return '<span>' + label + '</span>';
    }).join('');
    el('legend-unit').textContent = variable.unit ? '(' + variable.unit + ')' : '';
    el('legend-note').textContent = variable.note || '';
    el('legend-note').hidden = !variable.note;
    var scaleNote = state.scaleMode === 'view'
      ? (state.viewRange ? 'Fitted to ' + fmtNum(state.viewCount) + ' soundings in view' : '')
      : 'Same scale for all data';
    el('scale-note').textContent = scaleNote;
    [].forEach.call(document.querySelectorAll('#scale-mode button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === state.scaleMode)); });
  }
  function setupVariableMenu() {
    var vars = mapVariables(), select = el('colour-by');
    try {
      var saved = localStorage.getItem('bathymap-variable');
      vars.forEach(function (v, i) { if (v.column === saved) state.variable = i; });
    } catch (e) { /* storage unavailable */ }
    // Options are grouped under their "group" (for example Bathymetry, Survey, Quality) when the variables have one.
    var html = '', group = null;
    vars.forEach(function (v, i) {
      var g = v.group || '';
      if (g !== group) {
        if (group) html += '</optgroup>';
        if (g) html += '<optgroup label="' + escapeHtml(g) + '">';
        group = g;
      }
      html += '<option value="' + i + '"' + (i === state.variable ? ' selected' : '') + '>' + escapeHtml(v.label) + '</option>';
    });
    if (group) html += '</optgroup>';
    select.innerHTML = html;
    select.disabled = vars.length < 2;
    try { if (localStorage.getItem('bathymap-scale') === 'all') state.scaleMode = 'all'; } catch (e) { /* storage unavailable */ }
    el('scale-mode').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-mode]');
      if (!b || b.getAttribute('data-mode') === state.scaleMode) return;
      state.scaleMode = b.getAttribute('data-mode');
      try { localStorage.setItem('bathymap-scale', state.scaleMode); } catch (err) { /* ignore */ }
      updateViewRange();
      recolourPoints();
      if (view3d.data) colour3d();
    });
    select.addEventListener('change', function () {
      state.variable = parseInt(select.value, 10) || 0;
      state.viewRange = null;
      try { localStorage.setItem('bathymap-variable', currentVariable().column); } catch (e) { /* ignore */ }
      drawLegend();
      Object.keys(state.pointLayers).forEach(function (id) { map.removeLayer(state.pointLayers[id]); });
      state.pointLayers = {};
      updateSoundings();
      if (highlightLayer && state.shape && map.hasLayer(highlightLayer)) highlightSelection(state.shape);
      hideProbe();
    });
  }

  /* ---------- map ---------- */
  function initMap() {
    map = L.map('map', { zoomControl: true, preferCanvas: true, maxZoom: 22 });
    renderer = L.canvas({ padding: 0.3 });

    /* Basemaps. None of these needs an API key: the OpenStreetMap server (the default) and Esri's public tile services. CARTO's maps
       are added only when the site configuration holds a CARTO key (CARTO has required one since September 2026).
       maxNativeZoom is the last zoom level each service has tiles for; closer in, its tiles are enlarged. Tiles are not
       requested during the zoom animation, and a ring of tiles around the view is kept so short pans need no requests. */
    var tileOptions = { maxZoom: 22, updateWhenZooming: false, keepBuffer: 4 };
    var ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
    function esri(service, maxNativeZoom, attribution, extra) {
      return L.tileLayer(ESRI + service + '/MapServer/tile/{z}/{y}/{x}', Object.assign({ maxNativeZoom: maxNativeZoom, attribution: attribution }, tileOptions, extra || {}));
    }
    var OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    var bases = {};
    BASEMAPS.forEach(function (b) {
      if (b.carto && !state.site.carto_api_key) return;
      if (b.carto) {
        bases[b.name] = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/' + b.carto + '/{z}/{x}/{y}{r}.png?key=' + encodeURIComponent(state.site.carto_api_key),
          Object.assign({ subdomains: 'abcd', maxNativeZoom: 20, attribution: OSM + ' &copy; <a href="https://carto.com/attributions">CARTO</a>' }, tileOptions));
      } else if (b.osm) {
        bases[b.name] = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', Object.assign({ maxNativeZoom: 19, attribution: OSM }, tileOptions));
      } else {
        bases[b.name] = esri(b.esri, b.maxNativeZoom, b.attribution);
      }
    });
    var overlays = {
      'Place names': esri('Reference/World_Boundaries_and_Places', 19, 'Place names &copy; Esri', { pane: 'overlayLabels' }),
      'Roads': esri('Reference/World_Transportation', 19, 'Roads &copy; Esri', { pane: 'overlayLabels' })
    };
    map.createPane('overlayLabels');
    map.getPane('overlayLabels').style.zIndex = 350;          // above the basemap, below tracks and soundings
    map.getPane('overlayLabels').style.pointerEvents = 'none';
    var wanted = baseKey(state.site.default_basemap), chosen = null;
    BASEMAPS.forEach(function (b) { if (b.key === wanted && bases[b.name]) chosen = b.name; });
    if (!chosen) chosen = 'OpenStreetMap';
    try { if (bases[localStorage.getItem('bathymap-base')]) chosen = localStorage.getItem('bathymap-base'); } catch (e) { /* storage unavailable */ }
    state.base = chosen;
    bases[chosen].addTo(map);
    try {
      var savedOverlays = JSON.parse(localStorage.getItem('bathymap-overlays')) || [];
      savedOverlays.forEach(function (n) { if (overlays[n]) overlays[n].addTo(map); });
    } catch (e) { /* storage unavailable */ }
    map.on('overlayadd overlayremove', function () {
      try { localStorage.setItem('bathymap-overlays', JSON.stringify(Object.keys(overlays).filter(function (n) { return map.hasLayer(overlays[n]); }))); } catch (e) { /* ignore */ }
    });
    L.control.layers(bases, overlays, { position: 'topright' }).addTo(map);
    map.on('baselayerchange', function (e) {
      state.base = e.name;
      restyleTracks();
      updateSoundings();
      try { localStorage.setItem('bathymap-base', e.name); } catch (err) { /* ignore */ }
    });
    L.control.scale({ metric: true, imperial: false, position: 'bottomleft' }).addTo(map);

    probeRing = L.circleMarker([0, 0], { radius: 7, weight: 2, color: cssVar('--accent'), fill: false, interactive: false, renderer: renderer });

    map.on('moveend zoomend', updateSoundings);
    map.on('zoomend', function () { state.projected = {}; });
    map.on('mousemove', onPointerMove);
    map.on('click', onMapClick);
    map.on('mouseout', hideProbe);
  }

  function lineInView(line) {
    var b = line.bbox, v = map.getBounds().pad(0.2);
    return !(b[2] < v.getWest() || b[0] > v.getEast() || b[3] < v.getSouth() || b[1] > v.getNorth());
  }
  function bboxBounds(b) { return L.latLngBounds([b[1], b[0]], [b[3], b[2]]); }

  function trackStyle(id) {
    // On the satellite image and the dark basemap a dark track disappears, so unselected tracks are drawn light there.
    var sel = id === state.selected, onImagery = isDarkBase();
    return { color: sel ? cssVar('--accent') : (onImagery ? '#f4f7f9' : cssVar('--track')), weight: sel ? 4 : 2.5, opacity: sel ? 0.95 : (onImagery ? 0.85 : 0.75) };
  }
  function drawTracks() {
    state.lines.forEach(function (line) {
      var t = L.polyline(line.track, Object.assign({ renderer: renderer, interactive: true, bubblingMouseEvents: false }, trackStyle(line.id)));
      t.on('click', function (e) {
        if (state.mode === 'polygon') { addPolygonVertex(e.latlng); return; }
        if (!state.mode) selectLine(line.id, true);
      });
      t.bindTooltip(line.line + ' · ' + fmtDate(line.date), { sticky: true, direction: 'top', opacity: 0.95 });
      state.tracks[line.id] = t;
      t.addTo(map);
    });
  }
  function restyleTracks() {
    Object.keys(state.tracks).forEach(function (id) { state.tracks[id].setStyle(trackStyle(id)); });
    if (state.selected && state.tracks[state.selected]) state.tracks[state.selected].bringToFront();
    probeRing.setStyle({ color: cssVar('--accent') });
    if (shapeLayer) shapeLayer.setStyle(SHAPE_STYLE());
  }

  /* Starts the download of a line's soundings once. The map is redrawn when the file arrives. A line whose file fails
     to load is marked as failed and not requested again, so a missing file can never keep the page busy. */
  function loadPoints(line) {
    if (state.points[line.id] || state.loading[line.id] || state.failed[line.id]) return;
    state.loading[line.id] = true;
    fetch(line.files.points).then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.json();
    }).then(function (p) {
      state.points[line.id] = p;
    }).catch(function (err) {
      state.failed[line.id] = true;
      console.error('Could not load soundings for ' + line.id, err);
    }).then(function () {
      state.loading[line.id] = false;
      updateSoundings();
    });
  }

  function pointRadius() {
    var z = map.getZoom();
    return z >= 20 ? 5 : z >= 18 ? 4 : z >= 16 ? 3 : 2;
  }
  function buildPointLayer(id) {
    var p = state.points[id], r = pointRadius(), group = L.layerGroup();
    var variable = currentVariable(), range = colourRange();
    // A light outline keeps dark (deep) soundings visible over dark water on the satellite image and dark basemap.
    var outline = isDarkBase() ? 'rgba(255,255,255,0.75)' : 'rgba(15,37,51,0.45)';
    group.markers = [];
    for (var i = 0; i < p.lat.length; i++) {
      group.markers.push(L.circleMarker([p.lat[i], p.lon[i]], {
        renderer: renderer, radius: r, stroke: true, weight: 0.7, color: outline,
        fillColor: rampColour(valueAt(p, i, variable), range, variable.colours), fillOpacity: 0.95, interactive: false
      }).addTo(group));
    }
    group.radius = r;
    group.base = state.base;
    return group;
  }
  function recolourPoints() {
    var variable = currentVariable(), range = colourRange();
    Object.keys(state.pointLayers).forEach(function (id) {
      var p = state.points[id], markers = state.pointLayers[id].markers;
      for (var i = 0; i < markers.length; i++) markers[i].setStyle({ fillColor: rampColour(valueAt(p, i, variable), range, variable.colours) });
    });
  }

  /* ---------- colour scale for the current view ----------
     With the scale set to "This view", the colours stretch over the 2nd to 98th percentile of the soundings shown in
     the map view, so small differences stand out wherever the visitor zooms. "All data" keeps one fixed scale for
     every survey, so colours can be compared between places. */
  function colourRange() {
    var variable = currentVariable();
    return state.scaleMode === 'view' && state.viewRange ? state.viewRange : variable.range;
  }
  function percentile(sorted, q) {
    var pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }
  function updateViewRange() {
    var previous = state.viewRange, next = null;
    if (state.scaleMode === 'view') {
      var variable = currentVariable(), bounds = map.getBounds(), values = [];
      Object.keys(state.pointLayers).forEach(function (id) {
        var p = state.points[id];
        for (var i = 0; i < p.lat.length; i++) {
          if (!bounds.contains([p.lat[i], p.lon[i]])) continue;
          var v = valueAt(p, i, variable);
          if (v != null && !isNaN(v)) values.push(v);
        }
      });
      if (values.length >= 10) {
        values.sort(function (a, b) { return a - b; });
        next = [percentile(values, 0.02), percentile(values, 0.98)];
        if (next[1] - next[0] < 1e-6) next = [values[0], values[values.length - 1]];
        if (next[1] - next[0] < 1e-6) next = [next[0] - 0.01, next[1] + 0.01];
        if (variable.colours === 'diverging') {   // keep zero in the middle (white)
          var half = Math.max(Math.abs(next[0]), Math.abs(next[1]));
          next = [-half, half];
        }
      }
      state.viewCount = values.length;
    }
    state.viewRange = next;
    var changed = !previous !== !next || (previous && next && (Math.abs(previous[0] - next[0]) > 1e-9 || Math.abs(previous[1] - next[1]) > 1e-9));
    if (changed) recolourPoints();
    drawLegend();
  }

  function wantsPoints(line) {
    if (state.hidden[line.id]) return false;
    if (line.id === state.selected) return true;
    return map.getZoom() >= POINT_ZOOM && lineInView(line);
  }

  function updateSoundings() {
    state.lines.forEach(function (line) {
      var want = wantsPoints(line), layer = state.pointLayers[line.id];
      if (!want) {
        if (layer) { map.removeLayer(layer); delete state.pointLayers[line.id]; }
        return;
      }
      if (!state.points[line.id]) { loadPoints(line); return; }
      if (layer && (layer.radius !== pointRadius() || layer.base !== state.base)) { map.removeLayer(layer); layer = null; }
      if (!layer) { state.pointLayers[line.id] = buildPointLayer(line.id).addTo(map); }
    });
    var showing = Object.keys(state.pointLayers).length > 0;
    el('legend-hint').textContent = showing ? 'Hover or tap a sounding for its value, date and time' : 'Zoom in or select a line to see soundings';
    updateViewRange();
    updateSiteMarkers();
  }

  /* ---------- location markers ----------
     Zoomed out, a survey only a few hundred metres across shrinks to a speck. Every line drawn smaller than
     SITE_MARKER_PX on screen is represented by a labelled marker instead; markers that would overlap merge into one,
     labelled with the location name (metadata "location") or the number of locations. Clicking a marker zooms to it. */
  var SITE_MARKER_PX = 40, SITE_MERGE_PX = 70;
  var siteLayer = null;
  function lineLocation(line) { return (line.metadata && line.metadata.location) ? String(line.metadata.location) : ''; }
  function updateSiteMarkers() {
    if (!siteLayer) siteLayer = L.layerGroup().addTo(map);
    siteLayer.clearLayers();
    var z = map.getZoom(), clusters = [];
    state.lines.forEach(function (line) {
      if (state.hidden[line.id] || !lineMatchesLocation(line)) return;
      var b = line.bbox, a = map.project([b[1], b[0]], z), c = map.project([b[3], b[2]], z);
      if (Math.max(Math.abs(c.x - a.x), Math.abs(c.y - a.y)) >= SITE_MARKER_PX) return;
      var centre = L.point((a.x + c.x) / 2, (a.y + c.y) / 2), home = null;
      for (var k = 0; k < clusters.length; k++) {
        if (clusters[k].centre.distanceTo(centre) < SITE_MERGE_PX) { home = clusters[k]; break; }
      }
      if (!home) { home = { centre: centre, lines: [], bounds: bboxBounds(b), names: {} }; clusters.push(home); }
      home.lines.push(line);
      home.bounds.extend(bboxBounds(b));
      home.names[lineLocation(line) || 'Unnamed location'] = true;
    });
    clusters.forEach(function (cl) {
      var names = Object.keys(cl.names), count = cl.lines.length;
      var pts = cl.lines.reduce(function (s, l) { return s + l.points; }, 0);
      var title = names.length === 1 ? names[0] : names.length + ' locations';
      var sub = count + (count === 1 ? ' line' : ' lines') + ' · ' + fmtNum(pts) + ' soundings';
      var icon = L.divIcon({
        className: 'site-marker', iconSize: null,
        html: '<div class="site-pin"><span class="site-dot"></span><span class="site-text"><b>' + escapeHtml(title) + '</b><small>' + sub + '</small></span></div>'
      });
      var m = L.marker(cl.bounds.getCenter(), { icon: icon, keyboard: true, title: title + ': zoom in', riseOnHover: true });
      m.on('click', function () { map.fitBounds(cl.bounds, { padding: [60, 60], maxZoom: 19 }); });
      m.addTo(siteLayer);
    });
  }

  /* ---------- probe (nearest sounding under the pointer) ---------- */
  function nearestSounding(containerPoint) {
    var z = map.getZoom(), target = map.containerPointToLayerPoint(containerPoint).add(map.getPixelOrigin());
    var best = null, bestD = 12 * 12;
    Object.keys(state.pointLayers).forEach(function (id) {
      var p = state.points[id];
      var proj = state.projected[id];
      if (!proj) {
        proj = new Float64Array(p.lat.length * 2);
        for (var i = 0; i < p.lat.length; i++) {
          var q = map.project([p.lat[i], p.lon[i]], z);
          proj[2 * i] = q.x; proj[2 * i + 1] = q.y;
        }
        state.projected[id] = proj;
      }
      for (var j = 0; j < p.lat.length; j++) {
        var dx = proj[2 * j] - target.x, dy = proj[2 * j + 1] - target.y, d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = { id: id, i: j }; }
      }
    });
    return best;
  }
  function showProbe(hit, containerPoint) {
    var p = state.points[hit.id], line = state.byId[hit.id], box = el('probe');
    var when = soundingDateTime(p, hit.i), ref = state.site.time_reference, variable = currentVariable();
    var main = '<strong>' + fmtValue(p.depth[hit.i], mapVariables()[0]) + '</strong>';
    if (variable.column !== 'Depth') {
      main = '<span class="probe-label">' + escapeHtml(variable.label) + '</span><strong>' + fmtValue(valueAt(p, hit.i, variable), variable) + '</strong>' +
        '<span class="probe-depth">Depth ' + fmtValue(p.depth[hit.i], mapVariables()[0]) + '</span>';
    }
    box.innerHTML = main +
      '<span class="probe-when">' + when.date + ' · <span class="data-ink">' + when.time + '</span>' +
      (ref && ref.length <= 16 ? ' ' + escapeHtml(ref) : '') + '</span>' +
      '<span class="data">' + escapeHtml(line.line) + ' · ' + p.lat[hit.i].toFixed(7) + ', ' + p.lon[hit.i].toFixed(7) + '</span>';
    box.hidden = false;
    var size = map.getSize(), x = containerPoint.x + 14, y = containerPoint.y + 14;
    if (x + box.offsetWidth > size.x - 8) x = containerPoint.x - box.offsetWidth - 14;
    if (y + box.offsetHeight > size.y - 8) y = containerPoint.y - box.offsetHeight - 14;
    box.style.left = Math.max(4, x) + 'px';
    box.style.top = Math.max(4, y) + 'px';
    probeRing.setLatLng([p.lat[hit.i], p.lon[hit.i]]);
    if (!map.hasLayer(probeRing)) probeRing.addTo(map);
  }
  function hideProbe() {
    el('probe').hidden = true;
    if (map.hasLayer(probeRing)) map.removeLayer(probeRing);
  }
  var probeQueued = null;
  function onPointerMove(e) {
    if (state.mode) { if (state.mode === 'polygon') updatePolygonDraft(e.latlng); return; }
    if (probeQueued) { probeQueued = e; return; }
    probeQueued = e;
    requestAnimationFrame(function () {
      var ev = probeQueued; probeQueued = null;
      var hit = nearestSounding(ev.containerPoint);
      if (hit) showProbe(hit, ev.containerPoint); else hideProbe();
    });
  }
  function onMapClick(e) {
    if (state.mode === 'polygon') { addPolygonVertex(e.latlng); return; }
    if (state.mode || Date.now() < (state.suppressClickUntil || 0)) return;
    var hit = nearestSounding(e.containerPoint);
    if (hit) { showProbe(hit, e.containerPoint); if (hit.id !== state.selected) selectLine(hit.id, false); }
    else hideProbe();
  }

  /* ---------- area selection and CSV export ----------
     The visitor draws a box or a polygon. Every sounding of the lines shown on the map that falls inside it is taken
     from the full-resolution CSV of its line (not the thinned map points), so the export is the complete record. */
  var SHAPE_STYLE = function () {
    return { color: cssVar('--accent'), weight: 2, dashArray: '6 4', fillColor: cssVar('--accent'), fillOpacity: 0.08, interactive: false };
  };
  var shapeLayer = null, draftLine = null, highlightLayer = null, boxStart = null;

  /* A button under the zoom buttons that zooms out to show every survey line. */
  function addZoomAllControl() {
    var Control = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        var bar = L.DomUtil.create('div', 'leaflet-bar select-tools');
        bar.innerHTML = '<a href="#" role="button" id="zoom-all" title="Zoom to all data" aria-label="Zoom to all data">' +
          '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 7.5v-4h4M12.5 3.5h4v4M16.5 12.5v4h-4M7.5 16.5h-4v-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>' +
          '<circle cx="10" cy="10" r="2" fill="currentColor"/></svg></a>';
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.on(bar.querySelector('#zoom-all'), 'click', function (e) { L.DomEvent.preventDefault(e); zoomToAll(); });
        return bar;
      }
    });
    new Control().addTo(map);
  }
  function zoomToAll() {
    show3d(false);
    if (state.site.bbox) fitView(bboxBounds(state.site.bbox));
    else map.setView([20, 0], 2);
  }

  function addSelectionControl() {
    var Control = L.Control.extend({
      options: { position: 'topleft' },
      onAdd: function () {
        var bar = L.DomUtil.create('div', 'leaflet-bar select-tools');
        bar.innerHTML =
          '<a href="#" role="button" id="tool-box" title="Select soundings with a box" aria-label="Select soundings with a box">' +
          '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.5" y="5" width="13" height="10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 2"/></svg></a>' +
          '<a href="#" role="button" id="tool-polygon" title="Select soundings with a polygon" aria-label="Select soundings with a polygon">' +
          '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 7.5 9.5 3.5 16.5 6.5 15 15.5 6 16z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2.5 2" stroke-linejoin="round"/></svg></a>';
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.on(bar.querySelector('#tool-box'), 'click', function (e) { L.DomEvent.preventDefault(e); startDrawing(state.mode === 'box' ? null : 'box'); });
        L.DomEvent.on(bar.querySelector('#tool-polygon'), 'click', function (e) { L.DomEvent.preventDefault(e); startDrawing(state.mode === 'polygon' ? null : 'polygon'); });
        return bar;
      }
    });
    new Control().addTo(map);

    var c = map.getContainer();
    c.addEventListener('pointerdown', onBoxDown);
    c.addEventListener('pointermove', onBoxMove);
    c.addEventListener('pointerup', onBoxUp);
    map.on('dblclick', function () { if (state.mode === 'polygon') finishPolygon(true); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.mode) startDrawing(null); });
    el('select-bar').addEventListener('click', onSelectBarClick);
  }

  function startDrawing(mode) {
    endDrawing();
    state.mode = mode;
    var c = map.getContainer();
    document.querySelectorAll('.select-tools a').forEach(function (a) { a.classList.remove('active'); a.setAttribute('aria-pressed', 'false'); });
    if (!mode) { renderSelectBar(); return; }
    hideProbe();
    clearAreaSelection(true);
    var btn = el(mode === 'box' ? 'tool-box' : 'tool-polygon');
    btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
    L.DomUtil.addClass(c, 'drawing');
    if (mode === 'box') map.dragging.disable();
    map.doubleClickZoom.disable();
    state.draft = { vertices: [] };
    renderSelectBar();
  }
  function endDrawing() {
    var c = map.getContainer();
    L.DomUtil.removeClass(c, 'drawing');
    map.dragging.enable();
    setTimeout(function () { map.doubleClickZoom.enable(); }, 300);
    if (draftLine) { map.removeLayer(draftLine); draftLine = null; }
    if (state.draft && state.draft.rect) map.removeLayer(state.draft.rect);
    state.draft = null;
    state.mode = null;
    boxStart = null;
    document.querySelectorAll('.select-tools a').forEach(function (a) { a.classList.remove('active'); a.setAttribute('aria-pressed', 'false'); });
  }

  // Box: press, drag and release anywhere on the map
  function onBoxDown(e) {
    if (state.mode !== 'box' || e.button > 0 || e.target.closest('.leaflet-control')) return;
    boxStart = map.mouseEventToLatLng(e);
    state.draft.rect = L.rectangle(L.latLngBounds(boxStart, boxStart), SHAPE_STYLE()).addTo(map);
    try { map.getContainer().setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function onBoxMove(e) {
    if (state.mode !== 'box' || !boxStart) return;
    state.draft.rect.setBounds(L.latLngBounds(boxStart, map.mouseEventToLatLng(e)));
  }
  function onBoxUp(e) {
    if (state.mode !== 'box' || !boxStart) return;
    var bounds = L.latLngBounds(boxStart, map.mouseEventToLatLng(e));
    var a = map.latLngToContainerPoint(bounds.getSouthWest()), b = map.latLngToContainerPoint(bounds.getNorthEast());
    if (Math.abs(a.x - b.x) < 6 || Math.abs(a.y - b.y) < 6) {   // a tap, not a drag: keep waiting for a box
      map.removeLayer(state.draft.rect); state.draft.rect = null; boxStart = null;
      return;
    }
    endDrawing();
    state.suppressClickUntil = Date.now() + 400;   // the browser fires a click after the drag; ignore it
    runSelection({ type: 'box', bounds: bounds, latlngs: [bounds.getSouthWest(), bounds.getNorthWest(), bounds.getNorthEast(), bounds.getSouthEast()] });
  }

  // Polygon: click or tap each corner; close on the first corner, a double-click, or Finish
  function addPolygonVertex(latlng) {
    var v = state.draft.vertices;
    if (v.length >= 3) {
      var first = map.latLngToContainerPoint(v[0]), here = map.latLngToContainerPoint(latlng);
      if (first.distanceTo(here) < 14) { finishPolygon(false); return; }
    }
    v.push(latlng);
    updatePolygonDraft(null);
    renderSelectBar();
  }
  function updatePolygonDraft(cursor) {
    if (!state.draft) return;
    var pts = state.draft.vertices.slice();
    if (!pts.length) return;
    if (cursor) pts.push(cursor);
    if (pts.length > 1) pts.push(pts[0]);
    if (!draftLine) draftLine = L.polyline(pts, SHAPE_STYLE()).addTo(map); else draftLine.setLatLngs(pts);
  }
  function finishPolygon(fromDoubleClick) {
    var v = state.draft ? state.draft.vertices.slice() : [];
    if (fromDoubleClick && v.length > 1) {   // a double-click also fired two clicks at the same spot
      var a = map.latLngToContainerPoint(v[v.length - 1]), b = map.latLngToContainerPoint(v[v.length - 2]);
      if (a.distanceTo(b) < 6) v.pop();
    }
    if (v.length < 3) { renderSelectBar('Add at least three corners to close the shape.'); return; }
    endDrawing();
    runSelection({ type: 'polygon', bounds: L.latLngBounds(v), latlngs: v });
  }

  function inShape(lat, lon, shape) {
    if (shape.type === 'box') return shape.bounds.contains([lat, lon]);
    var inside = false, v = shape.latlngs;
    for (var i = 0, j = v.length - 1; i < v.length; j = i++) {
      var yi = v[i].lat, xi = v[i].lng, yj = v[j].lat, xj = v[j].lng;
      if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  // Small CSV reader for the files written by the build (handles quoted fields)
  function parseCsvLine(s) {
    if (s.indexOf('"') === -1) return s.split(',');
    var out = [], cur = '', q = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (q) {
        if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch;
      } else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  }
  function csvField(v) { return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function loadCsv(line) {
    if (state.csv[line.id]) return Promise.resolve(state.csv[line.id]);
    return fetch(line.files.csv).then(function (r) {
      if (!r.ok) throw new Error(line.files.csv + ' returned ' + r.status);
      return r.text();
    }).then(function (text) {
      var rows = text.split(/\r?\n/), header = parseCsvLine(rows[0]), data = [];
      for (var i = 1; i < rows.length; i++) if (rows[i]) data.push(parseCsvLine(rows[i]));
      var parsed = {
        header: header, rows: data,
        lat: header.indexOf('Latitude'), lon: header.indexOf('Longitude'),
        depth: header.indexOf('Depth'), datetime: header.indexOf('Datetime'), id: header.indexOf('id')
      };
      state.csv[line.id] = parsed;
      return parsed;
    });
  }

  function runSelection(shape) {
    var run = ++state.selectionRun;
    state.shape = shape;
    if (shapeLayer) map.removeLayer(shapeLayer);
    shapeLayer = L.polygon(shape.latlngs, SHAPE_STYLE()).addTo(map);
    var lines = state.lines.filter(function (l) { return !state.hidden[l.id] && bboxBounds(l.bbox).intersects(shape.bounds); });
    state.selection = { loading: true, lineCount: lines.length };
    renderSelectBar();
    Promise.all(lines.map(loadCsv)).then(function (csvs) {
      if (run !== state.selectionRun) return;
      var picked = [], header = null, perLine = 0, dMin = Infinity, dMax = -Infinity, first = null, last = null;
      csvs.forEach(function (c, cx) {
        var n = 0;
        c.rows.forEach(function (r) {
          var lat = parseFloat(r[c.lat]), lon = parseFloat(r[c.lon]);
          if (!inShape(lat, lon, shape)) return;
          var out = [lines[cx].id];
          for (var k = 0; k < r.length; k++) if (k !== c.id) out.push(r[k]);
          picked.push(out);
          n++;
          var d = parseFloat(r[c.depth]);
          if (d < dMin) dMin = d;
          if (d > dMax) dMax = d;
          var t = r[c.datetime];
          if (first === null || t < first) first = t;
          if (last === null || t > last) last = t;
        });
        if (n) perLine++;
        if (!header) header = ['Line'].concat(c.header.filter(function (h, k) { return k !== c.id; }));
      });
      state.selection = { rows: picked, header: header, lineCount: perLine, depthMin: dMin, depthMax: dMax, first: first, last: last };
      highlightSelection(shape);
      renderSelectBar();
    }).catch(function (err) {
      console.error(err);
      if (run !== state.selectionRun) return;
      state.selection = { error: 'The soundings could not be loaded (' + err.message + '). Try again in a moment.' };
      renderSelectBar();
    });
  }

  function highlightSelection(shape) {
    if (highlightLayer) map.removeLayer(highlightLayer);
    highlightLayer = L.layerGroup();
    var count = 0, accent = cssVar('--accent');
    Object.keys(state.points).forEach(function (id) {
      if (state.hidden[id]) return;
      var p = state.points[id];
      for (var i = 0; i < p.lat.length && count < 8000; i++) {
        if (!inShape(p.lat[i], p.lon[i], shape)) continue;
        L.circleMarker([p.lat[i], p.lon[i]], { renderer: renderer, radius: pointRadius() + 2, weight: 1.5, color: accent, fill: false, interactive: false }).addTo(highlightLayer);
        count++;
      }
    });
    highlightLayer.addTo(map);
  }

  function clearAreaSelection(keepBar) {
    state.selectionRun++;
    state.shape = null;
    state.selection = null;
    if (shapeLayer) { map.removeLayer(shapeLayer); shapeLayer = null; }
    if (highlightLayer) { map.removeLayer(highlightLayer); highlightLayer = null; }
    if (!keepBar) renderSelectBar();
  }

  function downloadSelection() {
    var s = state.selection;
    if (!s || !s.rows || !s.rows.length) return;
    var parts = [s.header.map(csvField).join(',')];
    for (var i = 0; i < s.rows.length; i++) parts.push(s.rows[i].map(csvField).join(','));
    var blob = new Blob([parts.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
    var now = new Date();
    var name = 'bathymetry-selection_' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + '_' +
      pad(now.getHours()) + pad(now.getMinutes()) + '_' + s.rows.length + '-soundings.csv';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function fmtSpan(first, last) {
    if (!first) return '';
    if (first.slice(0, 10) === last.slice(0, 10)) return fmtDate(first) + ', ' + first.slice(11, 22) + '–' + last.slice(11, 22);
    return fmtDateTime(first) + ' – ' + fmtDateTime(last);
  }
  function renderSelectBar(warning) {
    var bar = el('select-bar'), s = state.selection, html = '';
    if (state.mode === 'box') {
      html = '<p>Drag a box over the soundings you want to export.</p><div class="select-actions"><button type="button" class="button ghost" data-act="cancel">Cancel</button></div>';
    } else if (state.mode === 'polygon') {
      var n = state.draft ? state.draft.vertices.length : 0;
      html = '<p>' + (warning ? escapeHtml(warning) : n ? n + (n === 1 ? ' corner. ' : ' corners. ') + 'Keep adding corners, then tap the first corner or Finish.' : 'Click or tap the map to place the first corner of the area.') + '</p>' +
        '<div class="select-actions"><button type="button" class="button" data-act="finish"' + (n < 3 ? ' disabled' : '') + '>Finish</button>' +
        '<button type="button" class="button ghost" data-act="cancel">Cancel</button></div>';
    } else if (s && s.loading) {
      html = '<p>Collecting soundings from ' + s.lineCount + (s.lineCount === 1 ? ' line' : ' lines') + '…</p>';
    } else if (s && s.error) {
      html = '<p>' + escapeHtml(s.error) + '</p><div class="select-actions"><button type="button" class="button ghost" data-act="clear">Clear</button></div>';
    } else if (s && s.rows && s.rows.length) {
      html = '<p><strong class="data-ink">' + fmtNum(s.rows.length) + '</strong> soundings selected from ' + s.lineCount + (s.lineCount === 1 ? ' line' : ' lines') + '</p>' +
        '<p class="select-meta"><span class="data-ink">' + fmtDepth(s.depthMin) + '–' + fmtDepth(s.depthMax) + ' m</span> · ' + escapeHtml(fmtSpan(s.first, s.last)) + '</p>' +
        '<div class="select-actions"><button type="button" class="button" data-act="download">Download CSV</button>' +
        '<button type="button" class="button ghost" data-act="clear">Clear</button></div>';
    } else if (s && s.rows) {
      html = '<p>No soundings inside this area. Only lines shown on the map are included.</p><div class="select-actions"><button type="button" class="button ghost" data-act="clear">Clear</button></div>';
    }
    bar.innerHTML = html;
    bar.hidden = !html;
  }
  function onSelectBarClick(e) {
    var act = e.target.getAttribute('data-act');
    if (act === 'cancel') startDrawing(null);
    else if (act === 'finish') finishPolygon(false);
    else if (act === 'clear') clearAreaSelection(false);
    else if (act === 'download') downloadSelection();
  }

  /* ---------- panel ---------- */
  function groupLines() {
    // Survey days (date and area), newest first, each placed under its location; named locations come in
    // alphabetical order and lines without a location come last.
    var groups = {}, order = [];
    state.lines.forEach(function (line) {
      var key = line.date + '|' + line.area + '|' + lineLocation(line);
      if (!groups[key]) { groups[key] = { date: line.date, area: line.area, location: lineLocation(line), lines: [] }; order.push(key); }
      groups[key].lines.push(line);
    });
    order.sort(function (a, b) {
      var la = groups[a].location, lb = groups[b].location;
      if (la !== lb) { if (!la) return 1; if (!lb) return -1; return la.localeCompare(lb); }
      return a < b ? 1 : a > b ? -1 : 0;
    });
    return order.map(function (k) {
      groups[k].lines.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
      return groups[k];
    });
  }
  function lineMatchesLocation(line) {
    if (!state.location) return true;
    return state.location === '\u0000none' ? !lineLocation(line) : lineLocation(line) === state.location;
  }
  function setupLocationFilter() {
    var counts = {}, unnamed = 0;
    state.lines.forEach(function (l) { var n = lineLocation(l); if (n) counts[n] = (counts[n] || 0) + 1; else unnamed++; });
    var names = Object.keys(counts).sort(function (a, b) { return a.localeCompare(b); });
    var select = el('location-filter');
    if (!names.length) { select.hidden = true; return; }
    var html = '<option value="">All locations (' + state.lines.length + ' lines)</option>';
    names.forEach(function (n) { html += '<option value="' + escapeHtml(n) + '">' + escapeHtml(n) + ' (' + counts[n] + ')</option>'; });
    if (unnamed) html += '<option value="\u0000none">No location given (' + unnamed + ')</option>';
    select.innerHTML = html;
    select.hidden = false;
    select.addEventListener('change', function () {
      state.location = select.value;
      renderList();
      updateSiteMarkers();
      var bounds = null;
      state.lines.forEach(function (l) {
        if (!lineMatchesLocation(l)) return;
        if (bounds) bounds.extend(bboxBounds(l.bbox)); else bounds = bboxBounds(l.bbox);
      });
      if (bounds) fitView(bounds);
    });
  }
  /* Fits the map to the bounds; when location markers are showing, leaves room on the right for their labels. */
  function fitView(bounds) {
    // Keep the data clear of the map buttons (top left) and the colour legend (bottom right).
    var size = map.getSize(), legend = el('legend');
    var right = Math.min(legend.offsetWidth + 30, size.x * 0.35), bottom = Math.min(legend.offsetHeight + 30, size.y * 0.35);
    var options = { paddingTopLeft: [70, 40], paddingBottomRight: [right, bottom], maxZoom: 19 };
    map.fitBounds(bounds, options);
    updateSoundings();
    if (siteLayer && siteLayer.getLayers().length) {
      options.paddingBottomRight = [Math.max(right, 210), bottom];   // room for the marker labels, which extend right
      map.fitBounds(bounds, options);
    }
  }
  function matchesFilter(line) {
    if (!state.filter) return true;
    var md = line.metadata || {};
    var hay = line.name + ' ' + line.line + ' ' + line.area + ' ' + line.date + ' ' + fmtDate(line.date) + ' ' + line.folder;
    Object.keys(md).forEach(function (k) { hay += ' ' + (typeof md[k] === 'object' ? JSON.stringify(md[k]) : md[k]); });
    hay = hay.toLowerCase();
    return hay.indexOf(state.filter) !== -1;
  }
  function depthBar(line) {
    var r = state.site.depth_colour_range, span = Math.max(r[1], line.depth_max) || 1;
    var left = Math.max(0, line.depth_min / span * 100), width = Math.max(4, (line.depth_max - line.depth_min) / span * 100);
    return '<span style="left:' + left.toFixed(1) + '%;width:' + Math.min(100 - left, width).toFixed(1) + '%;background:linear-gradient(90deg,' +
      depthColour(line.depth_min) + ',' + depthColour(line.depth_max) + ')"></span>';
  }
  /* The list: an optional heading per location, then survey days, then lines. Every level can be collapsed, and has a
     checkbox that shows or hides all its lines on the map (mixed when only some are shown). The list opens collapsed
     unless the site configuration sets start_with_list_collapsed to false. */
  var CHEVRON = '<svg class="chev" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 2l4 3-4 3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
  /* Folds every location (or, when no locations are named, every survey day), so the list fits on one screen. */
  function collapseAll() {
    var anyLocation = state.lines.some(function (l) { return !!lineLocation(l); });
    state.collapsed = {};
    state.lines.forEach(function (l) {
      if (anyLocation) state.collapsed['loc:' + lineLocation(l)] = true;
      else state.collapsed['day:' + l.date + '|' + l.area + '|' + lineLocation(l)] = true;
    });
  }
  function setCheckbox(lines) {
    var shown = lines.filter(function (l) { return !state.hidden[l.id]; }).length;
    return ' data-ids="' + escapeHtml(lines.map(function (l) { return l.id; }).join(' ')) + '" data-state="' +
      (shown === 0 ? 'none' : shown === lines.length ? 'all' : 'mixed') + '"' + (shown > 0 ? ' checked' : '');
  }
  function idsAttr(lines) { return ' data-ids="' + escapeHtml(lines.map(function (l) { return l.id; }).join(' ')) + '"'; }
  function lineRow(line) {
    var hidden = !!state.hidden[line.id];
    return '<div class="line-row' + (line.id === state.selected ? ' selected' : '') + (hidden ? ' hidden-line' : '') + '" data-id="' + escapeHtml(line.id) + '" role="button" tabindex="0" aria-pressed="' + (line.id === state.selected) + '">' +
      '<input type="checkbox" id="show-' + escapeHtml(line.id) + '" aria-label="Show ' + escapeHtml(line.line) + ' on the map"' + (hidden ? '' : ' checked') + '>' +
      '<div class="line-main"><div class="line-name">' + escapeHtml(line.line) + '</div>' +
      '<div class="line-sub">' + fmtTime(line.start) + '–' + fmtTime(line.end) + ' · ' + fmtNum(line.points) + ' soundings</div></div>' +
      '<div class="line-depth"><span class="data">' + fmtDepth(line.depth_min) + '–' + fmtDepth(line.depth_max) + ' m</span><div class="depth-bar">' + depthBar(line) + '</div></div>' +
      '</div>';
  }
  function renderList() {
    var list = el('line-list');
    if (!state.lines.length) {
      list.innerHTML = '<p class="note">No survey lines yet. Add .dep files to the data folder of the repository and push; the map rebuilds automatically.</p>';
      el('list-tools').hidden = true;
      return;
    }
    var anyLocation = state.lines.some(function (l) { return !!lineLocation(l); });
    var sections = [], byLocation = {}, visible = [];
    groupLines().forEach(function (g) {
      var lines = g.lines.filter(function (l) { return matchesFilter(l) && lineMatchesLocation(l); });
      if (!lines.length) return;
      visible = visible.concat(lines);
      var lk = anyLocation ? g.location : '';
      if (!byLocation.hasOwnProperty(lk)) { byLocation[lk] = { location: lk, groups: [], lines: [] }; sections.push(byLocation[lk]); }
      byLocation[lk].groups.push({ g: g, lines: lines });
      byLocation[lk].lines = byLocation[lk].lines.concat(lines);
    });
    var html = '';
    sections.forEach(function (sec) {
      var locKey = 'loc:' + sec.location, locOpen = !state.collapsed[locKey], inner = '';
      sec.groups.forEach(function (item) {
        var g = item.g, lines = item.lines, dayKey = 'day:' + g.date + '|' + g.area + '|' + g.location, dayOpen = !state.collapsed[dayKey];
        var pts = lines.reduce(function (n, l) { return n + l.points; }, 0);
        inner += '<div class="group' + (dayOpen ? '' : ' collapsed') + '"><div class="group-head">' +
          '<input type="checkbox" class="set-check" aria-label="Show all lines of ' + escapeHtml(fmtDate(g.date)) + ' on the map"' + setCheckbox(lines) + '>' +
          '<button type="button" class="collapse" data-key="' + escapeHtml(dayKey) + '" aria-expanded="' + dayOpen + '" aria-label="' + (dayOpen ? 'Collapse ' : 'Expand ') + escapeHtml(fmtDate(g.date)) + '">' + CHEVRON + '</button>' +
          '<button type="button" class="zoom-to group-title" data-key="' + escapeHtml(dayKey) + '"' + idsAttr(lines) + ' title="Zoom to this survey day">' +
          '<h3>' + escapeHtml(fmtDate(g.date)) + '</h3>' +
          '<span class="note">' + escapeHtml(g.area) + ' · ' + lines.length + (lines.length === 1 ? ' line · ' : ' lines · ') + fmtNum(pts) + ' soundings</span></button>' +
          (bedFor(dayKey.slice(4)) ? '<button type="button" class="open-3d" data-bed="' + escapeHtml(dayKey.slice(4)) + '" aria-pressed="' + (!el('view3d').hidden && view3d.key === dayKey.slice(4)) + '" title="Open this survey day in 3D">' + CUBE + '3D</button>' : '') +
          '</div>';
        if (dayOpen) inner += '<div class="group-body">' + lines.map(lineRow).join('') + '</div>';
        inner += '</div>';
      });
      if (!anyLocation) { html += inner; return; }
      var name = sec.location || 'No location given';
      html += '<section class="location' + (locOpen ? '' : ' collapsed') + '"><div class="location-head">' +
        '<input type="checkbox" class="set-check" aria-label="Show all lines of ' + escapeHtml(name) + ' on the map"' + setCheckbox(sec.lines) + '>' +
        '<button type="button" class="collapse" data-key="' + escapeHtml(locKey) + '" aria-expanded="' + locOpen + '" aria-label="' + (locOpen ? 'Collapse ' : 'Expand ') + escapeHtml(name) + '">' + CHEVRON + '</button>' +
        '<button type="button" class="zoom-to location-title" data-key="' + escapeHtml(locKey) + '"' + idsAttr(sec.lines) + ' title="Zoom to ' + escapeHtml(name) + '">' +
        '<span class="location-name">' + escapeHtml(name) + '</span><span class="location-count">' + sec.lines.length + (sec.lines.length === 1 ? ' line' : ' lines') + '</span></button></div>' +
        (locOpen ? '<div class="location-body">' + inner + '</div>' : '') + '</section>';
    });
    list.innerHTML = html || '<p class="note">No lines match this filter.</p>';
    [].forEach.call(list.querySelectorAll('.set-check[data-state="mixed"]'), function (c) { c.indeterminate = true; });

    var tools = el('list-tools'), all = el('check-all'), shown = visible.filter(function (l) { return !state.hidden[l.id]; }).length;
    tools.hidden = !visible.length;
    all.checked = shown > 0;
    all.indeterminate = shown > 0 && shown < visible.length;
    all.setAttribute('data-ids', visible.map(function (l) { return l.id; }).join(' '));
    el('check-all-label').textContent = (state.filter || state.location ? 'All matching lines' : 'All lines') + ' (' + visible.length + ')';
  }
  /* Opens the sections holding a line, so a line selected on the map can be seen in the list. */
  function expandLine(line) {
    var g = 'day:' + line.date + '|' + line.area + '|' + lineLocation(line), l = 'loc:' + lineLocation(line);
    delete state.collapsed[g]; delete state.collapsed[l];
  }
  /* Keeps the selected row where the visitor sees it: in place when it was clicked in the list (as far as the line
     details opening above the list allow), otherwise scrolled into view. */
  function revealRow(id, anchorTop) {
    var panel = el('list-scroll'), row = el('line-list').querySelector('.line-row[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
    if (!row) return;
    if (anchorTop != null) panel.scrollTop += row.getBoundingClientRect().top - anchorTop;
    var pr = panel.getBoundingClientRect(), rr = row.getBoundingClientRect();
    if (rr.top < pr.top + 8) panel.scrollTop -= pr.top + 8 - rr.top;
    else if (rr.bottom > pr.bottom - 8) panel.scrollTop += rr.bottom - pr.bottom + 8;
  }

  function gpsSummary(line) {
    if (!line.gps_states) return '';
    return Object.keys(line.gps_states).sort(function (a, b) { return line.gps_states[b] - line.gps_states[a]; }).map(function (k) {
      var pct = line.gps_states[k] / line.points * 100;
      return (GPS_LABELS[k] || 'State ' + k) + ' ' + (pct >= 99.95 ? '100' : pct.toFixed(1)) + '%';
    }).join(', ');
  }
  function renderDetail() {
    var box = el('detail'), line = state.byId[state.selected];
    if (!line) { box.hidden = true; box.innerHTML = ''; return; }
    var ins = line.instrument || {}, f = line.files;
    var meta = '';
    function row(k, v) { if (v !== '' && v != null) meta += '<dt>' + k + '</dt><dd>' + escapeHtml(v) + '</dd>'; }
    var md = line.metadata || {};
    row('Location', md.location);
    row('Platform', md.platform);
    row('Platform type', md.platform_type);
    row('Sensor', md.sensor);
    Object.keys(md).forEach(function (k) {   // any other entries from metadata.json, e.g. operator or project
      if (k === 'platform' || k === 'platform_type' || k === 'sensor' || k === 'location') return;
      var v = md[k];
      if (v !== null && typeof v === 'object') v = JSON.stringify(v);
      row(k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' '), v);
    });
    row('File', f.raw_name);
    row('Area', line.area);
    row('GPS quality', gpsSummary(line));
    row('Antenna type', ins.antenna_type);
    row('Draft', ins.draft_m ? ins.draft_m + ' m' : '');
    row('Sound velocity', ins.sound_velocity_m_s ? ins.sound_velocity_m_s + ' m/s' : '');
    if (line.map_points < line.points) row('Map', 'showing ' + fmtNum(line.map_points) + ' of ' + fmtNum(line.points) + ' soundings; downloads have all of them');
    var downloads = '';
    if (f.raw) downloads += '<a class="button" href="' + escapeHtml(f.raw) + '" download="' + escapeHtml(f.raw_name) + '">Original file (.dep)</a>';
    downloads += '<a class="button ghost" href="' + escapeHtml(f.csv) + '" download="' + escapeHtml(line.name) + '.csv">CSV, decimal degrees</a>';
    box.innerHTML =
      '<div class="detail-head"><div><h2>' + escapeHtml(line.line) + '</h2>' +
      '<p class="note">' + fmtDate(line.date) + ' · ' + fmtTime(line.start) + '–' + fmtTime(line.end) + ' (' + escapeHtml(state.site.time_reference) + ')</p></div>' +
      '<button class="close" type="button" id="detail-close" aria-label="Close line details">×</button></div>' +
      '<dl class="stats"><div><dt>Soundings</dt><dd>' + fmtNum(line.points) + '</dd></div>' +
      '<div><dt>Min</dt><dd>' + fmtDepth(line.depth_min) + ' m</dd></div>' +
      '<div><dt>Mean</dt><dd>' + fmtDepth(line.depth_mean) + ' m</dd></div>' +
      '<div><dt>Max</dt><dd>' + fmtDepth(line.depth_max) + ' m</dd></div></dl>' +
      '<dl class="meta">' + meta + '</dl>' +
      '<div class="downloads">' + downloads + '<button class="button ghost" type="button" id="detail-zoom">Zoom to line</button>' +
      (bedFor(surveyKey(line)) ? '<button class="button ghost" type="button" id="detail-3d">3D view of this survey day</button>' : '') + '</div>';
    box.hidden = false;
  }

  function selectLine(id, zoom, anchorTop) {
    if (!state.byId[id]) return;
    state.selected = id;
    expandLine(state.byId[id]);
    if (state.hidden[id]) { delete state.hidden[id]; if (state.tracks[id] && !map.hasLayer(state.tracks[id])) state.tracks[id].addTo(map); }
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ }
    restyleTracks();
    renderDetail();
    renderList();
    if (zoom) { if (!el('view3d').hidden) show3d(false); map.fitBounds(bboxBounds(state.byId[id].bbox), { padding: [40, 40], maxZoom: 20 }); }
    updateSoundings();
    revealRow(id, anchorTop);
  }
  function clearLineSelection() {
    state.selected = null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    restyleTracks();
    renderDetail();
    renderList();
    updateSoundings();
  }
  function setHidden(id, hidden) {
    if (hidden) state.hidden[id] = true; else delete state.hidden[id];
    var t = state.tracks[id];
    if (t) { if (hidden) map.removeLayer(t); else if (!map.hasLayer(t)) t.addTo(map); }
    if (hidden && state.selected === id) { state.selected = null; renderDetail(); restyleTracks(); }
  }

  function bindPanel() {
    function setMany(box) {
      var ids = (box.getAttribute('data-ids') || '').split(' ').filter(Boolean);
      ids.forEach(function (id) { setHidden(id, !box.checked); });
      renderList(); updateSoundings();
    }
    el('check-all').addEventListener('change', function (e) { setMany(e.target); });
    el('collapse-all').addEventListener('click', function () { collapseAll(); renderList(); });
    el('expand-all').addEventListener('click', function () { state.collapsed = {}; renderList(); });
    el('line-list').addEventListener('click', function (e) {
      if (e.target.matches('.set-check')) { setMany(e.target); return; }
      var open = e.target.closest('.open-3d');
      if (open) {
        open3d(open.getAttribute('data-bed'));
        if (window.matchMedia('(max-width: 760px)').matches) togglePanel(false);
        return;
      }
      // Clicking the name of a location or survey day zooms to its lines and opens the section.
      var zoomTo = e.target.closest('.zoom-to');
      if (zoomTo) {
        var bounds = null;
        zoomTo.getAttribute('data-ids').split(' ').forEach(function (id) {
          var line = state.byId[id];
          if (!line) return;
          if (bounds) bounds.extend(bboxBounds(line.bbox)); else bounds = bboxBounds(line.bbox);
        });
        if (bounds) { show3d(false); fitView(bounds); }
        var zoomKey = zoomTo.getAttribute('data-key');
        if (state.collapsed[zoomKey]) {
          delete state.collapsed[zoomKey];
          renderList();
          var same = el('line-list').querySelector('.zoom-to[data-key="' + (window.CSS && CSS.escape ? CSS.escape(zoomKey) : zoomKey) + '"]');
          if (same && e.detail === 0) same.focus();   // keep keyboard focus; a mouse click needs no focus ring
        }
        if (window.matchMedia('(max-width: 760px)').matches) togglePanel(false);
        return;
      }
      var collapse = e.target.closest('.collapse');
      if (collapse) {
        var key = collapse.getAttribute('data-key');
        if (state.collapsed[key]) delete state.collapsed[key]; else state.collapsed[key] = true;
        renderList();
        var again = el('line-list').querySelector('.collapse[data-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
        if (again && e.detail === 0) again.focus();
        return;
      }
      var row = e.target.closest('.line-row');
      if (!row) return;
      var id = row.getAttribute('data-id');
      if (e.target.matches('input[type="checkbox"]')) {
        setHidden(id, !e.target.checked);
        renderList(); updateSoundings();
        return;
      }
      selectLine(id, true, row.getBoundingClientRect().top);
      if (window.matchMedia('(max-width: 760px)').matches) togglePanel(false);
    });
    el('line-list').addEventListener('keydown', function (e) {
      var row = e.target.closest('.line-row');
      if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        var id = row.getAttribute('data-id');
        selectLine(id, true, row.getBoundingClientRect().top);
        var again = el('line-list').querySelector('.line-row[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
        if (again) again.focus();
      }
    });
    el('detail').addEventListener('click', function (e) {
      if (e.target.id === 'detail-close') clearLineSelection();
      if (e.target.id === 'detail-3d' && state.selected) open3d(surveyKey(state.byId[state.selected]));
      if (e.target.id === 'detail-zoom' && state.selected) map.fitBounds(bboxBounds(state.byId[state.selected].bbox), { padding: [40, 40], maxZoom: 20 });
    });
    el('line-filter').addEventListener('input', function (e) { state.filter = e.target.value.trim().toLowerCase(); renderList(); });
    el('panel-toggle').addEventListener('click', function () { togglePanel(!el('panel').classList.contains('open')); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', restyleTracks);
    new MutationObserver(restyleTracks).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  function togglePanel(open) {
    el('panel').classList.toggle('open', open);
    el('panel-toggle').setAttribute('aria-expanded', String(open));
    el('panel-toggle').textContent = open ? 'Map' : 'Lines';
  }

  /* ---------- 3D view of the interpolated bed ----------
     The build interpolates the bed of each survey day onto a regular grid (data/bed/<survey>.json, metres from the
     centre of the survey). The view draws that grid as a point cloud together with the measured soundings, coloured
     by depth with the vertical scale exaggerated. The 3D library (three.js) is only loaded when a 3D view is opened. */
  var view3d = { ready: null, renderer: null, scene: null, camera: null, controls: null, bed: null, pings: null,
                 water: null, floor: null, data: null, key: null, exag: 20, size: 1, raf: null, pending: null, ray: null };
  function surveyKey(line) { return line.date + '|' + line.area + '|' + lineLocation(line); }
  function bedFor(key) { return state.beds[key] || null; }
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var tag = document.createElement('script');
      tag.src = src; tag.onload = resolve; tag.onerror = function () { reject(new Error(src + ' could not be loaded')); };
      document.head.appendChild(tag);
    });
  }
  function ensureThree() {
    if (!view3d.ready) {
      view3d.ready = (window.THREE ? Promise.resolve() : loadScript('vendor/three/three.min.js'))
        .then(function () { return THREE.OrbitControls ? null : loadScript('vendor/three/OrbitControls.js'); })
        .then(initThree);
      view3d.ready.catch(function () { view3d.ready = null; });   // allow another try after a failed load
    }
    return view3d.ready;
  }
  function initThree() {
    var stage = el('stage3d');
    view3d.renderer = new THREE.WebGLRenderer({ antialias: true });
    view3d.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    stage.appendChild(view3d.renderer.domElement);
    view3d.scene = new THREE.Scene();
    view3d.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 20000);
    view3d.controls = new THREE.OrbitControls(view3d.camera, view3d.renderer.domElement);
    view3d.controls.enableDamping = true;
    view3d.controls.dampingFactor = 0.12;
    view3d.controls.maxPolarAngle = Math.PI * 0.495;
    view3d.water = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
    view3d.water.rotation.x = -Math.PI / 2;
    view3d.water.visible = el('show-water').checked;
    view3d.scene.add(view3d.water);
    view3d.ray = new THREE.Raycaster();
    stage.addEventListener('pointermove', function (e) { view3d.pending = e; });
    stage.addEventListener('pointerleave', function () { view3d.pending = null; el('probe3d').hidden = true; });
    window.addEventListener('resize', resize3d);
  }
  function dotTexture(rim) {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var ctx = c.getContext('2d');
    ctx.beginPath(); ctx.arc(32, 32, 29, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
    if (rim) { ctx.lineWidth = 9; ctx.strokeStyle = '#0f2533'; ctx.stroke(); }
    return new THREE.CanvasTexture(c);
  }
  // "This view" colours the 3D view over this survey day's depths; "All data" uses the scale shared by every survey.
  function bedRange() { return state.scaleMode === 'all' ? state.site.depth_colour_range : view3d.data.range; }
  // x east, y up (depth goes down), z south: three's z axis points towards the viewer.
  function makePoints(set, size, rim) {
    var n = set.x.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (var i = 0; i < n; i++) { pos[3 * i] = set.x[i]; pos[3 * i + 2] = -set.y[i]; }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    var m = new THREE.PointsMaterial({ size: size * view3d.size, vertexColors: true, map: dotTexture(rim), alphaTest: 0.5, sizeAttenuation: true });
    var p = new THREE.Points(g, m);
    p.userData = { set: set, base: size };
    view3d.scene.add(p);
    return p;
  }
  function colour3d() {
    var range = bedRange();
    [view3d.bed, view3d.pings].forEach(function (p) {
      var c = p.geometry.attributes.color, z = p.userData.set.z;
      for (var i = 0; i < z.length; i++) {
        var rgb = rampColour(z[i], range, 'depth').match(/\d+/g);
        c.array[3 * i] = rgb[0] / 255; c.array[3 * i + 1] = rgb[1] / 255; c.array[3 * i + 2] = rgb[2] / 255;
      }
      c.needsUpdate = true;
    });
    var ramp = RAMPS.depth, canvas = el('ramp3d'), ctx = canvas.getContext('2d'), grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    ramp.forEach(function (col, i) { grad.addColorStop(i / (ramp.length - 1), col); });
    ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height);
    el('ticks3d').innerHTML = '<span>≤ ' + range[0].toFixed(2) + '</span><span>' + ((range[0] + range[1]) / 2).toFixed(2) + '</span><span>≥ ' + range[1].toFixed(2) + '</span>';
  }
  function extent3d() {
    var x = view3d.data.grid.x, y = view3d.data.grid.y, e = [Infinity, -Infinity, Infinity, -Infinity];
    for (var i = 0; i < x.length; i++) { if (x[i] < e[0]) e[0] = x[i]; if (x[i] > e[1]) e[1] = x[i]; if (y[i] < e[2]) e[2] = y[i]; if (y[i] > e[3]) e[3] = y[i]; }
    return e;
  }
  function exaggerate3d() {
    var d = view3d.data, maxDepth = 0;
    d.soundings.z.forEach(function (z) { if (z > maxDepth) maxDepth = z; });
    d.grid.z.forEach(function (z) { if (z > maxDepth) maxDepth = z; });
    [view3d.bed, view3d.pings].forEach(function (p) {
      var a = p.geometry.attributes.position, z = p.userData.set.z;
      for (var i = 0; i < z.length; i++) a.array[3 * i + 1] = -z[i] * view3d.exag;
      a.needsUpdate = true;
      p.geometry.computeBoundingSphere();
    });
    var e = d.extent, cx = (e[0] + e[1]) / 2, cz = -(e[2] + e[3]) / 2, span = Math.max(e[1] - e[0], e[3] - e[2]);
    if (view3d.floor) { view3d.scene.remove(view3d.floor); view3d.floor.geometry.dispose(); }
    var step = span > 600 ? 100 : span > 150 ? 20 : 10, size = Math.ceil((span + 2 * step) / step) * step;
    var gridColour = new THREE.Color(cssVar('--stage-grid'));
    view3d.floor = new THREE.GridHelper(size, size / step, gridColour, gridColour);
    view3d.floor.material.transparent = true; view3d.floor.material.opacity = 0.55;
    view3d.floor.position.set(cx, -maxDepth * view3d.exag - 1.5, cz);
    view3d.scene.add(view3d.floor);
    view3d.water.scale.set(e[1] - e[0] + 10, e[3] - e[2] + 10, 1);
    view3d.water.position.set(cx, 0, cz);
    d.centre = { x: cx, z: cz, span: span, maxDepth: maxDepth, step: step };
  }
  function camera3d(kind) {
    var c = view3d.data.centre, aspect = view3d.camera.aspect || 1;
    var dist = c.span * 0.95 / Math.min(1, aspect * 1.1), mid = -c.maxDepth * view3d.exag * 0.5;
    if (kind === 'top') view3d.camera.position.set(c.x, dist * 1.4, c.z + 0.01);
    else if (kind === 'side') view3d.camera.position.set(c.x + dist * 1.25, mid * 0.8, c.z);
    else view3d.camera.position.set(c.x + dist * 0.55, dist * 0.6, c.z + dist * 0.85);
    view3d.controls.target.set(c.x, mid, c.z);
    view3d.controls.update();
  }
  function theme3d() {
    if (!view3d.scene) return;
    view3d.scene.background = new THREE.Color(cssVar('--stage'));
    view3d.water.material.color = new THREE.Color(cssVar('--water'));
    if (view3d.data) exaggerate3d();
  }
  function resize3d() {
    if (!view3d.renderer || el('view3d').hidden) return;
    var stage = el('stage3d'), w = stage.clientWidth, h = stage.clientHeight;
    view3d.renderer.setSize(w, h);
    view3d.camera.aspect = w / Math.max(h, 1);
    view3d.camera.updateProjectionMatrix();
  }
  function probe3d() {
    var e = view3d.pending; view3d.pending = null;
    if (!e || !view3d.data) return;
    var stage = el('stage3d'), r = stage.getBoundingClientRect(), box = el('probe3d');
    var mouse = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    view3d.ray.params.Points.threshold = Math.max(0.3, view3d.data.spacing);
    view3d.ray.setFromCamera(mouse, view3d.camera);
    var targets = [view3d.pings, view3d.bed].filter(function (p) { return p.visible; });
    var hits = view3d.ray.intersectObjects(targets, false), hit = null;
    for (var k = 0; k < hits.length; k++) {
      if (hits[k].distance > hits[0].distance + 4) break;
      if (!hit || hits[k].distanceToRay < hit.distanceToRay - 0.05) hit = hits[k];
    }
    if (!hit) { box.hidden = true; return; }
    var set = hit.object.userData.set, i = hit.index, measured = hit.object === view3d.pings;
    box.innerHTML = '<span class="kind' + (measured ? ' measured' : '') + '">' +
      (measured ? 'Measured sounding · ' + escapeHtml(view3d.data.lines[set.line[i]] || '') : 'Interpolated estimate') + '</span>' +
      '<strong>' + set.z[i].toFixed(measured ? 3 : 2) + ' m</strong>';
    box.hidden = false;
    var x = e.clientX - r.left + 14, y = e.clientY - r.top + 14;
    if (x + box.offsetWidth > r.width - 8) x -= box.offsetWidth + 28;
    if (y + box.offsetHeight > r.height - 8) y -= box.offsetHeight + 28;
    box.style.left = x + 'px'; box.style.top = y + 'px';
  }
  function loop3d() {
    view3d.raf = requestAnimationFrame(loop3d);
    probe3d();
    view3d.controls.update();
    view3d.renderer.render(view3d.scene, view3d.camera);
  }
  function show3d(on) {
    el('view3d').hidden = !on;
    el('tab-3d').setAttribute('aria-selected', String(on));
    el('tab-map').setAttribute('aria-selected', String(!on));
    if (on && view3d.renderer) { resize3d(); if (!view3d.raf && view3d.data) loop3d(); }
    if (!on && view3d.raf) { cancelAnimationFrame(view3d.raf); view3d.raf = null; }
    if (!on) map.invalidateSize();
    [].forEach.call(document.querySelectorAll('.open-3d'), function (b) { b.setAttribute('aria-pressed', String(on && b.getAttribute('data-bed') === view3d.key)); });
  }
  function message3d(text) { el('message3d').textContent = text || ''; el('message3d').hidden = !text; }
  function open3d(key) {
    var record = bedFor(key);
    if (!record) return;
    el('view-tabs').hidden = false;
    var same = view3d.key === key && view3d.data;
    view3d.key = key;
    show3d(true);
    if (same) return;
    var parts = key.split('|');
    el('bed-title').textContent = (parts[2] ? parts[2] + ' · ' : '') + fmtDate(parts[0]);
    el('bed-csv').href = record.files.csv;
    el('bed-csv').setAttribute('download', record.id + '_interpolated-bed.csv');
    el('n-bed').textContent = fmtNum(record.points);
    el('caveat3d').textContent = 'The bed between soundings is interpolated linearly on a ' + record.spacing + ' m grid, only within ' +
      state.site.bed_max_distance + ' m of a measured sounding. Those values are estimates; only the measured soundings are data.';
    if (window.matchMedia('(max-width: 760px)').matches) el('controls3d').open = false;
    message3d('Loading the 3D view…');
    Promise.all([ensureThree(), fetch(record.files.points).then(function (r) {
      if (!r.ok) throw new Error(record.files.points + ' returned ' + r.status);
      return r.json();
    })]).then(function (res) {
      if (view3d.key !== key) return;
      var d = res[1];
      [view3d.bed, view3d.pings].forEach(function (p) {
        if (!p) return;
        view3d.scene.remove(p); p.geometry.dispose(); p.material.map.dispose(); p.material.dispose();
      });
      view3d.data = d;
      d.extent = extent3d();
      view3d.bed = makePoints(d.grid, d.spacing * 1.7, false);
      view3d.pings = makePoints(d.soundings, Math.max(0.6, d.spacing * 2.2), true);
      view3d.bed.visible = el('show-bed').checked;
      view3d.pings.visible = el('show-pings').checked;
      el('n-pings').textContent = fmtNum(d.soundings.x.length);
      colour3d();
      theme3d();
      resize3d();
      camera3d('oblique');
      if (!view3d.raf && !el('view3d').hidden) loop3d();
      message3d('');
    }).catch(function (err) {
      console.error(err);
      message3d(window.WebGLRenderingContext ? 'The 3D view could not be opened: ' + err.message : 'The 3D view needs WebGL, which this browser has turned off.');
    });
  }
  function bind3d() {
    el('tab-map').addEventListener('click', function () { show3d(false); });
    el('tab-3d').addEventListener('click', function () { if (view3d.key) open3d(view3d.key); });
    el('show-bed').addEventListener('change', function (e) { if (view3d.bed) view3d.bed.visible = e.target.checked; });
    el('show-pings').addEventListener('change', function (e) { if (view3d.pings) view3d.pings.visible = e.target.checked; });
    el('show-water').addEventListener('change', function (e) { if (view3d.water) view3d.water.visible = e.target.checked; });
    el('exag3d').addEventListener('input', function (e) {
      view3d.exag = +e.target.value; el('exag3d-out').textContent = view3d.exag + '×';
      if (view3d.data) { exaggerate3d(); view3d.controls.target.y = -view3d.data.centre.maxDepth * view3d.exag * 0.5; }
    });
    el('size3d').addEventListener('input', function (e) {
      view3d.size = +e.target.value; el('size3d-out').textContent = view3d.size.toFixed(1);
      [view3d.bed, view3d.pings].forEach(function (p) { if (p) p.material.size = p.userData.base * view3d.size; });
    });
    [].forEach.call(document.querySelectorAll('.views3d button'), function (b) {
      b.addEventListener('click', function () { if (view3d.data) camera3d(b.getAttribute('data-view')); });
    });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', theme3d);
    new MutationObserver(theme3d).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  var CUBE = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5 14 4.8v6.4L8 14.5 2 11.2V4.8z M2 4.8 8 8l6-3.2 M8 8v6.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  /* ---------- site text ---------- */
  function renderSiteText() {
    var s = state.site, lines = state.lines;
    document.title = s.title;
    el('site-title').textContent = s.title;
    var total = lines.reduce(function (n, l) { return n + l.points; }, 0);
    var dates = lines.map(function (l) { return l.date; }).sort();
    var span = dates.length ? (dates[0] === dates[dates.length - 1] ? fmtDate(dates[0]) : fmtDate(dates[0]) + ' – ' + fmtDate(dates[dates.length - 1])) : '';
    var days = {};
    lines.forEach(function (l) { days[l.date] = true; });
    el('site-summary').innerHTML = lines.length
      ? '<span class="data">' + fmtNum(lines.length) + '</span> lines · <span class="data">' + fmtNum(total) + '</span> soundings · ' +
        Object.keys(days).length + (Object.keys(days).length === 1 ? ' survey day · ' : ' survey days · ') + escapeHtml(span)
      : 'No survey lines yet';
    el('site-description').textContent = s.description || '';
    el('site-description').hidden = !s.description;
    el('depth-reference').textContent = s.depth_reference;
    el('time-reference').textContent = s.time_reference;
    if (s.height_reference) el('height-reference').textContent = s.height_reference;
    if (s.licence) { el('licence').textContent = s.licence; el('licence').hidden = false; el('licence-label').hidden = false; }
    if (s.contact || s.organisation) {
      el('contact').textContent = [s.organisation, s.contact].filter(Boolean).join(' · ');
      el('contact').hidden = false; el('contact-label').hidden = false;
    }
    el('generated').textContent = 'Map rebuilt ' + fmtDate(s.generated) + ' at ' + s.generated.slice(11, 16) + ' UTC.';
    if (s.combined_csv) { el('download-all').href = s.combined_csv; el('download-all').hidden = false; }
    if (s.repository_url) { el('repo-link').href = s.repository_url; el('repo-link').hidden = false; }
  }

  function showError(message) {
    el('site-summary').textContent = 'The survey data could not be loaded';
    el('line-list').innerHTML = '<p class="note">' + escapeHtml(message) + '</p>';
  }

  /* ---------- start ---------- */
  fetch('data/index.json', { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error('data/index.json returned ' + r.status + '. Run the BathyMap build first.');
    return r.json();
  }).then(function (index) {
    state.site = index.site;
    state.lines = index.lines || [];
    state.lines.forEach(function (l) { state.byId[l.id] = l; });
    (index.beds || []).forEach(function (b) { state.beds[b.key] = b; });
    initMap();
    addZoomAllControl();
    addSelectionControl();
    renderSiteText();
    setupVariableMenu();
    drawLegend();
    drawTracks();
    bindPanel();
    bind3d();
    setupLocationFilter();
    if (state.site.start_with_list_collapsed !== false) collapseAll();
    renderList();
    var fromHash = decodeURIComponent(location.hash.slice(1));
    if (state.byId[fromHash]) {
      selectLine(fromHash, true);
    } else if (state.site.bbox) {
      fitView(bboxBounds(state.site.bbox));
    } else {
      map.setView([20, 0], 2);   // whole world, until the first line is added
    }
    updateSoundings();
  }).catch(function (err) {
    console.error(err);
    showError(location.protocol === 'file:'
      ? 'Browsers block data loading from files opened directly. Serve the built folder instead, for example: python -m http.server -d _site'
      : err.message);
  });
})();
