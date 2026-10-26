import { STR } from './i18n.js';
import * as A from './analysis.js';
import { drawFlag, drawCard } from './card.js';

const PAL = ['#e8590c', '#1c7ed6', '#9c36b5', '#0ca678', '#d9a400', '#d6336c'];
const MODEL = 'claude-sonnet-5-5';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const FONT = ['Noto Sans Regular'], FONT_B = ['Noto Sans Bold'];

/* ---------- utilidades ---------- */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
let lang = store.get('rp.lang', (navigator.language || 'es').startsWith('en') ? 'en' : 'es');
const t = (k, ...a) => { const v = STR[lang][k]; return typeof v === 'function' ? v(...a) : (v ?? k); };
const DN = {};
const cname = (cc) => { if (!cc) return ''; try { DN[lang] ||= new Intl.DisplayNames([lang], { type: 'region' }); return DN[lang].of(cc); } catch { return cc; } };
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const fLat = (v) => Math.abs(v).toFixed(2) + '°' + (v >= 0 ? 'N' : 'S');
const fLon = (v) => Math.abs(v).toFixed(2) + '°' + (v >= 0 ? 'E' : (lang === 'es' ? 'O' : 'W'));
const fmt = {
  int: (n) => new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }).format(n),
  compact: (n) => new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n),
  usd: (n) => new Intl.NumberFormat(lang, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(n),
};
const rangeTxt = (r) => {
  const a = r.c - r.w, b = r.c + r.w, f = (v) => (Math.round(v * 100) / 100).toFixed(2);
  return a >= 0 ? f(a) + '–' + f(b) + '°N' : b <= 0 ? f(-b) + '–' + f(-a) + '°S' : f(-a) + '°S–' + f(b) + '°N';
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let toastTimer = 0;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3500); }

/* ---------- estado ---------- */
let ROWSDATA = null, COUNTRIES_GJ = null, ARTISTS = [], META = {};
let CITIES = [], BYID = new Map(), TWINPOOL = [];
let places = store.get('rp.places', []).filter((p) => p && isFinite(p.lat) && isFinite(p.lon));
let reps = store.get('rp.reps', null);
if (!Array.isArray(reps) || !reps.length) reps = [{ id: 'r1', name: 'República del Paralelo 42', c: 42.5, w: 0.5, color: PAL[0] }];
let selRep = store.get('rp.sel', reps[0].id);
if (!reps.find((r) => r.id === selRep)) selRep = reps[0].id;
let selCity = null;
let gens = store.get('rp.gen', {});
let view = store.get('rp.view', 'flat');
let map = null, mapReady = false;

const all = () => CITIES;
const findPt = (id) => (id ? BYID.get(id) : null);
const curRep = () => reps.find((r) => r.id === selRep) || null;
const capitalOf = (r) => { const p = findPt(r.capital); return p && A.inBand(r, p.lat) ? p : null; };
const saveReps = () => { store.set('rp.reps', reps.map(({ _k, _a, ...r }) => r)); store.set('rp.sel', selRep); };
const analysis = (r) => {
  const k = [r.c, r.w, lang, places.length].join('|');
  if (r._k !== k) { r._a = A.analyzeBand(ROWSDATA, all(), r, lang, cname); r._k = k; }
  return r._a;
};
function newRep(c, w, name) {
  const used = new Set(reps.map((r) => r.color));
  const color = PAL.find((x) => !used.has(x)) || PAL[reps.length % PAL.length];
  const r = { id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name, c, w, color };
  reps.push(r); selRep = r.id; return r;
}

/* ---------- carga ---------- */
async function loadData() {
  const get = (f) => fetch('data/' + f).then((r) => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); });
  const [rows, cities, countries, artists, meta] = await Promise.all([
    get('rows.json'), get('cities.json'), get('countries.geojson'),
    get('artists.json').catch(() => []), get('meta.json').catch(() => ({})),
  ]);
  ROWSDATA = A.prepareRows(rows); COUNTRIES_GJ = countries; ARTISTS = artists; META = meta;
  CITIES = cities.map(([gid, name, cc, lat, lon, pop]) => ({ id: 'g' + gid, name, cc, lat, lon, pop, n: norm(name) }));
  rebuildIndex();
}
function rebuildIndex() {
  CITIES = CITIES.filter((p) => !p.mine).concat(places.map((p) => ({ ...p, mine: true, pop: p.pop || 0, n: norm(p.name) })));
  BYID = new Map(CITIES.map((p) => [p.id, p]));
  TWINPOOL = CITIES.filter((p) => p.pop >= 100000 || p.mine);
  reps.forEach((r) => { r._k = null; });
}

