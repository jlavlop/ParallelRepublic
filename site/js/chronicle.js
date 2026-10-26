// Free automatic chronicle: invented folklore built from real UNESCO
// intangible heritage elements of the countries in the band. No AI involved.

import { rng } from './diversity.js';
import { autoRoute, farTwins } from './analysis.js';

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const fill = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const T = {
  es: {
    suffix: ['ense', 'eño', 'ita', 'ano', 'ino'],
    fallbackRoot: 'paralel',
    motto: [
      'De {w} a {e}, una sola latitud', 'Misma luz, distinta lengua', '{n} países, un solo horizonte',
      'Nadie más al norte, nadie más al sur', 'Todo el mundo a la misma altura', 'Mismo invierno, distintas palabras',
      'Unidos por {deg}', 'La línea no se elige, se celebra',
    ],
    anthem: ['Oda a los {deg}', 'Canto de la línea', 'Marcha de {cap}', 'La vuelta al mundo en {km} kilómetros', 'Himno de los {dems}'],
    p1: [
      'Los {dems} presumen de una cultura cosida de oeste a este. En las fiestas mayores se mezclan {t1} y {t2}, y a nadie le extraña que después llegue {t3}.',
      'Cuentan los {dems} que su folklore nació un verano en que {t1} se encontró con {t2} a mitad de camino. Desde entonces, cada celebración termina con {t3}.',
      'Nada define tanto a los {dems} como su calendario festivo: {t1} abre el año, {t2} marca la mitad y {t3} lo cierra.',
    ],
    p1short: [
      'Los {dems} aún están inventando su folklore. De momento comparten {t1}, que han adoptado como fiesta nacional.',
      'El folklore {dem} todavía está por escribir: lo único seguro es que {t1} no falta en ninguna celebración.',
    ],
    p1none: [
      'El folklore {dem} está por escribir. De momento, lo único que comparten {w} y {e} es la misma altura sobre el ecuador.',
    ],
    capLine: [' En la capital, {cap}, la costumbre manda acabar la noche con {t4}.', ' {cap}, la capital, reclama haber inventado {t4}, aunque nadie lo ha comprobado.'],
    trad: (name, country) => `${name} (${country})`,
    p2: [
      'Su panteón cívico va de {a1} a {a2}, pasando por {a3}. ',
      'En las escuelas se estudia a {a1}, a {a2} y a {a3}: tres vidas que empezaron dentro de la franja. ',
    ],
    p2one: ['Su figura más querida es {a1}. '],
    geo: [
      'La república da la vuelta al mundo en {km} km; el {land} % es tierra firme y el resto, mar que se cruza en barco o a nado, según el carácter de cada uno.',
      'Recorrer la república entera supone {km} km de paralelo, de los que solo el {land} % pisa tierra.',
    ],
    artist: (a) => `${a.name} (${a.what}, ${a.born})`,
    trips: {
      cities: ['Ruta de las grandes ciudades', 'La ciudad más poblada de cada país, de oeste a este.'],
      heritage: ['Ruta del patrimonio vivo', 'Para ver en directo las tradiciones que inspiran el folklore de la república.'],
      twins: ['Los gemelos lejanos', 'Misma latitud, {km} km de distancia.'],
    },
  },
  en: {
    suffix: ['ian', 'ite', 'er', 'ese', 'an'],
    fallbackRoot: 'Parallel',
    motto: [
      'From {w} to {e}, one latitude', 'Same light, many tongues', '{n} countries, one horizon',
      'None further north, none further south', 'The whole world at the same height', 'Same winter, different words',
      'United by {deg}', 'We did not choose the line, we celebrate it',
    ],
    anthem: ['Ode to {deg}', 'Song of the Line', 'March of {cap}', 'Around the World in {km} Kilometres', 'Hymn of the {dems}'],
    p1: [
      'The {dems} boast a culture stitched together from west to east. At the big festivals {t1} mixes with {t2}, and nobody is surprised when {t3} follows.',
      'The {dems} say their folklore was born one summer when {t1} met {t2} halfway. Ever since, every celebration ends with {t3}.',
      'Nothing defines the {dems} like their festive calendar: {t1} opens the year, {t2} marks the middle and {t3} closes it.',
    ],
    p1short: [
      'The {dems} are still inventing their folklore. For now they share {t1}, which they have adopted as a national holiday.',
      '{Dem} folklore is still being written: the only certainty is that {t1} is part of every celebration.',
    ],
    p1none: [
      '{Dem} folklore is still being written. For now, all {w} and {e} share is the same height above the equator.',
    ],
    capLine: [' In the capital, {cap}, custom says the night must end with {t4}.', ' {cap}, the capital, claims to have invented {t4}, though nobody has checked.'],
    trad: (name, country) => `${name} (${country})`,
    p2: [
      'Its civic pantheon runs from {a1} to {a2}, by way of {a3}. ',
      'Schools teach {a1}, {a2} and {a3}: three lives that began inside the band. ',
    ],
    p2one: ['Its best-loved figure is {a1}. '],
    geo: [
      'The republic goes around the world in {km} km; {land} % of it is dry land and the rest is sea, crossed by boat or swimming depending on temperament.',
      'Travelling the whole republic means {km} km of parallel, only {land} % of it on land.',
    ],
    artist: (a) => `${a.name} (${a.what}, ${a.born})`,
    trips: {
      cities: ['Route of the great cities', 'The largest city of each country, west to east.'],
      heritage: ['Living heritage route', 'To see in person the traditions behind the republic\'s folklore.'],
      twins: ['The distant twins', 'Same latitude, {km} km apart.'],
    },
  },
};

