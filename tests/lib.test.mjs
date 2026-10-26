import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanRows, rowOf, countryKey, parseGeonames, parsePoint, packRows, roundGeom, ROWS } from '../scripts/lib.mjs';

test('scanRows measures a 10°×5° box', () => {
  const box = [[[0, 40], [10, 40], [10, 45], [0, 45], [0, 40]]];
  const { len, area, minx } = scanRows(box);
  const r = rowOf(42.6);
  assert.equal(len[r], 10);
  assert.equal(minx[r], 0);
  const total = area.reduce((a, b) => a + b, 0);
  const expected = 10 * 111.32 * Math.cos(42.5 * Math.PI / 180) * 5 * 110.95;
  assert.ok(Math.abs(total - expected) / expected < 0.01, `area ${total} vs ${expected}`);
  assert.equal(len[rowOf(46)], 0);
});

test('scanRows applies even-odd holes', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[2, 2], [4, 2], [4, 8], [2, 8], [2, 2]];
  const { len } = scanRows([outer, hole]);
  assert.equal(len[rowOf(5)], 8);
});

test('rowOf clamps to range', () => {
  assert.equal(rowOf(-90), 0);
  assert.equal(rowOf(90), ROWS - 1);
});

test('countryKey prefers usable ISO codes', () => {
  assert.equal(countryKey({ ISO_A2: '-99', ISO_A2_EH: 'FR', ADM0_A3: 'FRA' }), 'FR');
  assert.equal(countryKey({ ISO_A2: '-99', ISO_A2_EH: '-99', ADM0_A3: 'CYN' }), 'CYN');
  assert.equal(countryKey({ iso_a2: 'ES' }), 'ES');
});

test('parseGeonames keeps the needed columns', () => {
  const line = ['3117735', 'Madrid', 'Madrid', 'alt', '40.4168', '-3.70256', 'P', 'PPLC', 'ES', '', '29', 'M', '', '', '3255944', '', '667', 'Europe/Madrid', '2024-01-01'].join('\t');
  assert.deepEqual(parseGeonames(line + '\n'), [[3117735, 'Madrid', 'ES', 40.417, -3.703, 3255944]]);
  assert.deepEqual(parseGeonames(line, 5e6), []);
});

test('parsePoint reads Wikidata WKT', () => {
  assert.deepEqual(parsePoint('Point(-8.54 42.88)'), [-8.54, 42.88]);
  assert.equal(parsePoint('nope'), null);
});

test('packRows trims and rounds', () => {
  const a = new Float64Array([1.234, NaN, 3.9]);
  assert.deepEqual(packRows(a, 0, 2, 1), [1.2, null, 3.9]);
});

test('roundGeom rounds nested coordinates', () => {
  const g = roundGeom({ type: 'MultiPolygon', coordinates: [[[[1.23456, 2.34567], [3, 4]]]] }, 2);
  assert.deepEqual(g.coordinates, [[[[1.23, 2.35], [3, 4]]]]);
});