/* ---------- mapa ---------- */
function theme() {
  const cs = getComputedStyle(document.documentElement);
  const g = (k) => cs.getPropertyValue('--' + k).trim();
  return { sea: g('sea'), land: g('land'), border: g('border'), ink: g('ink'), muted: g('muted'), panel: g('panel'), grat: g('grat'), special: g('special'), accent: g('accent'), space: g('space') };
}
const line = (lat) => { const c = []; for (let l = -180; l <= 180; l += 2) c.push([l, lat]); return c; };
const fc = (features) => ({ type: 'FeatureCollection', features });
function graticule() {
  const f = [];
  for (let lon = -180; lon <= 180; lon += 30) { const c = []; for (let lat = -85; lat <= 85; lat += 5) c.push([lon, lat]); f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } }); }
  for (let lat = -80; lat <= 80; lat += 10) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line(lat) } });
  return fc(f);
}
const SPECIAL = [[0, 'eq'], [23.44, 'tc'], [-23.44, 'tk'], [66.56, 'ac'], [-66.56, 'an']];
const specialGJ = () => fc(SPECIAL.map(([lat, k]) => ({ type: 'Feature', properties: { n: t('special')[k] }, geometry: { type: 'LineString', coordinates: line(lat) } })));
function bandsGJ() {
  const cr = curRep();
  return fc(reps.map((r) => {
    const lo = r.c - r.w, hi = r.c + r.w;
    const ring = line(lo).concat(line(hi).reverse()); ring.push(ring[0]);
    return { type: 'Feature', properties: { col: r.color, sel: r === cr ? 1 : 0 }, geometry: { type: 'Polygon', coordinates: [ring] } };
  }));
}
function bandLinesGJ() {
  const cr = curRep();
  return fc(reps.flatMap((r) => [
    { type: 'Feature', properties: { col: r.color, sel: r === cr ? 1 : 0, kind: 'c', n: r.name + ' · ' + rangeTxt(r) }, geometry: { type: 'LineString', coordinates: line(r.c) } },
    { type: 'Feature', properties: { col: r.color, sel: r === cr ? 1 : 0, kind: 'e' }, geometry: { type: 'MultiLineString', coordinates: [line(r.c - r.w), line(r.c + r.w)] } },
  ]));
}
const citiesGJ = () => fc(CITIES.filter((p) => !p.mine).map((p) => ({ type: 'Feature', properties: { id: p.id, p: p.pop }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })));
function citizensGJ() {
  const cr = curRep(); const caps = new Set(reps.map((r) => r.capital).filter(Boolean));
  const out = [];
  for (const p of CITIES) {
    let r = cr && A.inBand(cr, p.lat) ? cr : null;
    if (!r) for (const x of reps) if (A.inBand(x, p.lat)) { r = x; break; }
    if (!r && !p.mine) continue;
    out.push({ type: 'Feature', properties: { id: p.id, n: p.name, p: p.pop, col: r ? r.color : '#15242d', sel: r === cr && r ? 1 : 0, cap: caps.has(p.id) && r && r.capital === p.id ? 1 : 0, mine: p.mine ? 1 : 0 }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } });
  }
  return fc(out);
}
function selGJ() {
  if (!selCity) return fc([]);
  const f = [{ type: 'Feature', properties: { kind: 'line' }, geometry: { type: 'LineString', coordinates: line(selCity.lat) } },
    { type: 'Feature', properties: { kind: 'sel', n: selCity.name }, geometry: { type: 'Point', coordinates: [selCity.lon, selCity.lat] } }];
  A.twins(selCity, TWINPOOL, 5).forEach((x) => f.push({ type: 'Feature', properties: { kind: 'twin', n: x.p.name }, geometry: { type: 'Point', coordinates: [x.p.lon, x.p.lat] } }));
  return fc(f);
}

