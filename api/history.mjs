// Timeline query API: reads recorded observations from Neon by region + time range.
// GET /api/history?region=seoul-airspace&kind=tracks&from=ISO&to=ISO&military=1&limit=2000
import { getSql } from '../db/client.mjs';

const REGIONS = new Set(['taiwan-strait', 'seoul-airspace', 'south-china-sea', 'west-sea-nll']);

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 'no-store');
  try {
    const sql = getSql();
    const region = String(req.query.region ?? '').trim();
    const kind = String(req.query.kind ?? 'tracks').trim();
    const militaryOnly = String(req.query.military ?? '') === '1';
    const limit = Math.min(5000, Math.max(1, Number.parseInt(String(req.query.limit ?? '2000'), 10) || 2000));
    const from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 6 * 3600 * 1000);
    const to = req.query.to ? new Date(String(req.query.to)) : new Date();
    if (region && !REGIONS.has(region)) {
      res.status(400).json({ ok: false, error: 'invalid region' });
      return;
    }
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      res.status(400).json({ ok: false, error: 'invalid from/to' });
      return;
    }
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    // Optional bounding box (minLon,minLat,maxLon,maxLat) for the viewport vessel layer.
    const bboxParts = String(req.query.bbox ?? '').split(',').map((v) => Number(v));
    const bbox = bboxParts.length === 4 && bboxParts.every((v) => Number.isFinite(v)) ? bboxParts : null;

    let rows;
    if (kind === 'vessels') {
      const [minLon, minLat, maxLon, maxLat] = bbox ?? [-180, -90, 180, 90];
      rows = region
        ? await sql`SELECT observed_at, region_id, mmsi, name, vessel_type, lat, lon, sog_knots, cog_deg FROM vessel_observations WHERE region_id = ${region} AND observed_at BETWEEN ${fromIso} AND ${toIso} AND lat BETWEEN ${minLat} AND ${maxLat} AND lon BETWEEN ${minLon} AND ${maxLon} ORDER BY observed_at DESC LIMIT ${limit}`
        : await sql`SELECT observed_at, region_id, mmsi, name, vessel_type, lat, lon, sog_knots, cog_deg FROM vessel_observations WHERE observed_at BETWEEN ${fromIso} AND ${toIso} AND lat BETWEEN ${minLat} AND ${maxLat} AND lon BETWEEN ${minLon} AND ${maxLon} ORDER BY observed_at DESC LIMIT ${limit}`;
      res.status(200).json({ ok: true, kind: 'vessels', region: region || null, from: fromIso, to: toIso, count: rows.length, rows });
      return;
    }
    if (kind === 'weather') {
      rows = region
        ? await sql`SELECT observed_at, region_id, temperature_c, wind_gust_kmh, visibility_m, cloud_pct, precip_mm FROM weather_observations WHERE region_id = ${region} AND observed_at BETWEEN ${fromIso} AND ${toIso} ORDER BY observed_at DESC LIMIT ${limit}`
        : await sql`SELECT observed_at, region_id, temperature_c, wind_gust_kmh, visibility_m, cloud_pct, precip_mm FROM weather_observations WHERE observed_at BETWEEN ${fromIso} AND ${toIso} ORDER BY observed_at DESC LIMIT ${limit}`;
    } else if (region && militaryOnly) {
      rows = await sql`SELECT observed_at, region_id, icao24, callsign, lat, lon, altitude_m, velocity_ms, heading_deg, is_military, type_code FROM track_observations WHERE region_id = ${region} AND is_military AND observed_at BETWEEN ${fromIso} AND ${toIso} ORDER BY observed_at DESC LIMIT ${limit}`;
    } else if (region) {
      rows = await sql`SELECT observed_at, region_id, icao24, callsign, lat, lon, altitude_m, velocity_ms, heading_deg, is_military, type_code FROM track_observations WHERE region_id = ${region} AND observed_at BETWEEN ${fromIso} AND ${toIso} ORDER BY observed_at DESC LIMIT ${limit}`;
    } else if (militaryOnly) {
      rows = await sql`SELECT observed_at, region_id, icao24, callsign, lat, lon, altitude_m, velocity_ms, heading_deg, is_military, type_code FROM track_observations WHERE is_military AND observed_at BETWEEN ${fromIso} AND ${toIso} ORDER BY observed_at DESC LIMIT ${limit}`;
    } else {
      rows = await sql`SELECT observed_at, region_id, icao24, callsign, lat, lon, altitude_m, velocity_ms, heading_deg, is_military, type_code FROM track_observations WHERE observed_at BETWEEN ${fromIso} AND ${toIso} ORDER BY observed_at DESC LIMIT ${limit}`;
    }

    res.status(200).json({ ok: true, kind: kind === 'weather' ? 'weather' : 'tracks', region: region || null, from: fromIso, to: toIso, count: rows.length, rows });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
}
