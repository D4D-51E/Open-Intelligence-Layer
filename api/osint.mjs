// OSINT feed query API: reads collected GDELT + RSS items from Neon by time range/region/tier.
// GET /api/osint?from=ISO&to=ISO&region=taiwan-strait&tier=authoritative&limit=500
import { getSql } from '../db/client.mjs';

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 'no-store');
  try {
    const sql = getSql();
    const region = String(req.query.region ?? '').trim();
    const tier = String(req.query.tier ?? '').trim();
    const limit = Math.min(2000, Math.max(1, Number.parseInt(String(req.query.limit ?? '500'), 10) || 500));
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 24 * 3600 * 1000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.status(400).json({ ok: false, error: 'invalid from/to' });
      return;
    }
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    let rows;
    if (region && tier) {
      rows = await sql`SELECT observed_at, region_id, source, tier, title, url, summary, lat, lon FROM osint_items WHERE region_id = ${region} AND tier = ${tier} AND observed_at BETWEEN ${fromIso} AND ${toIso} ORDER BY observed_at DESC LIMIT ${limit}`;
    } else if (region) {
      rows = await sql`SELECT observed_at, region_id, source, tier, title, url, summary, lat, lon FROM osint_items WHERE region_id = ${region} AND observed_at BETWEEN ${fromIso} AND ${toIso} ORDER BY observed_at DESC LIMIT ${limit}`;
    } else if (tier) {
      rows = await sql`SELECT observed_at, region_id, source, tier, title, url, summary, lat, lon FROM osint_items WHERE tier = ${tier} AND observed_at BETWEEN ${fromIso} AND ${toIso} ORDER BY observed_at DESC LIMIT ${limit}`;
    } else {
      rows = await sql`SELECT observed_at, region_id, source, tier, title, url, summary, lat, lon FROM osint_items WHERE observed_at BETWEEN ${fromIso} AND ${toIso} ORDER BY observed_at DESC LIMIT ${limit}`;
    }

    res.status(200).json({ ok: true, count: rows.length, rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
}