function initMap() {
  const T = theme();
  map = new maplibregl.Map({
    container: 'map',
    attributionControl: { compact: true, customAttribution: 'Natural Earth · GeoNames · Wikidata · OpenFreeMap fonts' },
    renderWorldCopies: false, center: [0, 28], zoom: 1.1, minZoom: 0.4, maxZoom: 9, dragRotate: false, pitchWithRotate: false,
    style: {
      version: 8, glyphs: GLYPHS,
      sources: {
        countries: { type: 'geojson', data: COUNTRIES_GJ },
        grat: { type: 'geojson', data: graticule() },
        special: { type: 'geojson', data: specialGJ() },
        bands: { type: 'geojson', data: bandsGJ() },
        bandlines: { type: 'geojson', data: bandLinesGJ() },
        cities: { type: 'geojson', data: citiesGJ() },
        citizens: { type: 'geojson', data: citizensGJ() },
        sel: { type: 'geojson', data: selGJ() },
        hover: { type: 'geojson', data: fc([]) },
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': T.sea } },
        { id: 'countries-fill', type: 'fill', source: 'countries', paint: { 'fill-color': T.land } },
        { id: 'countries-line', type: 'line', source: 'countries', paint: { 'line-color': T.border, 'line-width': 0.7 } },
        { id: 'grat', type: 'line', source: 'grat', paint: { 'line-color': T.grat, 'line-width': 1 } },
        { id: 'special', type: 'line', source: 'special', paint: { 'line-color': T.special, 'line-width': 1, 'line-dasharray': [4, 4] } },
        { id: 'special-label', type: 'symbol', source: 'special', layout: { 'symbol-placement': 'line', 'text-field': ['get', 'n'], 'text-font': FONT, 'text-size': 10, 'symbol-spacing': 600 }, paint: { 'text-color': T.muted } },
        { id: 'bands-fill', type: 'fill', source: 'bands', paint: { 'fill-color': ['get', 'col'], 'fill-opacity': ['case', ['==', ['get', 'sel'], 1], 0.24, 0.13] } },
        { id: 'band-edges', type: 'line', source: 'bandlines', filter: ['==', ['get', 'kind'], 'e'], paint: { 'line-color': ['get', 'col'], 'line-width': 1, 'line-opacity': ['case', ['==', ['get', 'sel'], 1], 0.85, 0.45] } },
        { id: 'band-center', type: 'line', source: 'bandlines', filter: ['==', ['get', 'kind'], 'c'], paint: { 'line-color': ['get', 'col'], 'line-width': ['case', ['==', ['get', 'sel'], 1], 2.2, 1.3] } },
        { id: 'band-label', type: 'symbol', source: 'bandlines', filter: ['==', ['get', 'kind'], 'c'], layout: { 'symbol-placement': 'line', 'text-field': ['get', 'n'], 'text-font': FONT_B, 'text-size': 11, 'symbol-spacing': 900, 'text-offset': [0, -0.9] }, paint: { 'text-color': ['get', 'col'], 'text-halo-color': T.sea, 'text-halo-width': 1.5 } },
        { id: 'sel-line', type: 'line', source: 'sel', filter: ['==', ['get', 'kind'], 'line'], paint: { 'line-color': T.ink, 'line-opacity': 0.55, 'line-width': 1, 'line-dasharray': [1, 3] } },
        { id: 'hover-line', type: 'line', source: 'hover', paint: { 'line-color': T.accent, 'line-width': 1.2, 'line-dasharray': [4, 3] } },
        { id: 'cities-big', type: 'circle', source: 'cities', filter: ['>=', ['get', 'p'], 1000000], paint: { 'circle-color': T.ink, 'circle-opacity': 0.42, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 1, 1.6, 5, 3] } },
        { id: 'cities-all', type: 'circle', source: 'cities', minzoom: 3.5, filter: ['<', ['get', 'p'], 1000000], paint: { 'circle-color': T.ink, 'circle-opacity': 0.35, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3.5, 1.2, 8, 3] } },
        { id: 'citizens-dot', type: 'circle', source: 'citizens', filter: ['==', ['get', 'mine'], 0], paint: { 'circle-color': ['get', 'col'], 'circle-stroke-color': T.panel, 'circle-stroke-width': 1, 'circle-radius': ['interpolate', ['linear'], ['get', 'p'], 15000, 2.2, 1000000, 4, 10000000, 6.5] } },
        { id: 'mine-dot', type: 'circle', source: 'citizens', filter: ['==', ['get', 'mine'], 1], paint: { 'circle-color': ['get', 'col'], 'circle-stroke-color': T.ink, 'circle-stroke-width': 2, 'circle-radius': 5 } },
        { id: 'cap-dot', type: 'circle', source: 'citizens', filter: ['==', ['get', 'cap'], 1], paint: { 'circle-color': ['get', 'col'], 'circle-stroke-color': T.panel, 'circle-stroke-width': 3, 'circle-radius': 8 } },
        { id: 'sel-ring', type: 'circle', source: 'sel', filter: ['!=', ['get', 'kind'], 'line'], paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': T.ink, 'circle-stroke-width': ['case', ['==', ['get', 'kind'], 'sel'], 2, 1.2], 'circle-radius': ['case', ['==', ['get', 'kind'], 'sel'], 10, 7] } },
        { id: 'citizens-label', type: 'symbol', source: 'citizens', filter: ['any', ['==', ['get', 'sel'], 1], ['==', ['get', 'cap'], 1], ['==', ['get', 'mine'], 1]],
          layout: { 'text-field': ['case', ['==', ['get', 'cap'], 1], ['concat', '★ ', ['get', 'n']], ['get', 'n']], 'text-font': ['case', ['==', ['get', 'cap'], 1], ['literal', FONT_B], ['literal', FONT]], 'text-size': ['interpolate', ['linear'], ['get', 'p'], 15000, 10.5, 5000000, 13], 'text-anchor': 'left', 'text-offset': [0.7, 0], 'symbol-sort-key': ['-', 0, ['+', ['get', 'p'], ['*', ['get', 'cap'], 1e9], ['*', ['get', 'mine'], 1e8]]] },
          paint: { 'text-color': T.ink, 'text-halo-color': T.sea, 'text-halo-width': 1.6 } },
        { id: 'sel-label', type: 'symbol', source: 'sel', filter: ['!=', ['get', 'kind'], 'line'],
          layout: { 'text-field': ['get', 'n'], 'text-font': ['case', ['==', ['get', 'kind'], 'sel'], ['literal', FONT_B], ['literal', FONT]], 'text-size': ['case', ['==', ['get', 'kind'], 'sel'], 13, 11], 'text-anchor': 'left', 'text-offset': [0.9, 0], 'text-allow-overlap': true },
          paint: { 'text-color': T.ink, 'text-halo-color': T.sea, 'text-halo-width': 1.8 } },
      ],
    },
  });
  map.on('load', () => {
    mapReady = true;
    setView(view, true);
    $('#status').hidden = true;
  });
  map.on('error', (e) => console.warn('map', e && e.error));
  let hoverRaf = 0, last = null;
  map.on('mousemove', (e) => {
    last = e;
    if (hoverRaf) return;
    hoverRaf = requestAnimationFrame(() => {
      hoverRaf = 0;
      const lat = last.lngLat.lat;
      map.getSource('hover').setData(fc([{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line(lat) } }]));
      setReadout(last);
    });
  });
  map.on('mouseout', () => { map.getSource('hover')?.setData(fc([])); setReadout(null); });
  map.on('click', (e) => {
    const p = cityAt(e.point);
    if (p) { selectCity(p, false); return; }
    const lat = Math.round(e.lngLat.lat * 100) / 100;
    if (Math.abs(lat) > 89.5) return;
    let r = curRep();
    if (!r) { const b = A.bandFor(lat); r = newRep(lat, 0.5, t('rep_prefix') + b.label); } else r.c = lat;
    saveReps(); renderReps(); renderDetail(); refreshMap();
  });
}
function cityAt(pt) {
  const layers = ['cap-dot', 'mine-dot', 'citizens-dot', 'cities-big', 'cities-all'].filter((l) => map.getLayer(l));
  const fs = map.queryRenderedFeatures([[pt.x - 7, pt.y - 7], [pt.x + 7, pt.y + 7]], { layers });
  let best = null;
  for (const f of fs) { const p = findPt(f.properties.id); if (p && (!best || p.pop > best.pop)) best = p; }
  return best;
}
function setReadout(e) {
  const el = $('#readout');
  if (!e) { el.innerHTML = `<b>${esc(t('idle'))}</b><small>${esc(t('idle2'))}</small>`; return; }
  const { lat, lng } = e.lngLat;
  const p = cityAt(e.point);
  const cr = curRep();
  let country = '';
  if (!p) { const f = map.queryRenderedFeatures(e.point, { layers: ['countries-fill'] })[0]; if (f) { const c = ROWSDATA.countries[f.properties.k]; country = c ? c[lang] : ''; } }
  el.innerHTML = `<span class="mono">${fLat(lat)} · ${fLon(A.wrapLon(lng))}</span>` + (p
    ? `<small><b>${esc(p.name)}</b>${p.cc ? ' · ' + esc(cname(p.cc)) : ''} — ${esc(t('hov_city'))}</small>`
    : `<small>${country ? esc(country) + ' · ' : ''}${esc(cr ? t('hov_move', cr.name) : t('hov_found'))}</small>`);
}
function refreshMap() {
  if (!mapReady) return;
  map.getSource('bands').setData(bandsGJ());
  map.getSource('bandlines').setData(bandLinesGJ());
  map.getSource('citizens').setData(citizensGJ());
  map.getSource('sel').setData(selGJ());
}
function applyTheme() {
  if (!mapReady) return;
  const T = theme();
  const set = (l, p, v) => map.getLayer(l) && map.setPaintProperty(l, p, v);
  set('bg', 'background-color', view === 'globe' ? T.space : T.sea);
  set('countries-fill', 'fill-color', T.land); set('countries-line', 'line-color', T.border);
  set('grat', 'line-color', T.grat); set('special', 'line-color', T.special); set('special-label', 'text-color', T.muted);
  set('band-label', 'text-halo-color', T.sea); set('sel-line', 'line-color', T.ink); set('hover-line', 'line-color', T.accent);
  set('cities-big', 'circle-color', T.ink); set('cities-all', 'circle-color', T.ink);
  set('citizens-dot', 'circle-stroke-color', T.panel); set('mine-dot', 'circle-stroke-color', T.ink); set('cap-dot', 'circle-stroke-color', T.panel);
  set('sel-ring', 'circle-stroke-color', T.ink);
  for (const l of ['citizens-label', 'sel-label']) { set(l, 'text-color', T.ink); set(l, 'text-halo-color', T.sea); }
}
function setView(v, initial) {
  view = v; store.set('rp.view', v);
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  $('#mapwrap').classList.toggle('globe', v === 'globe');
  if (!mapReady) return;
  try { map.setProjection({ type: v === 'globe' ? 'globe' : 'mercator' }); } catch (e) { console.warn(e); }
  applyTheme();
  if (!initial && selCity) centerOn(selCity.lat, selCity.lon);
}
function centerOn(lat, lon) {
  if (!mapReady) return;
  const z = Math.max(map.getZoom(), view === 'globe' ? 1.6 : 3);
  map.flyTo({ center: [lon, Math.max(-80, Math.min(80, lat))], zoom: z, duration: reduceMotion ? 0 : 900, essential: true });
}

