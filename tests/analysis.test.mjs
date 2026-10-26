import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanRows, rowOf, packRows, ROWS } from '../scripts/lib.mjs';
import { analyzeBand, prepareRows, bandFor, parseCoords, twins, bandRows, encodeRep, decodeRep, autoRoute } from '../site/js/analysis.js';

// Two synthetic countries: A spans 40–45°N, B spans 42–43°N.
function fakeData() {
  const mk = (rings, pop, gdp, cities) => {
    const { area, minx } = scanRows(rings);
    let r0 = -1, r1 = -1;
    for (let r = 0; r < ROWS; r++) if (area[r] > 0) { if (r0 < 0) r0 = r; r1 = r; }
    const urban = new Float64Array(ROWS);
    for (const c of cities) urban[rowOf(c.lat)] += c.pop;
    return { es: 'x', en: 'x', pop, gdp, r0, area: packRows(area, r0, r1), urban: packRows(urban, r0, r1), minx: packRows(minx, r0, r1, 2) };
  };
  const citiesA = [{ name: 'A1', cc: 'AA', lat: 42.5, lon: 5, pop: 900 }, { name: 'A2', cc: 'AA', lat: 44.5, lon: 5, pop: 100 }];
  const citiesB = [{ name: 'B1', cc: 'BB', lat: 42.4, lon: 55, pop: 500 }];
  const data = prepareRows({
    land: new Array(ROWS).fill(0),
    countries: {
      AA: { ...mk([[[0, 40], [10, 40], [10, 45], [0, 45], [0, 40]]], 1000, 2000, citiesA), es: 'Ae', en: 'Aen' },
      BB: { ...mk([[[50, 42], [60, 42], [60, 43], [50, 43], [50, 42]]], 500, 100, citiesB), es: 'Be', en: 'Ben' },
    },
  });
  return { data, cities: [...citiesA, ...citiesB, { name: 'M', cc: 'MC', lat: 42.7, lon: 30, pop: 10 }] };
}

test('analyzeBand mixes urban and area shares', () => {
  const { data, cities } = fakeData();
  const a = analyzeBand(data, cities, { c: 42.5, w: 0.5 }, 'es');
  const A = a.countries.find((c) => c.key === 'AA');
  const B = a.countries.find((c) => c.key === 'BB');
  // A: 90 % of its city people and ~20 % of its land are in the band.
  assert.ok(A.share > 0.6 && A.share < 0.7, 'A share ' + A.share);
  assert.ok(Math.abs(B.share - 1) < 1e-9, 'B share ' + B.share);
  assert.equal(A.name, 'Ae');
  assert.ok(Math.abs(a.pop - (A.pop + B.pop)) < 1e-6);
  // Countries ordered west to east, microstate from cities included.
  assert.deepEqual(a.countries.map((c) => c.key), ['AA', 'MC', 'BB']);
  assert.equal(a.cities[0].name, 'A1');
});

test('bandRows covers partial rows', () => {
  const rows = bandRows(42.1, 42.3);
  const sum = rows.reduce((s, [, ov]) => s + ov, 0);
  assert.ok(Math.abs(sum * 0.25 - 0.2) < 1e-9);
});

test('bandFor handles both hemispheres', () => {
  assert.deepEqual(bandFor(42.39), { c: 42.5, w: 0.5, label: '42°N' });
  assert.deepEqual(bandFor(-42.88), { c: -42.5, w: 0.5, label: '42°S' });
});

test('parseCoords formats', () => {
  assert.deepEqual(parseCoords('42.39, -8.70'), { lat: 42.39, lon: -8.7 });
  assert.deepEqual(parseCoords('42,39 -8,70'), { lat: 42.39, lon: -8.7 });
  assert.deepEqual(parseCoords('42.39°N 8.70°W'), { lat: 42.39, lon: -8.7 });
  assert.equal(parseCoords('hola'), null);
});

test('twins skips same country and sorts by latitude gap', () => {
  const city = { name: 'Marín', cc: 'ES', lat: 42.39, lon: -8.7, pop: 1 };
  const pool = [city, { name: 'Vigo', cc: 'ES', lat: 42.24, lon: -8.7, pop: 1 }, { name: 'Detroit', cc: 'US', lat: 42.33, lon: -83, pop: 1 }, { name: 'Bishkek', cc: 'KG', lat: 42.87, lon: 74.6, pop: 1 }];
  assert.deepEqual(twins(city, pool).map((t) => t.p.name), ['Detroit', 'Bishkek']);
});

test('share links round-trip', () => {
  const r = { name: 'República del Paralelo 42', c: 42.5, w: 0.5, capital: 'g3117735' };
  assert.deepEqual(decodeRep(encodeRep(r)), r);
  assert.equal(decodeRep('%%%'), null);
});

test('autoRoute picks one city per country west to east', () => {
  const r = autoRoute([{ name: 'a', cc: 'X', lon: 10, pop: 5 }, { name: 'b', cc: 'X', lon: 0, pop: 9 }, { name: 'c', cc: 'Y', lon: -5, pop: 1 }]);
  assert.deepEqual(r.map((p) => p.name), ['c', 'b']);
});
