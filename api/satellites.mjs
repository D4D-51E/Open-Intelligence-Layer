// Satellite orbital elements — public Celestrak GP catalog (no API key). Returns TLE triplets
// {name, l1, l2, norad} for a named group; the client propagates them with SGP4 (satellite.js)
// to live sub-point positions. TLEs update ~daily, so cache hard at the CDN. Public data.
const CELESTRAK = 'https://celestrak.org/NORAD/elements/gp.php';

// Allowlist of Celestrak groups we expose (avoids proxying arbitrary upstream paths). 'active'
// is the full active catalogue (~11k objects, includes Starlink) — the default bulk view.
const GROUPS = new Set([
  'active', 'starlink', 'stations', 'visual', 'weather', 'science', 'geo',
  'gps-ops', 'glo-ops', 'galileo', 'beidou', 'oneweb', 'cubesat', 'last-30-days',
]);

function parseTle(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+$/, ''));
  const out = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const name = lines[i];
    const l1 = lines[i + 1];
    const l2 = lines[i + 2];
    if (!name || !l1 || !l2 || !l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    out.push({ name: name.trim(), l1, l2, norad: l1.slice(2, 7).trim() });
  }
  return out;
}

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  // TLEs refresh roughly daily; cache aggressively but allow stale-while-revalidate.
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=21600');
  try {
    const group = GROUPS.has(String(req.query.group)) ? String(req.query.group) : 'active';
    const url = new URL(CELESTRAK);
    url.searchParams.set('GROUP', group);
    url.searchParams.set('FORMAT', 'tle');

    const upstream = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { accept: 'text/plain', 'user-agent': 'AirMaven/0.1 (orbital-awareness)' },
    });
    if (!upstream.ok) { res.status(200).json({ ok: false, reason: `Celestrak ${upstream.status}`, group, satellites: [] }); return; }
    const text = await upstream.text();
    const satellites = parseTle(text);
    res.status(200).json({ ok: true, group, count: satellites.length, satellites, updated: new Date().toISOString() });
  } catch (error) {
    res.status(200).json({ ok: false, error: String(error), satellites: [] });
  }
}
