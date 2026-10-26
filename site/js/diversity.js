// Picks a varied list of people: a minimum share of women, many countries,
// many disciplines, and half of the slots for lesser-known figures.
// Pure functions, used by the page and by the data build.

export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

export const isWoman = (a) => a.g === 'f';

/** How rare a country is in the whole dataset: ~0.15 for the most common, up to 1 for the rarest. */
export function rarity(cc, counts) {
  const n = counts?.[cc] ?? 0;
  return Math.min(1, 1.6 / Math.log2(3 + n));
}

/**
 * @param cands   [{id, l (sitelinks), g ('f'|'m'|'x'|''), cc, o: [occupations]}]
 * @param n       how many to return
 * @param opts    {seed, womenMin, discoverShare, maxPerCountry, maxPerOcc, countryCounts}
 * @returns       the chosen items, each with `disc: true` when picked for a "discover" slot
 */
export function selectDiverse(cands, n, opts = {}) {
  const {
    seed = 1, womenMin = 0.4, discoverShare = 0.5,
    maxPerCountry = 2, maxPerOcc = 3, countryCounts = {},
  } = opts;
  if (!cands.length || n <= 0) return [];
  const rnd = rng(seed);
  const byFame = [...cands].sort((a, b) => b.l - a.l);
  const den = Math.max(1, byFame.length - 1);
  const rank = new Map(byFame.map((c, i) => [c, i / den])); // 0 = most famous
  const target = Math.min(n, cands.length);
  const womenTarget = Math.min(Math.ceil(target * womenMin), cands.filter(isWoman).length);
  const discTarget = Math.round(target * discoverShare);

  const pool = new Set(cands);
  const byC = {}, byO = {};
  const out = [];
  let women = 0, disc = 0;

  while (out.length < target && pool.size) {
    const left = target - out.length;
    const mustWoman = womenTarget - women >= left;
    // Alternate famous and discover slots until the discover quota is met.
    const discoverSlot = disc < discTarget && (out.length % 2 === 1 || discTarget - disc >= left);
    let eligible = [...pool];
    if (mustWoman) { const w = eligible.filter(isWoman); if (w.length) eligible = w; }
    const roomy = eligible.filter((c) => (byC[c.cc] || 0) < maxPerCountry);
    if (roomy.length) eligible = roomy;

    let best = null, bestScore = -Infinity;
    for (const c of eligible) {
      const r = rank.get(c), rar = rarity(c.cc, countryCounts);
      let s = discoverSlot ? 0.7 * r + 0.8 * rar : (1 - r) + 0.25 * rar;
      if (isWoman(c) && women < (out.length + 1) * womenMin) s += 0.6;
      if (!byC[c.cc]) s += 0.3; else s -= 0.4 * byC[c.cc];
      const occs = c.o?.length ? c.o : ['?'];
      if (occs.some((o) => !byO[o])) s += 0.2;
      if (occs.every((o) => (byO[o] || 0) >= maxPerOcc)) s -= 0.7;
      s += rnd() * 0.35;
      if (s > bestScore) { bestScore = s; best = c; }
    }
    pool.delete(best);
    out.push({ ...best, disc: discoverSlot });
    if (isWoman(best)) women++;
    if (discoverSlot) disc++;
    byC[best.cc] = (byC[best.cc] || 0) + 1;
    for (const o of best.o || []) byO[o] = (byO[o] || 0) + 1;
  }
  return out;
}

/** Composition summary for the note under the list. */
export function composition(list) {
  return {
    women: list.filter(isWoman).length,
    countries: new Set(list.map((a) => a.cc).filter(Boolean)).size,
    discover: list.filter((a) => a.disc).length,
    total: list.length,
  };
}
