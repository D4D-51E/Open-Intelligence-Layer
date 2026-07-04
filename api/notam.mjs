// NOTAM query API: reads collected FAA NOTAMs from Neon within a bounding box.
// GET /api/notam?bbox=minLon,minLat,maxLon,maxLat&limit=500
import { getSql } from '../db/client.mjs';

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 'no-store');
  try {
    const sql = getSql();
    const limit = Math.min(2000, Math.max(1, Number.parseInt(String(req.query.limit ?? '500'), 10) || 500));
    const bboxParam = req.query.bbox ? String(req.query.bbox).split(',').map(Number) : null;
    const bbox = bboxParam && bboxParam.length === 4 && bboxParam.every(Number.isFinite) ? bboxParam : null;
    if (req.query.bbox && !bbox) {
      res.status(400).json({ ok: false, error: 'invalid bbox' });
      return;
    }

    const rows = bbox
      ? await sql`
          SELECT observed_at, icao, notam_number, feature, lat, lon, radius_km, fl_min, fl_max, start_at, end_at
          FROM notam_notices
          WHERE lat IS NOT NULL AND lon IS NOT NULL
            AND lon BETWEEN ${bbox[0]} AND ${bbox[2]}
            AND lat BETWEEN ${bbox[1]} AND ${bbox[3]}
          ORDER BY observed_at DESC LIMIT ${limit}
        `
      : await sql`
          SELECT observed_at, icao, notam_number, feature, lat, lon, radius_km, fl_min, fl_max, start_at, end_at
          FROM notam_notices
          WHERE lat IS NOT NULL AND lon IS NOT NULL
          ORDER BY observed_at DESC LIMIT ${limit}
        `;

    res.status(200).json({ ok: true, count: rows.length, rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
}
