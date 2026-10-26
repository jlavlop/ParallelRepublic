// Band analysis: pure functions shared by the page and the tests.

export const RES = 0.25;
export const ROWS = 720;
const URBAN_WEIGHT = 0.6; // share of a country's people placed by where its cities are; the rest by land area

export const rowOf = (lat) => Math.min(ROWS - 1, Math.max(0, Math.floor((lat + 90) / RES)));
export const inBand = (rep, lat) => lat >= rep.c - rep.w && lat <= rep.c + rep.w;
export const wrapLon = (x) => ((x + 180) % 360 + 360) % 360 - 180;

/** Rows touched by [lo, hi] with the fraction of each row covered. */
export function bandRows(lo, hi) {
  const out = [];
  for (let r = rowOf(lo); r <= rowOf(hi); r++) {
    const a = -90 + r * RES, b = a + RES;
    const ov = Math.max(0, Math.min(b, hi) - Math.max(a, lo)) / RES;
    if (ov > 0) out.push([r, ov]);
  }
  return out;
}

/** Totals for each country, computed once. */
export function prepareRows(data) {
  for (const c of Object.values(data.countries)) {
    c.tA = c.area.reduce((s, v) => s + (v || 0), 0);
    c.tU = c.urban.reduce((s, v) => s + (v || 0), 0);
  }
  return data;
}

/**
 * Everything the panel shows about a band.
 * @param data   prepared rows.json
 * @param cities array of {lat, lon, cc, pop, ...}
 * @param rep    {c, w}
 * @param lang   'es' | 'en'
 * @param cname  (cc) => country name for codes that only appear in cities
 */
export function analyzeBand(data, cities, rep, lang, cname = (c) => c) {
  const lo = rep.c - rep.w, hi = rep.c + rep.w;
  const rows = bandRows(lo, hi);
  const rc = rowOf(rep.c);
  const list = [];
  let pop = 0, gdp = 0, area = 0;
  for (const [key, c] of Object.entries(data.countries)) {
    let a = 0, u = 0, x = NaN, xc = NaN;
    for (const [r, ov] of rows) {
      const i = r - c.r0;
      if (i < 0 || i >= c.area.length) continue;
      a += (c.area[i] || 0) * ov;
      u += (c.urban[i] || 0) * ov;
      const m = c.minx[i];
      if (m != null && (isNaN(x) || m < x)) x = m;
    }
    const ic = rc - c.r0;
    if (ic >= 0 && ic < c.minx.length && c.minx[ic] != null) xc = c.minx[ic];
    if (a <= 0 && u <= 0) continue;
    const areaShare = c.tA ? a / c.tA : 0;
    const urbanShare = c.tU ? u / c.tU : null;
    const share = urbanShare == null ? areaShare : URBAN_WEIGHT * urbanShare + (1 - URBAN_WEIGHT) * areaShare;
    const e = {
      key, name: c[lang] || c.en, x: wrapLon(isNaN(xc) ? (isNaN(x) ? 0 : x) : xc),
      area: a, share, pop: c.pop * share, gdp: c.gdp * share,
    };
    list.push(e); pop += e.pop; gdp += e.gdp; area += a;
  }
  const inside = cities.filter((p) => inBand(rep, p.lat));
  const have = new Set(list.map((e) => e.key));
  for (const p of inside) {
    if (p.cc && !have.has(p.cc) && p.cc !== 'AQ') { have.add(p.cc); list.push({ key: p.cc, name: cname(p.cc), x: p.lon, area: 0, share: 0, pop: 0, gdp: 0, micro: true }); }
  }
  list.sort((a, b) => a.x - b.x);
  const landRow = data.land ? data.land[rc] || 0 : null;
  return {
    countries: list,
    cities: inside.slice().sort((a, b) => b.pop - a.pop),
    pop, gdp, area,
    land: landRow == null ? null : Math.min(1, landRow / 360),
    km: 40075.017 * Math.cos(rep.c * Math.PI / 180),
  };
}

/** Cities in other countries with the closest latitude. */
export function twins(city, pool, n = 7) {
  const k = 111.32 * Math.cos(city.lat * Math.PI / 180);
  return pool
    .filter((p) => p !== city && (!city.cc || !p.cc || p.cc !== city.cc))
    .map((p) => {
      const dlon = Math.abs(wrapLon(p.lon - city.lon));
      return { p, d: Math.abs(p.lat - city.lat), km: dlon * k };
    })
    .sort((a, b) => a.d - b.d || b.p.pop - a.p.pop)
    .slice(0, n);
}

/** The whole-degree band that contains a latitude: 42.39 → 42°–43°N. */
export function bandFor(lat) {
  const d = Math.trunc(Math.abs(lat));
  const lo = lat >= 0 ? d : -(d + 1);
  return { c: lo + 0.5, w: 0.5, label: d + '°' + (lat >= 0 ? 'N' : 'S') };
}

/** Accepts "42.39, -8.70", "42,39 -8,70" or "42.39°N 8.70°W". */
export function parseCoords(s) {
  let x = String(s).trim().toUpperCase();
  if (!/\./.test(x)) x = x.replace(/(\d),(\d)/g, '$1.$2');
  const m = [...x.matchAll(/(-?\d+(?:\.\d+)?)\s*°?\s*([NSEWO])?/g)];
  if (m.length < 2) return null;
  let lat = +m[0][1], lon = +m[1][1];
  if (m[0][2] === 'S') lat = -Math.abs(lat);
  if (m[1][2] === 'W' || m[1][2] === 'O') lon = -Math.abs(lon);
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null;
  return { lat, lon };
}

/** One stop per country, the biggest city, west to east. */
export function autoRoute(cities, max = 7) {
  const best = new Map();
  for (const p of cities) { const k = p.cc || p.name; if (!best.has(k) || best.get(k).pop < p.pop) best.set(k, p); }
  return [...best.values()].sort((a, b) => b.pop - a.pop).slice(0, max).sort((a, b) => a.lon - b.lon);
}

/** Pair of cities in the band that are closest in latitude but farthest apart. */
export function farTwins(cities, minKm = 4000) {
  let best = null;
  const top = cities.slice(0, 400);
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) {
    const a = top[i], b = top[j];
    if (a.cc === b.cc) continue;
    const km = Math.abs(wrapLon(a.lon - b.lon)) * 111.32 * Math.cos(a.lat * Math.PI / 180);
    if (km < minKm) continue;
    const d = Math.abs(a.lat - b.lat);
    if (!best || d < best.d) best = { a, b, d, km };
  }
  return best;
}

/** Encode / decode a republic for share links (?r=...). */
export function encodeRep(rep) {
  const o = { n: rep.name, c: +rep.c.toFixed(2), w: +rep.w.toFixed(2) };
  if (rep.capital) o.k = rep.capital;
  const b = btoa(unescape(encodeURIComponent(JSON.stringify(o))));
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeRep(s) {
  try {
    const b = s.replace(/-/g, '+').replace(/_/g, '/');
    const o = JSON.parse(decodeURIComponent(escape(atob(b))));
    if (!isFinite(o.c) || !isFinite(o.w)) return null;
    return { name: String(o.n || '').slice(0, 80), c: Math.max(-89.5, Math.min(89.5, +o.c)), w: Math.max(0.05, Math.min(3, +o.w)), capital: o.k || null };
  } catch { return null; }
}