/* ---------- panel ---------- */
function selectCity(p, pan) { selCity = p; renderCity(); refreshMap(); if (pan) centerOn(p.lat, p.lon); }
function renderCity() {
  const p = selCity, el = $('#cityCard');
  if (!p) { el.innerHTML = ''; return; }
  const tw = A.twins(p, TWINPOOL);
  el.innerHTML = `<div class="city"><h3>${esc(p.name)}${p.mine ? `<span class="tag">${esc(t('yours'))}</span>` : ''}</h3>
    <div class="meta">${p.cc ? esc(cname(p.cc)) + ' · ' : ''}${p.pop ? fmt.compact(p.pop) + ' · ' : ''}<span class="mono">${fLat(p.lat)} ${fLon(p.lon)}</span></div></div>
    <h4 class="eyebrow" style="margin-top:4px">${esc(t('twins'))}</h4>
    <ul class="rows">${tw.map((x) => `<li><button class="row" type="button" data-pt="${x.p.id}"><span class="n">${esc(x.p.name)} <em>${esc(x.p.cc ? cname(x.p.cc) : '')}</em></span><span class="v">Δ ${x.d.toFixed(2)}° · ${fmt.int(x.km)} km</span></button></li>`).join('')}</ul>
    <div class="actions"><button class="btn primary" type="button" id="found">${esc(t('found_here'))}</button></div>`;
  $('#found').onclick = () => {
    const b = A.bandFor(p.lat);
    const ex = reps.find((r) => Math.abs(r.c - b.c) < 1e-6 && Math.abs(r.w - b.w) < 1e-6);
    if (ex) { selRep = ex.id; if (!capitalOf(ex)) ex.capital = p.id; } else { const r = newRep(b.c, b.w, t('rep_prefix') + b.label); r.capital = p.id; }
    saveReps(); renderReps(); renderDetail(); refreshMap();
    $('#repDetail').scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  };
}
function renderReps() {
  $('#repList').innerHTML = reps.map((r) => `<li class="rep${r.id === selRep ? ' on' : ''}"><button class="pick" type="button" data-rep="${r.id}" aria-pressed="${r.id === selRep}"><span class="sw" style="background:${r.color}"></span><span class="nm">${esc(r.name)}</span><span class="rg">${rangeTxt(r)}</span></button><button class="del" type="button" data-del="${r.id}" aria-label="${esc(t('dissolve'))} ${esc(r.name)}">×</button></li>`).join('');
}
const genKey = (r) => r.id + '|' + lang;
function renderDetail() {
  const r = curRep(), el = $('#repDetail');
  if (!r) { el.innerHTML = `<p class="empty">${esc(t('empty_reps'))}</p>`; return; }
  el.innerHTML = `<div class="detail">
    <div class="rephead"><canvas id="flagMini" width="216" height="144" aria-hidden="true"></canvas><div style="min-width:0;flex:1">
      <input class="field" id="repName" value="${esc(r.name)}" aria-label="${esc(t('reps'))}" style="font-weight:700;font-family:var(--f-display);font-size:1.05rem">
      <div class="motto" id="repMotto"></div></div></div>
    <div class="ctrl">
      <label for="repLat">${esc(t('center'))}</label><input class="field mono" id="repLat" type="number" step="0.01" min="-89.5" max="89.5" value="${r.c}">
      <label for="repW">${esc(t('width'))}</label><div style="display:flex;gap:10px;align-items:center;min-width:0"><input id="repW" type="range" min="0.05" max="3" step="0.05" value="${r.w}"><output id="repWo" for="repW">${r.w.toFixed(2)}°</output></div>
      <label for="repCap">${esc(t('capital'))}</label><select class="field" id="repCap"></select>
    </div>
    <div class="actions"><button class="btn" type="button" id="snap">${esc(t('snap'))}</button><button class="btn" type="button" id="shareRep">${esc(t('share'))}</button><button class="btn primary" type="button" id="openCard">${esc(t('card'))}</button></div>
    <div class="stats" id="repStats"></div><p class="note">${esc(t('est_note', META.popYear))}</p>
    <h4 class="eyebrow">${esc(t('crossed'))}</h4><div class="chips" id="repCountries"></div>
    <h4 class="eyebrow">${esc(t('artists'))}</h4><div id="repArtists"></div>
    <h4 class="eyebrow">${esc(t('route'))}</h4><div id="repRoute"></div>
    <h4 class="eyebrow">${esc(t('chron'))}</h4><div id="chron"></div>
    <h4 class="eyebrow">${esc(t('citizens'))}</h4><ul class="rows" id="repCities"></ul></div>`;
  $('#repName').oninput = (e) => { r.name = e.target.value || '—'; saveReps(); renderReps(); paintFlag(); refreshMap(); };
  $('#repLat').oninput = (e) => { const x = parseFloat(e.target.value); if (isFinite(x)) { r.c = Math.max(-89.5, Math.min(89.5, x)); saveReps(); renderReps(); updateStats(); refreshMap(); } };
  $('#repW').oninput = (e) => { r.w = +e.target.value; $('#repWo').textContent = r.w.toFixed(2) + '°'; saveReps(); renderReps(); updateStats(); refreshMap(); };
  $('#repCap').onchange = (e) => { r.capital = e.target.value || null; saveReps(); refreshMap(); updateStats(); };
  $('#snap').onclick = () => { const b = A.bandFor(r.c); r.c = b.c; r.w = b.w; saveReps(); renderReps(); renderDetail(); refreshMap(); };
  $('#shareRep').onclick = () => shareRep(r);
  $('#openCard').onclick = openCard;
  updateStats();
}
function paintFlag() {
  const r = curRep(), c = $('#flagMini'); if (!r || !c) return;
  const g = c.getContext('2d'); g.clearRect(0, 0, 216, 144); drawFlag(g, 0, 0, 216, 144, r);
  const gen = gens[genKey(r)];
  $('#repMotto').textContent = gen && gen.motto ? '«' + gen.motto + '»' : rangeTxt(r);
}
function updateStats() {
  const r = curRep(); if (!r || !$('#repStats')) return;
  const a = analysis(r);
  if (document.activeElement !== $('#repLat')) $('#repLat').value = r.c;
  $('#repStats').innerHTML = [
    [fmt.compact(a.pop), t('pop')], [fmt.usd(a.gdp), t('gdp')], [fmt.compact(a.area) + ' km²', t('area')],
    [fmt.int(a.km) + ' km', t('circ')], [a.land == null ? '—' : Math.round(a.land * 100) + ' %', t('land')], [String(a.countries.length), t('ncountries')],
  ].map(([b, s]) => `<div class="stat"><b>${esc(b)}</b><span>${esc(s)}</span></div>`).join('');
  $('#repCountries').innerHTML = a.countries.length ? a.countries.map((c, i) => (i ? '<span class="ar">→</span>' : '') + `<span class="c">${esc(c.name)}</span>`).join('') : `<p class="empty">${esc(t('ocean'))}</p>`;
  const cap = capitalOf(r);
  const top = a.cities.slice(0, 25);
  $('#repCities').innerHTML = top.length
    ? top.map((p) => `<li><button class="row" type="button" data-pt="${p.id}"><span class="n">${p.id === r.capital ? '★ ' : ''}${esc(p.name)}${p.mine ? `<span class="tag">${esc(t('yours'))}</span>` : ''} <em>${esc(p.cc ? cname(p.cc) : '')}</em></span><span class="v">${p.pop ? fmt.compact(p.pop) : ''} · ${fLat(p.lat)}</span></button></li>`).join('')
      + (a.cities.length > top.length ? `<li><p class="note" style="padding:6px">${esc(t('more_cities', fmt.int(a.cities.length - top.length)))}</p></li>` : '')
    : `<li><p class="empty">${esc(t('no_citizens'))}</p></li>`;
  const sel = $('#repCap');
  const opts = a.cities.slice(0, 300).concat(cap && !a.cities.slice(0, 300).includes(cap) ? [cap] : []).sort((x, y) => x.name.localeCompare(y.name, lang));
  sel.innerHTML = `<option value="">${esc(t('cap_none'))}</option>` + opts.map((p) => `<option value="${p.id}"${cap && cap.id === p.id ? ' selected' : ''}>${esc(p.name)}${p.cc ? ' (' + esc(p.cc) + ')' : ''}</option>`).join('');
  renderArtists(r); renderRoute(r, a); paintFlag(); renderChron();
}
function renderArtists(r) {
  const list = ARTISTS.filter((x) => A.inBand(r, x.lat)).slice(0, 14);
  const occ = t('occ');
  $('#repArtists').innerHTML = list.length
    ? '<div>' + list.map((x) => `<div class="art"><span><a href="https://www.wikidata.org/wiki/${esc(x.id)}" target="_blank" rel="noopener">${esc(x[lang] || x.en)}</a> <em>${esc(x.o.map((o) => occ[o] || o).join(', '))}</em></span><span class="v">${x.y ? x.y : ''}</span><small>${esc(x.b[lang === 'es' ? 0 : 1] || x.b[0])} · ${fLat(x.lat)}</small></div>`).join('') + `</div><p class="note">${esc(t('artists_src'))}</p>`
    : `<p class="empty">${esc(t('no_artists'))}</p>`;
}
function renderRoute(r, a) {
  const route = A.autoRoute(a.cities);
  const far = A.farTwins(a.cities);
  let h = '';
  if (route.length > 1) h += `<div class="chips">${route.map((p, i) => (i ? '<span class="ar">→</span>' : '') + `<button class="c" type="button" data-pt="${p.id}" style="cursor:pointer">${esc(p.name)}</button>`).join('')}</div><p class="note">${esc(t('route_note'))}</p>`;
  if (far) h += `<p style="margin:4px 0 0"><b>${esc(t('far'))}:</b> ${esc(t('far_txt', far.a.name, far.b.name, far.d.toFixed(2), fmt.int(far.km)))}</p>`;
  $('#repRoute').innerHTML = h || `<p class="empty">${esc(t('no_citizens'))}</p>`;
}

