#!/usr/bin/env node
// Builds site/data/*.json from open sources. Runs in GitHub Actions (Node 20+, needs `unzip`).
//   node scripts/build-data.mjs            → download everything
//   node scripts/build-data.mjs --no-wikidata   → skip the artists query
// Sources: Natural Earth (public domain), GeoNames (CC BY 4.0), Wikidata (CC0).

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RES, ROWS, ringsOf, scanRows, countryKey, prop, roundGeom,
  parseGeonames, parsePoint, packRows, rowOf,
} from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'data');
const CACHE = join(ROOT, '.cache');
const UA = 'ParallelRepublic/1.0 (https://github.com/jlavlop/ParallelRepublic)';
const args = new Set(process.argv.slice(2));

const SRC = {
  countries: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
  cities: 'https://download.geonames.org/export/dump/cities15000.zip',
  wikidata: 'https://query.wikidata.org/sparql',
};

// Small places that are below the GeoNames 15 000 threshold but matter to the project.
const EXTRA_CITIES = [
  [3121388, 'Gósol', 'ES', 42.237, 1.661, 200],
];

const log = (...a) => console.log('[data]', ...a);

async function fetchCached(url, file, { binary = false, headers = {} } = {}) {
  const path = join(CACHE, file);
  if (existsSync(path)) return binary ? readFile(path) : readFile(path, 'utf8');
  log('downloading', url);
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers } });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE, { recursive: true });
  await writeFile(path, buf);
  return binary ? buf : buf.toString('utf8');
}

/* ---------- countries ---------- */
async function buildCountries() {
  const gj = JSON.parse(await fetchCached(SRC.countries, 'ne_50m_admin_0_countries.geojson'));
  const features = [];
  const info = {};
  const land = new Float64Array(ROWS);
  for (const f of gj.features) {
    const p = f.properties || {};
    const key = countryKey(p);
    if (!key) continue;
    const rings = ringsOf(f.geometry);
    const { len, area, minx } = scanRows(rings);
    let r0 = -1, r1 = -1, total = 0;
    for (let r = 0; r < ROWS; r++) if (area[r] > 0) { if (r0 < 0) r0 = r; r1 = r; total += area[r]; land[r] += len[r]; }
    const nameEn = prop(p, 'NAME_EN', 'NAME', 'ADMIN') || key;
    const nameEs = prop(p, 'NAME_ES') || nameEn;
    const pop = +prop(p, 'POP_EST') || 0;
    const gdpMd = +prop(p, 'GDP_MD', 'GDP_MD_EST') || 0;
    if (info[key]) { // same key twice (rare): merge
      const c = info[key];
      c.pop += pop; c.gdp += gdpMd * 1e6;
    } else {
      info[key] = { es: nameEs, en: nameEn, pop, gdp: gdpMd * 1e6, popYear: prop(p, 'POP_YEAR'), gdpYear: prop(p, 'GDP_YEAR'), _area: area, _minx: minx, _r0: r0, _r1: r1, _total: total };
    }
    features.push({ type: 'Feature', properties: { k: key }, geometry: roundGeom(f.geometry, 2) });
  }
  log('countries:', features.length);
  return { features, info, land };
}

/* ---------- cities ---------- */
async function buildCities() {
  const zip = await fetchCached(SRC.cities, 'cities15000.zip', { binary: true });
  const zipPath = join(CACHE, 'cities15000.zip');
  const text = execFileSync('unzip', ['-p', zipPath, 'cities15000.txt'], { maxBuffer: 1 << 28 }).toString('utf8');
  void zip;
  const rows = parseGeonames(text, 15000);
  const ids = new Set(rows.map((r) => r[0]));
  for (const e of EXTRA_CITIES) if (!ids.has(e[0])) rows.push(e);
  rows.sort((a, b) => b[5] - a[5]);
  log('cities:', rows.length);
  return rows;
}

/* ---------- artists (Wikidata) ---------- */
const OCCUPATIONS = {
  painter: 'Q1028181', sculptor: 'Q1281618', architect: 'Q42973', composer: 'Q36834',
  singer: 'Q177220', musician: 'Q639669', writer: 'Q36180', poet: 'Q49757',
  film_director: 'Q2526255', actor: 'Q33999', photographer: 'Q33231', dancer: 'Q5716684',
};

