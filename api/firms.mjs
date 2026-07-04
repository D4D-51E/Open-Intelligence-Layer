// Live NASA FIRMS thermal hotspots around a set of points — powers the web Claim Verification
// panel's thermal corroboration over the actual claim regions (the static AOI cache doesn't cover
// the Middle East / Ukraine). GET /api/firms?places=lat,lon;lat,lon&days=3 → { ok, thermals }.
// Server-side (NASA_FIRMS_MAP_KEY never reaches the browser). Public data, non-targeting.
import { fetchFirms, bboxAround } from '../db/firms.mjs';

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  // FIRMS NRT refreshes a few times a day; cache hard at the CDN.
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=1800, stale-while-revalidate=7200');
  try {
    if (!process.env.NASA_FIRMS_MAP_KEY) { res.status(200).json({ ok: false, reason: 'no_key', thermals: [] }); return; }
    const days = Math.min(10, Math.max(1, Number.parseInt(String(req.query.days ?? '3'), 10) || 3));
    const bboxes = [];
    const seen = new Set();
    for (const pair of String(req.query.places ?? '').split(';')) {
      const [lat, lon] = pair.split(',').map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      bboxes.push(bboxAround(lat, lon));
      if (bboxes.length >= 12) break;
    }
    if (!bboxes.length) { res.status(200).json({ ok: true, thermals: [] }); return; }
    const thermals = await fetchFirms(bboxes, { dayRange: days });
    res.status(200).json({ ok: true, count: thermals.length, thermals, updated: new Date().toISOString() });
  } catch (error) {
    res.status(200).json({ ok: false, error: String(error), thermals: [] });
  }
}