/* ---------- crónica (clave propia de la API de Anthropic) ---------- */
let genBusy = null, genErr = '';
function renderChron() {
  const r = curRep(), el = $('#chron'); if (!r || !el) return;
  const key = store.get('rp.key', '');
  const g = gens[genKey(r)];
  const fresh = g && Math.abs(g.c - r.c) < 1e-9 && Math.abs(g.w - r.w) < 1e-9;
  let h = '<div class="box">';
  if (!g && !genBusy) h += `<p class="note">${esc(t('chron_intro'))}</p>`;
  if (genBusy === r.id) h += `<p><span class="spin"></span>${esc(t('generating'))}</p>`;
  if (g) {
    if (!fresh) h += `<p class="note">${esc(t('gen_stale'))}</p>`;
    h += `<p class="lead">«${esc(g.motto)}»</p><p><b>${esc(t('demonym'))}:</b> ${esc(g.demonym)} · <b>${esc(t('anthem'))}:</b> ${esc(g.anthem)}</p>`;
    h += `<h4 class="eyebrow">${esc(t('folklore'))}</h4>` + String(g.folklore).split(/\n+/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');
    if (g.trips?.length) h += `<h4 class="eyebrow">${esc(t('trips'))}</h4>` + g.trips.map((x) => `<div class="trip"><b>${esc(x.title)}</b><span class="stops">${(x.stops || []).map(esc).join(' → ')}</span><span>${esc(x.why)}</span></div>`).join('');
    h += `<p class="note">${esc(t('gen_note'))}</p>`;
  }
  if (genErr) h += `<p class="note">${esc(t('gen_err', genErr))}</p>`;
  if (!key) {
    h += `<form class="keyrow" id="keyForm"><input class="field mono" id="apiKey" type="password" autocomplete="off" placeholder="${esc(t('key_ph'))}" aria-label="${esc(t('key_ph'))}"><button class="btn" type="submit">${esc(t('key_save'))}</button></form>`;
  } else if (genBusy !== r.id) {
    h += `<div class="actions"><button class="btn${g ? '' : ' primary'}" type="button" id="genBtn">${esc(g ? t('regen') : t('gen'))}</button><button class="btn sm" type="button" id="keyForget">${esc(t('key_forget'))}</button></div>`;
  }
  el.innerHTML = h + '</div>';
  const kf = $('#keyForm');
  if (kf) kf.onsubmit = (e) => { e.preventDefault(); const v = $('#apiKey').value.trim(); if (!v) return; store.set('rp.key', v); toast(t('key_saved')); renderChron(); };
  const gb = $('#genBtn'); if (gb) gb.onclick = () => generate(r);
  const kg = $('#keyForget'); if (kg) kg.onclick = () => { store.del('rp.key'); renderChron(); };
}
function buildPrompt(r, a) {
  const cap = capitalOf(r);
  const cs = a.countries.map((c) => c.name + (c.pop ? ` (~${(c.pop / 1e6).toFixed(1)}M people in the band)` : '')).join(' → ');
  const cities = a.cities.slice(0, 50).map((p) => `${p.name} (${p.cc}) ${p.lat.toFixed(2)},${p.lon.toFixed(2)}`).join('; ');
  const artists = ARTISTS.filter((x) => A.inBand(r, x.lat)).slice(0, 15).map((x) => `${x.en} (${x.o.join('/')}, born ${x.b[1]})`).join('; ');
  return `You are the playful chronicler of an imaginary "parallel republic": every place on Earth between latitudes ${(r.c - r.w).toFixed(2)} and ${(r.c + r.w).toFixed(2)} (signed degrees, south negative).
Republic name: ${r.name}
Capital: ${cap ? cap.name + ' (' + cap.cc + ')' : 'none yet'}
Countries crossed west to east: ${cs || 'only ocean'}
Largest cities inside: ${cities || 'none'}
Famous artists born inside (from Wikidata): ${artists || 'none listed'}
Estimated population ${Math.round(a.pop / 1e6)} million; estimated GDP ${Math.round(a.gdp / 1e9)} billion USD.

Write in ${lang === 'es' ? 'Spanish (Spain)' : 'English'}. Reply with ONLY one JSON object with these keys:
"demonym": invented demonym (one or two words);
"motto": a short national motto (max 8 words);
"anthem": title of the national anthem;
"folklore": two short paragraphs separated by a blank line (max 150 words) inventing a shared folklore that weaves together REAL traditions, festivals, foods or music from the regions in the band, naming each real tradition and where it comes from; you may mention the artists listed above;
"trips": exactly 3 travel suggestions as objects {"title","stops":[3 to 5 real places inside the band, west to east],"why":"one sentence"}.`;
}
function extractJSON(text) {
  try { return JSON.parse(text); } catch { /* try the outermost braces */ }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) throw new Error('JSON');
  return JSON.parse(text.slice(a, b + 1));
}
async function generate(r) {
  const key = store.get('rp.key', ''); if (!key || genBusy) return;
  genBusy = r.id; genErr = ''; renderChron();
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: 'user', content: buildPrompt(r, analysis(r)) }] }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || 'HTTP ' + res.status);
    const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    const o = extractJSON(text);
    gens[genKey(r)] = {
      c: r.c, w: r.w, motto: String(o.motto || ''), demonym: String(o.demonym || ''), anthem: String(o.anthem || ''), folklore: String(o.folklore || ''),
      trips: (Array.isArray(o.trips) ? o.trips : []).slice(0, 3).map((x) => ({ title: String(x.title || ''), stops: (x.stops || []).slice(0, 6).map(String), why: String(x.why || '') })),
    };
    store.set('rp.gen', gens);
  } catch (e) { genErr = e.message || String(e); }
  genBusy = null;
  if (curRep() === r) { renderChron(); paintFlag(); }
}

