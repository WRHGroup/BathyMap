/* BathyMap. Reads data/index.json (written by the BathyMap build), draws every survey line as a track,
   and loads the soundings of a line when it is selected or when the map is zoomed in far enough to see it. */
(function () {
  'use strict';

  var POINT_ZOOM = 15;            // soundings of lines in view are loaded from this zoom level
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
  function hexToRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  var RAMP_RGB = RAMP.map(hexToRgb);
  function depthColour(d) {
    var r = state.site.depth_colour_range;
    var t = (d - r[0]) / ((r[1] - r[0]) || 1);
    t = Math.max(0, Math.min(1, t));
    var x = t * (RAMP_RGB.length - 1);
    var i = Math.min(Math.floor(x), RAMP_RGB.length - 2);
    var f = x - i;
    var a = RAMP_RGB[i], b = RAMP_RGB[i + 1];
    return 'rgb(' + Math.round(a[0] + (b[0] - a[0]) * f) + ',' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' + Math.round(a[2] + (b[2] - a[2]) * f) + ')';
  }
  function drawLegend() {
    var c = el('legend-ramp'), ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, c.width, 0);
    RAMP.forEach(function (col, i) { g.addColorStop(i / (RAMP.length - 1), col); });
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
    var r = state.site.depth_colour_range;
    var ticks = [r[0], (r[0] + r[1]) / 2, r[1]];
    el('legend-ticks').innerHTML = ticks.map(function (t, i) {
      var label = fmtDepth(t);
      if (i === 0) label = '≤ ' + label;
      if (i === 2) label = '≥ ' + label;
      return '<span>' + label + '</span>';
    }).join('');
  }

  /* ---------- map ---------- */
  function initMap() {
    map = L.map('map', { zoomControl: true, preferCanvas: true, maxZoom: 22 });
    renderer = L.canvas({ padding: 0.3 });

    var streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxNativeZoom: 19, maxZoom: 22,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });
    var imagery = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 19, maxZoom: 22,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community'
    });
    var bases = { 'Street map': streets, 'Satellite': imagery };
    var chosen = 'Street map';
    try { if (bases[localStorage.getItem('bathymap-base')]) chosen = localStorage.getItem('bathymap-base'); } catch (e) { /* storage unavailable */ }
    bases[chosen].addTo(map);
    L.control.layers(bases, null, { position: 'topright' }).addTo(map);
    map.on('baselayerchange', function (e) { try { localStorage.setItem('bathymap-base', e.name); } catch (err) { /* ignore */ } });
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
    var sel = id === state.selected;
    return { color: sel ? cssVar('--accent') : cssVar('--track'), weight: sel ? 4 : 2.5, opacity: sel ? 0.95 : 0.75 };
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

  function loadPoints(line) {
    if (state.points[line.id] || state.loading[line.id]) return Promise.resolve();
    state.loading[line.id] = true;
    return fetch(line.files.points).then(function (r) {
      if (!r.ok) throw new Error(r.status + ' ' + r.statusText);
      return r.json();
    }).then(function (p) {
      state.points[line.id] = p;
    }).catch(function (err) {
      console.error('Could not load soundings for ' + line.id, err);
    }).then(function () { state.loading[line.id] = false; });
  }

  function pointRadius() {
    var z = map.getZoom();
    return z >= 20 ? 5 : z >= 18 ? 4 : z >= 16 ? 3 : 2;
  }
  function buildPointLayer(id) {
    var p = state.points[id], r = pointRadius(), group = L.layerGroup();
    for (var i = 0; i < p.lat.length; i++) {
      L.circleMarker([p.lat[i], p.lon[i]], {
        renderer: renderer, radius: r, stroke: true, weight: 0.6, color: 'rgba(15,37,51,0.45)',
        fillColor: depthColour(p.depth[i]), fillOpacity: 0.95, interactive: false
      }).addTo(group);
    }
    group.radius = r;
    return group;
  }

  function wantsPoints(line) {
    if (state.hidden[line.id]) return false;
    if (line.id === state.selected) return true;
    return map.getZoom() >= POINT_ZOOM && lineInView(line);
  }

  function updateSoundings() {
    var pending = [];
    state.lines.forEach(function (line) {
      var want = wantsPoints(line), layer = state.pointLayers[line.id];
      if (!want) {
        if (layer) { map.removeLayer(layer); delete state.pointLayers[line.id]; }
        return;
      }
      if (!state.points[line.id]) { pending.push(loadPoints(line)); return; }
      if (layer && layer.radius !== pointRadius()) { map.removeLayer(layer); layer = null; }
      if (!layer) { state.pointLayers[line.id] = buildPointLayer(line.id).addTo(map); }
    });
    var showing = Object.keys(state.pointLayers).length > 0;
    el('legend-hint').textContent = showing ? 'Hover or tap a sounding for its depth, date and time' : 'Zoom in or select a line to see soundings';
    if (pending.length) Promise.all(pending).then(updateSoundings);
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
    var when = soundingDateTime(p, hit.i), ref = state.site.time_reference;
    box.innerHTML = '<strong>' + p.depth[hit.i].toFixed(3) + ' m</strong>' +
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
    var groups = {}, order = [];
    state.lines.forEach(function (line) {
      var key = line.date + '|' + line.area;
      if (!groups[key]) { groups[key] = { date: line.date, area: line.area, lines: [] }; order.push(key); }
      groups[key].lines.push(line);
    });
    order.sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
    return order.map(function (k) {
      groups[k].lines.sort(function (a, b) { return a.start < b.start ? -1 : 1; });
      return groups[k];
    });
  }
  function matchesFilter(line) {
    if (!state.filter) return true;
    var md = line.metadata || {};
    var hay = (line.name + ' ' + line.line + ' ' + line.area + ' ' + line.date + ' ' + fmtDate(line.date) + ' ' + line.folder + ' ' +
      (md.platform || '') + ' ' + (md.platform_type || '') + ' ' + (md.sensor || '')).toLowerCase();
    return hay.indexOf(state.filter) !== -1;
  }
  function depthBar(line) {
    var r = state.site.depth_colour_range, span = Math.max(r[1], line.depth_max) || 1;
    var left = Math.max(0, line.depth_min / span * 100), width = Math.max(4, (line.depth_max - line.depth_min) / span * 100);
    return '<span style="left:' + left.toFixed(1) + '%;width:' + Math.min(100 - left, width).toFixed(1) + '%;background:linear-gradient(90deg,' +
      depthColour(line.depth_min) + ',' + depthColour(line.depth_max) + ')"></span>';
  }
  function renderList() {
    var list = el('line-list');
    if (!state.lines.length) {
      list.innerHTML = '<p class="note">No survey lines yet. Add .dep files to the data folder of the repository and push; the map rebuilds automatically.</p>';
      return;
    }
    var html = '';
    groupLines().forEach(function (g, gx) {
      var lines = g.lines.filter(matchesFilter);
      if (!lines.length) return;
      var pts = lines.reduce(function (s, l) { return s + l.points; }, 0);
      var allHidden = lines.every(function (l) { return state.hidden[l.id]; });
      html += '<div class="group" data-group="' + gx + '"><div class="group-head"><div><h3>' + escapeHtml(fmtDate(g.date)) + '</h3>' +
        '<p class="note">' + escapeHtml(g.area) + ' · ' + lines.length + (lines.length === 1 ? ' line · ' : ' lines · ') + fmtNum(pts) + ' soundings</p></div>' +
        '<button class="group-toggle" type="button" data-ids="' + lines.map(function (l) { return l.id; }).join(' ') + '">' + (allHidden ? 'Show all' : 'Hide all') + '</button></div>';
      lines.forEach(function (line) {
        var hidden = !!state.hidden[line.id];
        html += '<div class="line-row' + (line.id === state.selected ? ' selected' : '') + (hidden ? ' hidden-line' : '') + '" data-id="' + escapeHtml(line.id) + '" role="button" tabindex="0" aria-pressed="' + (line.id === state.selected) + '">' +
          '<input type="checkbox" id="show-' + escapeHtml(line.id) + '" aria-label="Show ' + escapeHtml(line.line) + ' on the map"' + (hidden ? '' : ' checked') + '>' +
          '<div class="line-main"><div class="line-name">' + escapeHtml(line.line) + '</div>' +
          '<div class="line-sub">' + fmtTime(line.start) + '–' + fmtTime(line.end) + ' · ' + fmtNum(line.points) + ' soundings</div></div>' +
          '<div class="line-depth"><span class="data">' + fmtDepth(line.depth_min) + '–' + fmtDepth(line.depth_max) + ' m</span><div class="depth-bar">' + depthBar(line) + '</div></div>' +
          '</div>';
      });
      html += '</div>';
    });
    list.innerHTML = html || '<p class="note">No lines match this filter.</p>';
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
    row('Platform', md.platform);
    row('Platform type', md.platform_type);
    row('Sensor', md.sensor);
    Object.keys(md).forEach(function (k) {   // any other entries from metadata.json, e.g. operator or project
      if (k === 'platform' || k === 'platform_type' || k === 'sensor') return;
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
      '<div class="downloads">' + downloads + '<button class="button ghost" type="button" id="detail-zoom">Zoom to line</button></div>';
    box.hidden = false;
  }

  function selectLine(id, zoom) {
    if (!state.byId[id]) return;
    state.selected = id;
    if (state.hidden[id]) { delete state.hidden[id]; if (state.tracks[id] && !map.hasLayer(state.tracks[id])) state.tracks[id].addTo(map); }
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ }
    restyleTracks();
    renderDetail();
    renderList();
    if (zoom) map.fitBounds(bboxBounds(state.byId[id].bbox), { padding: [40, 40], maxZoom: 20 });
    updateSoundings();
    el('panel').scrollTop = 0;
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
    el('line-list').addEventListener('click', function (e) {
      var toggle = e.target.closest('.group-toggle');
      if (toggle) {
        var ids = toggle.getAttribute('data-ids').split(' ');
        var hide = toggle.textContent === 'Hide all';
        ids.forEach(function (id) { setHidden(id, hide); });
        renderList(); updateSoundings();
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
      selectLine(id, true);
      if (window.matchMedia('(max-width: 760px)').matches) togglePanel(false);
    });
    el('line-list').addEventListener('keydown', function (e) {
      var row = e.target.closest('.line-row');
      if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectLine(row.getAttribute('data-id'), true); }
    });
    el('detail').addEventListener('click', function (e) {
      if (e.target.id === 'detail-close') clearLineSelection();
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
    initMap();
    addSelectionControl();
    renderSiteText();
    drawLegend();
    drawTracks();
    bindPanel();
    renderList();
    var fromHash = decodeURIComponent(location.hash.slice(1));
    if (state.byId[fromHash]) {
      selectLine(fromHash, true);
    } else if (state.site.bbox) {
      map.fitBounds(bboxBounds(state.site.bbox), { padding: [30, 30], maxZoom: 19 });
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
