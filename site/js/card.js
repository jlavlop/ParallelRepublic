// Procedural flag and the collectible card (drawn on a canvas, saved as PNG).

const TINCT = ['#c8102e', '#0b3d91', '#f4f1e8', '#00843d', '#f2c200', '#1b1b1b', '#5b2a86', '#e35205', '#007c89'];

export function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; }; }

export function flagSpec(r) {
  const rnd = rng(hash(r.id + '|' + Math.round(r.c * 100)));
  const n = 3 + Math.floor(rnd() * 3);
  const st = [];
  for (let i = 0; i < n; i++) { let c; do { c = TINCT[Math.floor(rnd() * TINCT.length)]; } while (st.length && c === st[st.length - 1]); st.push(c); }
  // The coloured line sits where the central parallel falls inside its whole degree.
  const frac = ((r.c % 1) + 1) % 1 || 0.5;
  return { st, pos: Math.max(0.12, Math.min(0.88, 1 - frac)), star: rnd() < 0.6, emb: TINCT[Math.floor(rnd() * TINCT.length)] };
}

export function drawFlag(g, x, y, w, h, r) {
  const f = flagSpec(r), sh = h / f.st.length;
  f.st.forEach((c, i) => { g.fillStyle = c; g.fillRect(x, y + i * sh, w, Math.ceil(sh)); });
  const ly = y + h * f.pos;
  g.fillStyle = r.color; g.fillRect(x, ly - h * 0.035, w, h * 0.07);
  g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(x, ly - h * 0.035 - 1, w, 1); g.fillRect(x, ly + h * 0.035, w, 1);
  const cx = x + h * 0.5, cy = y + h * 0.5, R = h * 0.26;
  g.beginPath(); g.arc(cx, cy, R * 1.12, 0, 7);
  g.fillStyle = f.emb === f.st[Math.floor(f.st.length / 2)] ? '#f4f1e8' : f.emb; g.fill();
  g.fillStyle = r.color; g.beginPath();
  const pts = f.star ? 5 : 8;
  for (let i = 0; i < pts * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / pts, rr = i % 2 ? R * (f.star ? 0.42 : 0.5) : R; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
  g.closePath(); g.fill();
}

function starPath(g, x, y, ro, ri) { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? ri : ro; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); }

function wrapLines(g, text, maxW, maxLines) {
  const words = String(text).split(/\s+/), lines = [];
  let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] += '…'; }
  return lines;
}

/**
 * @param c   canvas (1080×1350)
 * @param o   {rep, a (analysis), gen, cap (city|null), countries (GeoJSON), t, fmt:{compact, usd, int}, rangeTxt, capName}
 */
export function drawCard(c, o) {
  const { rep: r, a, gen, cap, t } = o;
  const k = c.getContext('2d'), W = 1080, H = 1350, M = 72;
  k.textBaseline = 'top'; k.textAlign = 'left';
  k.fillStyle = '#10202a'; k.fillRect(0, 0, W, H);
  k.fillStyle = r.color; k.fillRect(0, 0, W, 10);
  k.fillStyle = '#8fa6b0'; k.font = '500 24px "JetBrains Mono", monospace';
  k.fillText(t('card_kicker') + ' · Nº ' + String(hash(r.id) % 10000).padStart(4, '0'), M, M - 14);
  k.textAlign = 'right'; k.fillText(o.rangeTxt, W - M, M - 14); k.textAlign = 'left';
  drawFlag(k, M, M + 34, W - 2 * M, 300, r);
  k.strokeStyle = 'rgba(255,255,255,.18)'; k.lineWidth = 2; k.strokeRect(M, M + 34, W - 2 * M, 300);

  let y = M + 374;
  k.fillStyle = '#f1f5f6'; k.font = '800 72px "Bricolage Grotesque", system-ui, sans-serif';
  for (const l of wrapLines(k, r.name, W - 2 * M, 2)) { k.fillText(l, M, y); y += 78; }
  if (gen && gen.motto) { k.fillStyle = r.color; k.font = 'italic 500 34px Figtree, system-ui, sans-serif'; k.fillText('«' + gen.motto + '»', M, y + 4); y += 56; } else y += 12;

  // Mini world map, equirectangular, 84°N to 60°S.
  const mx = M, my = y + 10, mw = W - 2 * M, mh = mw / 2 * 0.8, lat0 = 84, lat1 = -60;
  const sx = mw / 360, sy = mh / (lat0 - lat1);
  const px = (lon) => mx + (lon + 180) * sx, py = (lat) => my + (lat0 - lat) * sy;
  k.save(); k.beginPath(); k.rect(mx, my, mw, mh); k.clip();
  k.fillStyle = '#183039'; k.fillRect(mx, my, mw, mh);
  if (o.countries) {
    k.beginPath();
    for (const f of o.countries.features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const poly of polys) for (const ring of poly) { ring.forEach((p, i) => (i ? k.lineTo(px(p[0]), py(p[1])) : k.moveTo(px(p[0]), py(p[1])))); k.closePath(); }
    }
    k.fillStyle = '#3a4f57'; k.fill('evenodd');
  }
  const b0 = py(r.c + r.w), b1 = py(r.c - r.w);
  k.fillStyle = r.color + '55'; k.fillRect(mx, b0, mw, Math.max(2, b1 - b0));
  k.fillStyle = r.color; k.fillRect(mx, py(r.c) - 1.5, mw, 3);
  if (cap) { k.fillStyle = '#fff'; starPath(k, px(cap.lon), py(cap.lat), 14, 6); k.fill(); }
  k.restore();
  y = my + mh + 34;

  const cells = [
    [t('card_pop'), o.fmt.compact(a.pop)], [t('card_gdp'), o.fmt.usd(a.gdp)], [t('card_area'), o.fmt.compact(a.area) + ' km²'],
    [t('card_circ'), o.fmt.int(a.km) + ' km'], [t('card_countries'), String(a.countries.length)], [t('card_cap'), cap ? o.capName : '—'],
  ];
  const cwid = (W - 2 * M) / 3;
  cells.forEach((cl, i) => {
    const cx = M + (i % 3) * cwid, cy = y + Math.floor(i / 3) * 110;
    k.fillStyle = '#8fa6b0'; k.font = '600 22px Figtree, system-ui, sans-serif'; k.fillText(cl[0].toUpperCase(), cx, cy);
    k.fillStyle = '#f1f5f6'; k.font = '700 44px "Bricolage Grotesque", system-ui, sans-serif';
    let v = cl[1]; while (k.measureText(v).width > cwid - 20 && v.length > 3) v = v.slice(0, -2) + '…';
    k.fillText(v, cx, cy + 30);
  });
  y += 230;
  k.fillStyle = '#b8c7cd'; k.font = '500 24px Figtree, system-ui, sans-serif';
  for (const l of wrapLines(k, a.countries.map((x) => x.name).join(' → '), W - 2 * M, 2)) { if (y < H - 90) { k.fillText(l, M, y); y += 34; } }
  k.fillStyle = '#5f7680'; k.font = '500 20px "JetBrains Mono", monospace';
  k.fillText('Repúblicas Paralelas' + (gen && gen.demonym ? ' · ' + gen.demonym : ''), M, H - M + 10);
}