function artistQuery(qid, minLinks) {
  return `SELECT ?p ?es ?en ?birthEs ?birthEn ?coord ?links ?dob WHERE {
  ?p wdt:P106 wd:${qid}; wdt:P31 wd:Q5; wikibase:sitelinks ?links; wdt:P19 ?birth.
  FILTER(?links >= ${minLinks})
  ?birth wdt:P625 ?coord.
  OPTIONAL { ?p wdt:P569 ?dob. }
  OPTIONAL { ?p rdfs:label ?es FILTER(LANG(?es) = "es") }
  OPTIONAL { ?p rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?birth rdfs:label ?birthEs FILTER(LANG(?birthEs) = "es") }
  OPTIONAL { ?birth rdfs:label ?birthEn FILTER(LANG(?birthEn) = "en") }
}`;
}

async function sparql(query, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(SRC.wikidata, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'query=' + encodeURIComponent(query),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return (await res.json()).results.bindings;
    } catch (e) {
      log(`  wikidata attempt ${i} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 4000 * i));
    }
  }
  return null;
}

async function buildArtists() {
  const byId = new Map();
  for (const [occ, qid] of Object.entries(OCCUPATIONS)) {
    const minLinks = ['writer', 'actor', 'musician', 'singer'].includes(occ) ? 70 : 45;
    const rows = await sparql(artistQuery(qid, minLinks));
    if (!rows) { log(`  skipped ${occ}`); continue; }
    let n = 0;
    for (const b of rows) {
      const id = b.p.value.split('/').pop();
      const pt = parsePoint(b.coord?.value);
      if (!pt) continue;
      const prev = byId.get(id);
      if (prev) { if (!prev.o.includes(occ)) prev.o.push(occ); continue; }
      const en = b.en?.value || b.es?.value;
      if (!en || /^Q\d+$/.test(en)) continue;
      byId.set(id, {
        id, es: b.es?.value || en, en,
        o: [occ],
        b: [b.birthEs?.value || b.birthEn?.value || '', b.birthEn?.value || b.birthEs?.value || ''],
        lat: +pt[1].toFixed(3), lon: +pt[0].toFixed(3),
        y: b.dob?.value ? parseInt(b.dob.value.replace(/^\+/, ''), 10) || null : null,
        l: +b.links.value,
      });
      n++;
    }
    log(`  ${occ}: ${n} new`);
  }
  const list = [...byId.values()].sort((a, b) => b.l - a.l);
  log('artists:', list.length);
  return list;
}

/* ---------- main ---------- */
async function main() {
  await mkdir(OUT, { recursive: true });
  const { features, info, land } = await buildCountries();
  const cities = await buildCities();

  // Urban population per country and row (cities ≥ 15 000 inhabitants).
  const urban = {};
  for (const c of cities) {
    const k = c[2];
    if (!info[k]) continue;
    (urban[k] ||= new Float64Array(ROWS))[rowOf(c[3])] += c[5];
  }

  const rows = { res: RES, rows: ROWS, land: Array.from(land, (v) => Math.round(v * 100) / 100), countries: {} };
  for (const [k, c] of Object.entries(info)) {
    if (c._r0 < 0) continue;
    const u = urban[k] || new Float64Array(ROWS);
    // Rows where there is land or cities.
    let r0 = c._r0, r1 = c._r1;
    for (let r = 0; r < ROWS; r++) if (u[r] > 0) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
    rows.countries[k] = {
      es: c.es, en: c.en, pop: c.pop, gdp: c.gdp, r0,
      area: packRows(c._area, r0, r1, 0),
      urban: packRows(u, r0, r1, 0),
      minx: packRows(c._minx, r0, r1, 2),
    };
  }

  let artists = [];
  if (!args.has('--no-wikidata')) {
    try { artists = await buildArtists(); } catch (e) { log('artists failed:', e.message); }
  }

  const sample = Object.values(info).find((c) => c.popYear);
  const meta = {
    built: new Date().toISOString(),
    popYear: sample?.popYear ?? null, gdpYear: sample?.gdpYear ?? null,
    counts: { countries: features.length, cities: cities.length, artists: artists.length },
    sources: ['Natural Earth 1:50m admin-0', 'GeoNames cities15000', 'Wikidata'],
  };

  await writeFile(join(OUT, 'countries.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
  await writeFile(join(OUT, 'rows.json'), JSON.stringify(rows));
  await writeFile(join(OUT, 'cities.json'), JSON.stringify(cities));
  await writeFile(join(OUT, 'artists.json'), JSON.stringify(artists));
  await writeFile(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
  log('done →', OUT, meta.counts);
}

main().catch((e) => { console.error(e); process.exit(1); });