/* ---------- ficha y enlaces ---------- */
function openCard() {
  const r = curRep(); if (!r) return;
  const cap = capitalOf(r);
  drawCard($('#cardCv'), { rep: r, a: analysis(r), gen: gens[genKey(r)], cap, capName: cap ? cap.name : '', countries: COUNTRIES_GJ, t, fmt, rangeTxt: rangeTxt(r) });
  const d = $('#cardDlg'); if (d.showModal) d.showModal(); else d.setAttribute('open', '');
}
$('#cardClose').onclick = () => { const d = $('#cardDlg'); if (d.close) d.close(); else d.removeAttribute('open'); };
$('#cardSave').onclick = () => {
  const r = curRep();
  $('#cardCv').toBlob((b) => {
    if (!b) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = (norm(r.name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'republica') + '.png';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(t('saved'));
  }, 'image/png');
};
async function shareRep(r) {
  const url = location.origin + location.pathname + '?r=' + A.encodeRep(r);
  try { await navigator.clipboard.writeText(url); toast(t('copied')); } catch { window.prompt(t('share'), url); }
}
function importFromUrl() {
  const s = new URLSearchParams(location.search).get('r'); if (!s) return;
  const o = A.decodeRep(s);
  history.replaceState(null, '', location.pathname);
  if (!o) return;
  const ex = reps.find((r) => r.name === o.name && Math.abs(r.c - o.c) < 1e-6 && Math.abs(r.w - o.w) < 1e-6);
  if (ex) { selRep = ex.id; } else { const r = newRep(o.c, o.w, o.name || t('rep_prefix') + A.bandFor(o.c).label); r.capital = o.capital; toast(t('imported', r.name)); }
  saveReps();
}

/* ---------- buscador, sorpresa y lugares ---------- */
const q = $('#q'), sg = $('#sugg'); let sIdx = 0, sRes = [];
function showSugg() {
  const s = norm(q.value.trim()); if (!s) { sg.hidden = true; return; }
  const starts = [], inc = [];
  for (const p of CITIES) { const i = p.n.indexOf(s); if (i === 0) starts.push(p); else if (i > 0) inc.push(p); }
  sRes = starts.sort((a, b) => b.pop - a.pop).concat(inc.sort((a, b) => b.pop - a.pop)).slice(0, 8); sIdx = 0;
  if (!sRes.length) { sg.innerHTML = `<li><span style="padding:6px 8px;display:block;color:var(--muted)">${esc(t('no_results'))}</span></li>`; sg.hidden = false; return; }
  sg.innerHTML = sRes.map((p, i) => `<li><button type="button" class="${i === sIdx ? 'on' : ''}" data-s="${i}">${esc(p.name)}<span>${esc(p.cc ? cname(p.cc) : t('yours'))} · ${fLat(p.lat)}</span></button></li>`).join('');
  sg.hidden = false;
}
function pickSugg(i) { const p = sRes[i]; if (!p) return; q.value = ''; sg.hidden = true; selectCity(p, true); }
q.addEventListener('input', showSugg);
q.addEventListener('keydown', (e) => {
  if (sg.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!sRes.length) return; sIdx = (sIdx + (e.key === 'ArrowDown' ? 1 : -1) + sRes.length) % sRes.length; [...sg.querySelectorAll('button')].forEach((b, i) => b.classList.toggle('on', i === sIdx)); }
  else if (e.key === 'Enter') { e.preventDefault(); pickSugg(sIdx); } else if (e.key === 'Escape') sg.hidden = true;
});
sg.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-s]'); if (b) { e.preventDefault(); pickSugg(+b.dataset.s); } });
q.addEventListener('blur', () => setTimeout(() => { sg.hidden = true; }, 120));

