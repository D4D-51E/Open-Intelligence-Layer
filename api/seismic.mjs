// EMSC seismic OSINT — public seismicportal.eu FDSN event feed (no API key). Returns recent
// events in the viewport bbox with an `explosionLike` flag: near-surface events (depth ≤ 2 km)
// read as possible explosions/strikes rather than deep tectonic quakes (EMSC tags almost
// everything 'ke', so depth is the only reliable discriminator). Public data, non-targeting.
const EMSC = 'https://www.seismicportal.eu/fdsnws/event/1/query';
const EXPLOSION_MAX_DEPTH_KM = 2;

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=120, stale-while-revalidate=300');
  try {
    const parts = String(req.query.bbox ?? '').split(',').map(Number);
    const bbox = parts.length === 4 && parts.every(Number.isFinite) ? parts : [-180, -90, 180, 90];
    const [minLon, minLat, maxLon, maxLat] = bbox;
    const hours = Math.min(168, Math.max(1, Number.parseInt(String(req.query.hours ?? '24'), 10) || 24));
    const start = new Date(Date.now() - hours * 3600 * 1000).toISOString();
    const url = new URL(EMSC);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '300');
    url.searchParams.set('orderby', 'time');
    url.searchParams.set('start', start);
    url.searchParams.set('minlat', String(minLat));
    url.searchParams.set('maxlat', String(maxLat));
    url.searchParams.set('minlon', String(minLon));
    url.searchParams.set('maxlon', String(maxLon));

    const upstream = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { accept: 'application/json', 'user-agent': 'AirMaven/0.1' } });
    if (!upstream.ok) { res.status(200).json({ ok: false, reason: `EMSC ${upstream.status}`, events: [] }); return; }
    const json = await upstream.json();
    const events = (json.features ?? []).map((f) => {
      const p = f.properties ?? {};
      const [lon, lat] = f.geometry?.coordinates ?? [];
      const depthKm = p.depth == null ? null : Number(p.depth);
      const mag = p.mag == null ? null : Number(p.mag);
      return {
        id: String(f.id ?? p.unid ?? `${p.time}-${lat}-${lon}`),
        lat: Number(lat),
        lon: Number(lon),
        mag,
        magType: p.magtype ?? null,
        depthKm,
        region: p.flynn_region ?? p.region ?? '',
        time: p.time ?? null,
        evtype: p.evtype ?? null,
        explosionLike: depthKm != null && depthKm <= EXPLOSION_MAX_DEPTH_KM,
      };
    }).filter((e) => Number.isFinite(e.lat) && Number.isFinite(e.lon));

    res.status(200).json({ ok: true, events, updated: new Date().toISOString() });
  } catch (error) {
    res.status(200).json({ ok: false, error: String(error), events: [] });
  }
}
