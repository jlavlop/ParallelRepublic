#!/usr/bin/env node
// Builds site/data/*.json from open sources. Runs in GitHub Actions (Node 20+, needs `unzip`).
//   node scripts/build-data.mjs            → download everything
//   node scripts/build-data.mjs --no-wikidata   → skip the artists query
// Sources: Natural Earth (public domain), GeoNames (CC BY 4.0), Wikidata (CC0, artists and UNESCO intangible heritage).

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RES, ROWS, ringsOf, scanRows, countryKey, prop, roundGeom,
  parseGeonames, parsePoint, packRows, rowOf, indexFeatures, featureAt,
} from './lib.mjs';
import { selectDiverse } from '../site/js/diversity.js';

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

/* ---------- artists and traditions (Wikidata) ---------- */
const OCCUPATIONS = {
  painter: 'Q1028181', sculptor: 'Q1281618', architect: 'Q42973', photographer: 'Q33231',
  illustrator: 'Q644687', comics_artist: 'Q715301', ceramicist: 'Q7541856',
  composer: 'Q36834', singer: 'Q177220', musician: 'Q639669', songwriter: 'Q753110', dancer: 'Q5716684', choreographer: 'Q2490358',
  writer: 'Q36180', poet: 'Q49757', novelist: 'Q6625963', playwright: 'Q214917',
  film_director: 'Q2526255', screenwriter: 'Q28389', actor: 'Q33999',
};
// Very large professions need a higher bar to stay within the query time limit.
const BIG = new Set(['writer', 'actor', 'musician', 'singer', 'novelist', 'screenwriter', 'poet', 'painter']);
const GENDER = { Q6581072: 'f', Q1052281: 'f', Q6581097: 'm', Q2449503: 'm', Q48270: 'x', Q1097630: 'x' };
const ROW_CAP = 40; // people kept per 0.25° row after the diverse selection

function artistQuery(qid, minLinks, womenOnly) {
  return `SELECT ?p ?es ?en ?birthEs ?birthEn ?coord ?links ?dob ?g WHERE {
  ?p wdt:P106 wd:${qid}; wdt:P31 wd:Q5; wikibase:sitelinks ?links; wdt:P19 ?birth.
  FILTER(?links >= ${minLinks})
  ${womenOnly ? 'VALUES ?g { wd:Q6581072 wd:Q1052281 } ?p wdt:P21 ?g.' : 'OPTIONAL { ?p wdt:P21 ?g. }'}
  ?birth wdt:P625 ?coord.
  OPTIONAL { ?p wdt:P569 ?dob. }
  OPTIONAL { ?p rdfs:label ?es FILTER(LANG(?es) = "es") }
  OPTIONAL { ?p rdfs:label ?en FILTER(LANG(?en) = "en") }
  OPTIONAL { ?birth rdfs:label ?birthEs FILTER(LANG(?birthEs) = "es") }
  OPTIONAL { ?birth rdfs:label ?birthEn FILTER(LANG(?birthEn) = "en") }
}`;
}