$('#surprise').onclick = () => {
  const big = CITIES.filter((p) => p.pop >= 300000);
  for (let i = 0; i < 60; i++) {
    const p = big[Math.floor(Math.random() * big.length)];
    if (A.twins(p, TWINPOOL, 3).some((x) => x.d < 0.1 && x.km > 5000)) { selectCity(p, true); $('#cityCard').scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }); return; }
  }
};
function renderPlaces() {
  $('#placeList').innerHTML = places.map((p) => `<li style="display:flex;align-items:center"><button class="row" type="button" data-pt="${p.id}" style="flex:1"><span class="n">${esc(p.name)}</span><span class="v">${fLat(p.lat)} · ${fLon(p.lon)}</span></button><button class="btn sm" type="button" data-delplace="${p.id}" aria-label="× ${esc(p.name)}" style="margin-left:4px">×</button></li>`).join('');
}
$('#placeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#pName').value.trim(), c = A.parseCoords($('#pCoord').value);
  if (!name) return;
  if (!c) { $('#pMsg').textContent = t('place_bad'); return; }
  let cc = '';
  if (mapReady) { const f = map.queryRenderedFeatures(map.project([c.lon, c.lat]), { layers: ['countries-fill'] })[0]; if (f && /^[A-Z]{2}$/.test(f.properties.k)) cc = f.properties.k; }
  const p = { id: 'p' + Date.now().toString(36), name, lat: c.lat, lon: c.lon, cc };
  places.push(p); store.set('rp.places', places); rebuildIndex();
  $('#pName').value = ''; $('#pCoord').value = ''; $('#pMsg').textContent = t('place_ok');
  renderPlaces(); selectCity(findPt(p.id), true); updateStats();
});

