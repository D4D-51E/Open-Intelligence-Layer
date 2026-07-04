// Shared name lookup — resolves a specific vessel/aircraft mentioned in a free-text query against
// the DB, so "이 선박 알려줘 INSUNG NO.1" resolves even when the target is outside the current
// viewport sample. Used by BOTH the Telegram bot (/ai) and the web AI copilot so they behave
// identically. ILIKE ALL = the name/callsign must contain every distinctive token (precise).

const STOP = new Set(['the', 'and', 'ship', 'vessel', 'about', 'tell', 'show', 'this', 'that', 'info', 'give', 'what', 'where', 'status', '선박', '항적', '항공기', '알려줘']);

export function nameTerms(query) {
  return [...new Set((String(query ?? '').match(/[A-Za-z]{3,}/g) ?? []).map((t) => t.toUpperCase()))]
    .filter((t) => !STOP.has(t.toLowerCase()))
    .slice(0, 5);
}

// Returns { vesselMatches, trackMatches } for the query's distinctive name tokens (empty if none).
export async function lookupByName(sql, query) {
  const terms = nameTerms(query);
  if (!terms.length) return { vesselMatches: [], trackMatches: [] };
  const patterns = terms.map((t) => `%${t}%`);
  const [vesselMatches, trackMatches] = await Promise.all([
    sql`SELECT DISTINCT ON (mmsi) name, mmsi, vessel_type, sog_knots AS sog_kn, cog_deg, round(lat::numeric,3) AS lat, round(lon::numeric,3) AS lon, observed_at FROM vessel_observations WHERE observed_at > now() - interval '24 hours' AND name IS NOT NULL AND name ILIKE ALL(${patterns}) ORDER BY mmsi, observed_at DESC LIMIT 12`,
    sql`SELECT DISTINCT ON (icao24) callsign, icao24, region_id, altitude_m, velocity_ms, is_military, round(lat::numeric,3) AS lat, round(lon::numeric,3) AS lon, observed_at FROM track_observations WHERE observed_at > now() - interval '24 hours' AND callsign IS NOT NULL AND callsign ILIKE ALL(${patterns}) ORDER BY icao24, observed_at DESC LIMIT 12`,
  ]);
  return { vesselMatches, trackMatches };
}