/** Demonym from the capital or the biggest city: Marín → marinense / Marinian. */
export function demonymOf(base, lang, rnd) {
  const L = T[lang];
  let root = String(base || '').split(/[\s,(/-]/)[0].normalize('NFC');
  root = root.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z]/g, '');
  root = root.replace(/[aeiouAEIOU]+$/, '');
  if (root.length < 3) root = L.fallbackRoot;
  const suf = pick(rnd, L.suffix);
  const word = lang === 'es' ? root.toLowerCase() + suf : cap1(root.toLowerCase()) + suf;
  return { one: word, many: word + 's' };
}

/**
 * @param o {rep, a (analysis), cap, traditions {cc:[[es,en,id]]}, artists (diverse selection, with display fields name/what/born),
 *           lang, seed, cname(cc), fmtInt(n), degLabel}
 */
export function autoChronicle(o) {
  const { rep, a, cap, traditions = {}, artists = [], lang, seed = 1, cname = (c) => c, fmtInt = String, degLabel } = o;
  const L = T[lang];
  const rnd = rng(seed);
  const cities = a.cities || [];
  const biggest = cities[0];
  const dem = demonymOf(cap ? cap.name : biggest ? biggest.name : rep.name.split(' ').pop(), lang, rnd);
  const west = cities.length ? cities.reduce((m, p) => (p.lon < m.lon ? p : m)) : null;
  const east = cities.length ? cities.reduce((m, p) => (p.lon > m.lon ? p : m)) : null;
  const v = {
    w: west ? west.name : '—', e: east ? east.name : '—', n: a.countries.length, deg: degLabel,
    cap: cap ? cap.name : (biggest ? biggest.name : rep.name), km: fmtInt(a.km), land: a.land == null ? '—' : Math.round(a.land * 100),
    dem: dem.one, Dem: cap1(dem.one), dems: dem.many,
  };

  // One tradition per country, preferring countries with more people in the band, shuffled a little.
  const order = a.countries.filter((c) => traditions[c.key]?.length)
    .map((c) => ({ c, s: (c.pop || 0) * (0.5 + rnd()) })).sort((x, y) => y.s - x.s).map((x) => x.c);
  const picked = order.slice(0, 4).map((c) => {
    const list = traditions[c.key];
    const tr = list[Math.floor(rnd() * list.length)];
    return { cc: c.key, country: c.name, name: lang === 'es' ? tr[0] : tr[1], id: tr[2] };
  });
  const td = picked.map((p) => L.trad(p.name, p.country));
  [v.t1, v.t2, v.t3, v.t4] = td;

  let p1;
  if (td.length >= 3) p1 = fill(pick(rnd, L.p1), v) + (cap && td[3] ? fill(pick(rnd, L.capLine), v) : '');
  else if (td.length >= 1) p1 = fill(pick(rnd, L.p1short), v);
  else p1 = fill(pick(rnd, L.p1none), v);

  const ar = artists.slice(0, 3).map(L.artist);
  let p2 = '';
  if (ar.length >= 3) p2 = fill(pick(rnd, L.p2), { a1: ar[0], a2: ar[1], a3: ar[2] });
  else if (ar.length) p2 = fill(pick(rnd, L.p2one), { a1: ar[0] });
  p2 += fill(pick(rnd, L.geo), v);

  const trips = [];
  const route = autoRoute(cities, 5);
  if (route.length >= 2) trips.push({ title: L.trips.cities[0], stops: route.map((p) => p.name), why: L.trips.cities[1] });
  if (picked.length >= 2) {
    const stops = picked.slice().sort((x, y) => {
      const cx = a.countries.find((c) => c.key === x.cc), cy = a.countries.find((c) => c.key === y.cc);
      return (cx?.x ?? 0) - (cy?.x ?? 0);
    }).map((p) => `${p.country} (${p.name})`);
    trips.push({ title: L.trips.heritage[0], stops, why: L.trips.heritage[1] });
  }
  const far = farTwins(cities);
  if (far) trips.push({ title: L.trips.twins[0], stops: [far.a.name, far.b.name], why: fill(L.trips.twins[1], { km: fmtInt(far.km) }) });

  return {
    auto: true,
    demonym: dem.one,
    motto: fill(pick(rnd, L.motto), v),
    anthem: fill(pick(rnd, L.anthem), v),
    folklore: p1 + '\n\n' + p2,
    traditions: picked,
    trips,
  };
}