document.addEventListener('click', (e) => {
  const pt = e.target.closest('[data-pt]'); if (pt) { const p = findPt(pt.dataset.pt); if (p) selectCity(p, true); return; }
  const rp = e.target.closest('[data-rep]'); if (rp) { selRep = rp.dataset.rep; saveReps(); renderReps(); renderDetail(); refreshMap(); return; }
  const dl = e.target.closest('[data-del]');
  if (dl) { reps = reps.filter((r) => r.id !== dl.dataset.del); if (!reps.find((r) => r.id === selRep)) selRep = reps[0] ? reps[0].id : null; saveReps(); renderReps(); renderDetail(); refreshMap(); return; }
  const dp = e.target.closest('[data-delplace]');
  if (dp) { places = places.filter((p) => p.id !== dp.dataset.delplace); store.set('rp.places', places); rebuildIndex(); if (selCity && selCity.id === dp.dataset.delplace) selCity = null; renderPlaces(); renderCity(); updateStats(); refreshMap(); }
});
$('#addRep').onclick = () => { const b = A.bandFor(selCity ? selCity.lat : 0); const r = newRep(b.c, b.w, t('rep_prefix') + b.label); if (selCity) r.capital = selCity.id; saveReps(); renderReps(); renderDetail(); refreshMap(); };
document.querySelectorAll('[data-view]').forEach((b) => { b.onclick = () => setView(b.dataset.view); });
$('#zin').onclick = () => map && map.zoomIn(); $('#zout').onclick = () => map && map.zoomOut();
$('#zfit').onclick = () => map && map.flyTo({ center: [0, 28], zoom: 1.1, duration: reduceMotion ? 0 : 800 });

/* ---------- idioma ---------- */
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  const set = (id, k) => { $(id).textContent = t(k); };
  set('#tagline', 'tagline'); set('#vFlat', 'flat'); set('#vGlobe', 'globe'); set('#surprise', 'surprise'); set('#lSearch', 'search');
  set('#lReps', 'reps'); set('#addRep', 'newrep'); set('#lPlaces', 'places'); set('#pAdd', 'add'); set('#pMsg', 'place_hint');
  set('#cardClose', 'close'); set('#cardSave', 'save');
  $('#q').placeholder = t('search_ph'); $('#pName').placeholder = t('pname'); $('#pName').setAttribute('aria-label', t('pname')); $('#pCoord').setAttribute('aria-label', 'lat, lon');
  $('#zin').setAttribute('aria-label', t('zin')); $('#zout').setAttribute('aria-label', t('zout')); $('#zfit').setAttribute('aria-label', t('zfit'));
  $('#foot').textContent = t('foot', META.built ? new Date(META.built).toLocaleDateString(lang) : '');
  setReadout(null);
  if (!ROWSDATA) return;
  renderCity(); renderReps(); renderDetail(); renderPlaces();
  if (mapReady) map.getSource('special').setData(specialGJ());
}
document.querySelectorAll('[data-lang]').forEach((b) => { b.onclick = () => { lang = b.dataset.lang; store.set('rp.lang', lang); applyLang(); }; });
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);

/* ---------- arranque ---------- */
(async function boot() {
  $('#status').textContent = t('loading');
  applyLang();
  try { await loadData(); } catch (e) { console.error(e); $('#status').textContent = t('load_fail'); return; }
  importFromUrl();
  selCity = CITIES.find((p) => p.name === 'Marín' && p.cc === 'ES') || CITIES[0];
  applyLang();
  if (typeof maplibregl === 'undefined') { $('#status').textContent = t('map_fail'); return; }
  initMap();
})();
