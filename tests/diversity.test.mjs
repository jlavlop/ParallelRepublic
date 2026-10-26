import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectDiverse, composition, rarity } from '../site/js/diversity.js';
import { autoChronicle, demonymOf } from '../site/js/chronicle.js';
import { rng } from '../site/js/diversity.js';

// 40 famous men from one country, a few women and people from rarer countries.
function pool() {
  const out = [];
  for (let i = 0; i < 40; i++) out.push({ id: 'm' + i, l: 200 - i, g: 'm', cc: 'US', o: ['writer'] });
  for (let i = 0; i < 6; i++) out.push({ id: 'w' + i, l: 30 - i, g: 'f', cc: ['KG', 'ES', 'US', 'BG', 'JP', 'ES'][i], o: [['poet', 'painter', 'singer', 'architect', 'ceramicist', 'dancer'][i]] });
  for (let i = 0; i < 6; i++) out.push({ id: 'p' + i, l: 12 + i, g: 'm', cc: ['MN', 'AL', 'GE', 'KZ', 'ME', 'AD'][i], o: ['musician'] });
  return out;
}
const counts = { US: 3000, ES: 400, JP: 500, KG: 4, BG: 30, MN: 5, AL: 8, GE: 20, KZ: 15, ME: 3, AD: 1 };

test('selectDiverse meets the women quota and spreads countries', () => {
  const sel = selectDiverse(pool(), 12, { seed: 7, countryCounts: counts });
  const c = composition(sel);
  assert.equal(sel.length, 12);
  assert.ok(c.women >= 5, 'women ' + c.women);
  assert.ok(sel.filter((a) => a.cc === 'US').length <= 2, 'US capped');
  assert.ok(c.countries >= 8, 'countries ' + c.countries);
  assert.equal(c.discover, 6);
  // Still includes some of the most famous.
  assert.ok(sel.some((a) => a.l >= 190));
});

test('selectDiverse is stable for a seed and changes with another', () => {
  const a = selectDiverse(pool(), 12, { seed: 3, countryCounts: counts }).map((x) => x.id);
  const b = selectDiverse(pool(), 12, { seed: 3, countryCounts: counts }).map((x) => x.id);
  const c = selectDiverse(pool(), 12, { seed: 4, countryCounts: counts }).map((x) => x.id);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('selectDiverse copes with small or men-only pools', () => {
  assert.equal(selectDiverse([], 5).length, 0);
  const men = [{ id: 'a', l: 5, g: 'm', cc: 'X', o: [] }, { id: 'b', l: 3, g: '', cc: 'X', o: [] }];
  assert.equal(selectDiverse(men, 12).length, 2);
});

test('rarity favours rare countries', () => {
  assert.ok(rarity('KG', counts) > rarity('US', counts) * 3);
});

test('demonymOf builds words in both languages', () => {
  assert.match(demonymOf('Marín', 'es', rng(1)).one, /^mar[ií]n/);
  assert.match(demonymOf('Detroit', 'en', rng(1)).one, /^Detroit/);
  assert.match(demonymOf('Xi', 'es', rng(1)).one, /^paralel/);
});

test('autoChronicle uses real traditions and stays bilingual', () => {
  const a = {
    km: 29546, land: 0.42, pop: 4e7, gdp: 1e12,
    countries: [{ key: 'ES', name: 'España', x: -9, pop: 9e6 }, { key: 'US', name: 'Estados Unidos', x: -124, pop: 2e7 }, { key: 'KG', name: 'Kirguistán', x: 70, pop: 2e6 }, { key: 'JP', name: 'Japón', x: 140, pop: 3e6 }],
    cities: [{ name: 'Detroit', cc: 'US', lon: -83, lat: 42.3, pop: 6e5 }, { name: 'Vigo', cc: 'ES', lon: -8.7, lat: 42.2, pop: 3e5 }, { name: 'Bishkek', cc: 'KG', lon: 74.6, lat: 42.9, pop: 1e6 }, { name: 'Sapporo', cc: 'JP', lon: 141, lat: 43, pop: 2e6 }],
  };
  const traditions = { ES: [['Castells', 'Castells', 'Q1']], US: [['Hula', 'Hula', 'Q2']], KG: [['Manas', 'Manas', 'Q3']], JP: [['Washi', 'Washi', 'Q4']] };
  const artists = [{ name: 'Rosalía de Castro', what: 'poesía', born: 'Santiago' }, { name: 'Diana Ross', what: 'canto', born: 'Detroit' }, { name: 'Christo', what: 'artista', born: 'Gabrovo' }];
  const rep = { id: 'r1', name: 'República del Paralelo 42', c: 42.5, w: 0.5 };
  for (const lang of ['es', 'en']) {
    const ch = autoChronicle({ rep, a, cap: { name: 'Marín' }, traditions, artists, lang, seed: 5, fmtInt: String, degLabel: '42°N' });
    assert.ok(ch.motto && ch.anthem && ch.demonym);
    assert.equal(ch.traditions.length, 4);
    assert.ok(ch.traditions.some((t) => ch.folklore.includes(t.name)), 'folklore names a tradition');
    assert.ok(ch.folklore.includes('Rosalía de Castro'));
    assert.ok(!/\{\w+\}/.test(ch.folklore + ch.motto + ch.anthem), 'no unfilled placeholders: ' + ch.folklore);
    assert.ok(ch.trips.length >= 2);
  }
  const none = autoChronicle({ rep, a: { ...a, countries: [], cities: [] }, cap: null, traditions: {}, artists: [], lang: 'es', seed: 1, fmtInt: String, degLabel: '42°N' });
  assert.ok(none.folklore.length > 20 && !/\{\w+\}/.test(none.folklore));
});
