// Shared helpers for the data pipeline. Pure functions, no dependencies.

export const RES = 0.25;            // latitude row height in degrees
export const ROWS = 180 / RES;      // 720 rows from -90 to 90
const KM_PER_DEG_LAT = 110.95;
const KM_PER_DEG_LON_EQ = 111.32;

export const rowOf = (lat) => Math.min(ROWS - 1, Math.max(0, Math.floor((lat + 90) / RES)));
export const rowLat = (r) => -90 + (r + 0.5) * RES;

/** All linear rings of a Polygon / MultiPolygon geometry. */
export function ringsOf(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return geom.coordinates;
  if (geom.type === 'MultiPolygon') return geom.coordinates.flat();
  return [];
}

/**
 * Horizontal scanline over a set of rings (even-odd rule).
 * For every row returns the land length in degrees of longitude, the land area in km²
 * and the westernmost crossing. Rows with no land are left at 0 / NaN.
 */
export function scanRows(rings) {
  const len = new Float64Array(ROWS);
  const area = new Float64Array(ROWS);
  const minx = new Float64Array(ROWS).fill(NaN);
  let lo = Infinity, hi = -Infinity;
  for (const ring of rings) for (const p of ring) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  if (!isFinite(lo)) return { len, area, minx };
  for (let r = rowOf(lo); r <= rowOf(hi); r++) {
    const lat = rowLat(r);
    const xs = [];
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat)) xs.push(xi + (lat - yi) * (xj - xi) / (yj - yi));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    let l = 0;
    for (let k = 0; k + 1 < xs.length; k += 2) l += xs[k + 1] - xs[k];
    if (l <= 0) continue;
    len[r] = l;
    area[r] = l * KM_PER_DEG_LON_EQ * Math.cos(lat * Math.PI / 180) * RES * KM_PER_DEG_LAT;
    minx[r] = xs[0];
  }
  return { len, area, minx };
}

/** Stable key for a Natural Earth country feature: ISO 3166-1 alpha-2 when it exists. */
export function countryKey(props) {
  const p = props || {};
  const pick = (...names) => { for (const n of names) { const v = p[n] ?? p[n.toLowerCase()]; if (v && v !== '-99' && v !== -99) return String(v); } return null; };
  return pick('ISO_A2_EH', 'ISO_A2', 'WB_A2') || pick('ADM0_A3', 'SOV_A3') || pick('NAME', 'ADMIN');
}

export function prop(props, ...names) {
  for (const n of names) { const v = props?.[n] ?? props?.[n.toLowerCase()]; if (v !== undefined && v !== null && v !== '' && v !== -99) return v; }
  return null;
}

/** Round every coordinate of a geometry to `d` decimals (shrinks the GeoJSON a lot). */
export function roundGeom(geom, d = 2) {
  const f = 10 ** d;
  const rr = (c) => (typeof c[0] === 'number' ? [Math.round(c[0] * f) / f, Math.round(c[1] * f) / f] : c.map(rr));
  return { type: geom.type, coordinates: rr(geom.coordinates) };
}

/** Parse GeoNames cities*.txt (tab separated) into compact rows. */
export function parseGeonames(text, minPop = 0) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    const pop = +f[14] || 0;
    if (pop < minPop) continue;
    // [geonameid, name, countryCode, lat, lon, population]
    out.push([+f[0], f[1], f[8], +(+f[4]).toFixed(3), +(+f[5]).toFixed(3), pop]);
  }
  return out;
}

/** Parse a WKT "Point(lon lat)" literal from Wikidata. */
export function parsePoint(wkt) {
  const m = /Point\(\s*(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s*\)/.exec(wkt || '');
  return m ? [+m[1], +m[2]] : null;
}

/** Trim a typed array to the [r0, r1] range of non-empty rows and round values. */
export function packRows(arr, r0, r1, digits = 0) {
  const f = 10 ** digits;
  const out = [];
  for (let r = r0; r <= r1; r++) out.push(isNaN(arr[r]) ? null : Math.round(arr[r] * f) / f);
  return out;
}