async function sparql(query, tries = 2) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(SRC.wikidata, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'query=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(90000),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return (await res.json()).results.bindings;
    } catch (e) {
      log(`  wikidata attempt ${i} failed: ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000 * i));
    }
  }
  return null;
}

/** Runs a query, raising the sitelinks bar when it times out. */
const WIKIDATA_BUDGET_MS = 20 * 60 * 1000; // stop querying after 20 minutes, keep what we have
const started = Date.now();
const outOfTime = () => Date.now() - started > WIKIDATA_BUDGET_MS;

async function sparqlWithFallback(make, minLinks) {
  for (let bar = minLinks, k = 0; k < 3 && !outOfTime(); k++, bar = Math.ceil(bar * 1.6)) {
    const rows = await sparql(make(bar));
    if (rows) return { rows, bar };
  }
  return { rows: null, bar: null };
}

async function buildArtists(countryIndex) {
  const byId = new Map();
  const add = (b, occ) => {
    const id = b.p.value.split('/').pop();
    const pt = parsePoint(b.coord?.value);
    if (!pt) return false;
    const g = b.g ? GENDER[b.g.value.split('/').pop()] || 'x' : '';
    const prev = byId.get(id);
    if (prev) { if (!prev.o.includes(occ)) prev.o.push(occ); if (!prev.g && g) prev.g = g; return false; }
    const en = b.en?.value || b.es?.value;
    if (!en || /^Q\d+$/.test(en)) return false;
    byId.set(id, {
      id, es: b.es?.value || en, en, o: [occ], g,
      b: [b.birthEs?.value || b.birthEn?.value || '', b.birthEn?.value || b.birthEs?.value || ''],
      lat: +pt[1].toFixed(3), lon: +pt[0].toFixed(3),
      y: b.dob?.value ? parseInt(b.dob.value.replace(/^\+/, ''), 10) || null : null,
      l: +b.links.value,
    });
    return true;
  };
  for (const [occ, qid] of Object.entries(OCCUPATIONS)) {
    if (outOfTime()) { log(`  out of time, skipping ${occ} and the rest`); break; }
    // Everyone above a fame bar, then women with a much lower bar so they are not drowned out.
    const all = await sparqlWithFallback((bar) => artistQuery(qid, bar, false), BIG.has(occ) ? 45 : 25);
    const fem = await sparqlWithFallback((bar) => artistQuery(qid, bar, true), BIG.has(occ) ? 15 : 8);
    let n = 0;
    for (const b of all.rows || []) if (add(b, occ)) n++;
    for (const b of fem.rows || []) if (add(b, occ)) n++;
    log(`  ${occ}: ${n} new (bars ${all.bar ?? '–'} / women ${fem.bar ?? '–'})`);
  }
  const list = [...byId.values()];
  for (const a of list) a.cc = featureAt(countryIndex, a.lon, a.lat) || '';

  // Keep a varied pool per latitude row so the file stays small.
  const counts = {};
  for (const a of list) counts[a.cc] = (counts[a.cc] || 0) + 1;
  const rows = new Map();
  for (const a of list) { const r = rowOf(a.lat); if (!rows.has(r)) rows.set(r, []); rows.get(r).push(a); }
  const kept = [];
  for (const [r, cands] of rows) {
    kept.push(...(cands.length <= ROW_CAP ? cands : selectDiverse(cands, ROW_CAP, {
      seed: r + 1, womenMin: 0.45, discoverShare: 0.5, maxPerCountry: 6, maxPerOcc: 10, countryCounts: counts,
    }).map(({ disc, ...a }) => a)));
  }
  kept.sort((a, b) => b.l - a.l);
  const women = kept.filter((a) => a.g === 'f').length;
  log(`artists: ${list.length} found, ${kept.length} kept (${women} women, ${new Set(kept.map((a) => a.cc)).size} countries)`);
  return { list: kept, counts };
}

/** UNESCO intangible cultural heritage elements, grouped by country (ISO alpha-2). */
async function buildTraditions() {
  const q = `SELECT ?item ?es ?en ?iso WHERE {
  VALUES ?dname {
    "Representative List of the Intangible Cultural Heritage of Humanity"@en
    "List of Intangible Cultural Heritage in Need of Urgent Safeguarding"@en
    "Masterpiece of the Oral and Intangible Heritage of Humanity"@en
    "Masterpieces of the Oral and Intangible Heritage of Humanity"@en
  }
  ?d rdfs:label ?dname.
  { ?item wdt:P1435 ?d. } UNION { ?item wdt:P31 ?d. }
  ?item wdt:P17 ?c. ?c wdt:P297 ?iso.
  OPTIONAL { ?item rdfs:label ?es FILTER(LANG(?es) = "es") }
  OPTIONAL { ?item rdfs:label ?en FILTER(LANG(?en) = "en") }
}`;
  const rows = await sparql(q, 3);
  const out = {};
  const seen = new Set();
  for (const b of rows || []) {
    const id = b.item.value.split('/').pop();
    const en = b.en?.value || b.es?.value;
    if (!en || /^Q\d+$/.test(en)) continue;
    const cc = b.iso.value.toUpperCase();
    const key = cc + id;
    if (seen.has(key)) continue;
    seen.add(key);
    (out[cc] ||= []).push([b.es?.value || en, en, id]);
  }
  log('traditions:', seen.size, 'in', Object.keys(out).length, 'countries');
  return out;
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

  let artists = [], artistCounts = {}, traditions = {};
  if (!args.has('--no-wikidata')) {
    const index = indexFeatures(features, (f) => f.properties.k);
    try { ({ list: artists, counts: artistCounts } = await buildArtists(index)); } catch (e) { log('artists failed:', e.message); }
    try { traditions = await buildTraditions(); } catch (e) { log('traditions failed:', e.message); }
  }

  const sample = Object.values(info).find((c) => c.popYear);
  const meta = {
    built: new Date().toISOString(),
    popYear: sample?.popYear ?? null, gdpYear: sample?.gdpYear ?? null,
    counts: {
      countries: features.length, cities: cities.length, artists: artists.length,
      women: artists.filter((a) => a.g === 'f').length,
      traditions: Object.values(traditions).reduce((n, l) => n + l.length, 0),
    },
    sources: ['Natural Earth 1:50m admin-0', 'GeoNames cities15000', 'Wikidata'],
  };

  await writeFile(join(OUT, 'countries.geojson'), JSON.stringify({ type: 'FeatureCollection', features }));
  await writeFile(join(OUT, 'rows.json'), JSON.stringify(rows));
  await writeFile(join(OUT, 'cities.json'), JSON.stringify(cities));
  await writeFile(join(OUT, 'artists.json'), JSON.stringify({ counts: artistCounts, list: artists }));
  await writeFile(join(OUT, 'traditions.json'), JSON.stringify(traditions));
  await writeFile(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
  log('done →', OUT, meta.counts);
}

main().catch((e) => { console.error(e); process.exit(1); });
