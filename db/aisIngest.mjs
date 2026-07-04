// AIS vessel ingest — opens a short-lived AISStream WebSocket per region, collects a
// position window, and appends rows to vessel_observations. Used by db/ingest.mjs
// (the 15-min recorder). Server-side only: the AISSTREAM_API_KEY must never reach the browser.
import WebSocket from 'ws';

const AIS_WS_URL = 'wss://stream.aisstream.io/v0/stream';
const USER_AGENT = 'AirMaven-Recorder/0.1';

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function normalizeVesselType(body) {
  const rawType = Number(body?.Type ?? body?.ShipType ?? body?.Shiptype);
  if (!Number.isFinite(rawType)) return 'unknown';
  if (rawType === 30) return 'fishing';
  if (rawType >= 70 && rawType <= 79) return 'cargo';
  if (rawType >= 80 && rawType <= 89) return 'tanker';
  return 'unknown';
}

function normalizeHeading(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(((n % 360) + 360) % 360);
}

function parseAisTimestamp(value, fallback) {
  if (!value) return fallback;
  const direct = new Date(value).getTime();
  if (Number.isFinite(direct)) return new Date(direct).toISOString();
  const normalized = String(value)
    .replace(' +0000 UTC', 'Z')
    .replace(' UTC', 'Z')
    .replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
  const t = new Date(normalized).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : fallback;
}

function inBbox(region, lat, lon, pad = 0.05) {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return lat >= minLat - pad && lat <= maxLat + pad && lon >= minLon - pad && lon <= maxLon + pad;
}

function boundingBoxes(region) {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return [[[minLat, minLon], [maxLat, maxLon]]];
}

function normalizeMessage(raw, region, generatedAt) {
  if (raw?.error) throw new Error(`AISStream error: ${raw.error}`);
  const messageType = raw?.MessageType;
  const body = raw?.Message?.[messageType] ?? raw?.Message?.PositionReport ?? raw?.Message ?? {};
  const metadata = raw?.MetaData ?? raw?.Metadata ?? {};
  const lat = num(body.Latitude ?? body.latitude ?? metadata.Latitude ?? metadata.latitude);
  const lon = num(body.Longitude ?? body.longitude ?? metadata.Longitude ?? metadata.longitude);
  if (lat == null || lon == null || !inBbox(region, lat, lon)) return null;
  const mmsi = String(body.UserID ?? metadata.MMSI ?? metadata.Mmsi ?? metadata.UserID ?? '').trim();
  if (!mmsi) return null;
  const rawName = String(body.Name ?? metadata.ShipName ?? metadata.ShipNameRaw ?? '').trim();
  const name = rawName && rawName !== '[CLASS B]' ? rawName : null;
  const sog = num(body.Sog ?? body.SOG ?? body.SpeedOverGround);
  return {
    observedAt: parseAisTimestamp(metadata.time_utc ?? metadata.TimeUtc ?? metadata.timestamp, generatedAt),
    regionId: region.id,
    mmsi,
    name,
    vesselType: normalizeVesselType(body),
    lat,
    lon,
    sogKnots: sog == null ? null : Math.max(0, Math.round(sog * 10) / 10),
    cogDeg: normalizeHeading(body.Cog ?? body.COG ?? body.CourseOverGround ?? body.TrueHeading),
    source: 'aisstream',
  };
}

// Drains the AISStream socket for one region for up to `timeoutMs`, keeping the latest
// position per MMSI. Resolves to a list of normalized rows (empty on no coverage/failure).
function collectRegionVessels(region, { apiKey, timeoutMs, maxShips }) {
  const generatedAt = new Date().toISOString();
  return new Promise((resolve) => {
    const byMmsi = new Map();
    let opened = false;
    let settled = false;
    let socket;

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Hard-terminate + detach listeners so no socket handle lingers on the event loop.
      // In serverless (Vercel/Lambda) a live handle stalls the HTTP response until the
      // function hits maxDuration, even though the DB writes already completed.
      if (socket) {
        try { socket.removeAllListeners(); socket.terminate(); } catch { /* already gone */ }
      }
      resolve([...byMmsi.values()].slice(0, maxShips));
    };

    const timer = setTimeout(finish, timeoutMs);
    try {
      socket = new WebSocket(AIS_WS_URL, { headers: { 'user-agent': USER_AGENT } });
    } catch {
      finish();
      return;
    }

    socket.on('open', () => {
      opened = true;
      socket.send(JSON.stringify({
        APIKey: apiKey,
        BoundingBoxes: boundingBoxes(region),
        FilterMessageTypes: [
          'PositionReport',
          'StandardClassBPositionReport',
          'ExtendedClassBPositionReport',
          'LongRangeAisBroadcastMessage',
        ],
      }));
    });

    socket.on('message', (data) => {
      try {
        const row = normalizeMessage(JSON.parse(data.toString()), region, generatedAt);
        if (row) byMmsi.set(row.mmsi, row);
        if (byMmsi.size >= maxShips) finish();
      } catch {
        finish();
      }
    });

    socket.on('error', () => finish());
    socket.on('close', () => { if (!settled) finish(); void opened; });
  });
}

// Collects vessels for every region and appends them to vessel_observations.
// No-op (logged) when AISSTREAM_API_KEY is missing or the fetch is disabled.
export async function collectVessels(sql, { regions, log } = {}) {
  const apiKey = process.env.AISSTREAM_API_KEY;
  const enabled = (process.env.AISSTREAM_FETCH_ENABLED ?? 'true') !== 'false';
  if (!apiKey || !enabled) {
    log?.(`vessels skipped (${!apiKey ? 'AISSTREAM_API_KEY 미설정' : 'AISSTREAM_FETCH_ENABLED=false'})`);
    return { inserted: 0 };
  }
  const timeoutMs = Math.max(3000, Number.parseInt(process.env.AISSTREAM_FETCH_MS ?? '20000', 10) || 20000);
  const maxShips = Math.max(1, Number.parseInt(process.env.AISSTREAM_MAX_SHIPS_PER_REGION ?? '30', 10) || 30);

  let inserted = 0;
  for (const region of regions ?? []) {
    try {
      const rows = await collectRegionVessels(region, { apiKey, timeoutMs, maxShips });
      if (rows.length) {
        await sql.transaction(rows.map((v) => sql`
          INSERT INTO vessel_observations
            (observed_at, region_id, mmsi, name, vessel_type, lat, lon, sog_knots, cog_deg, source)
          VALUES (${v.observedAt}, ${v.regionId}, ${v.mmsi}, ${v.name}, ${v.vesselType}, ${v.lat}, ${v.lon}, ${v.sogKnots}, ${v.cogDeg}, ${v.source})
        `));
      }
      inserted += rows.length;
      await sql`INSERT INTO ingest_runs (region_id, source, status, records, detail) VALUES (${region.id}, 'aisstream', 'ok', ${rows.length}, NULL)`;
      log?.(`${region.id} vessels=${rows.length}`);
    } catch (error) {
      await sql`INSERT INTO ingest_runs (region_id, source, status, records, detail) VALUES (${region.id}, 'aisstream', 'error', 0, ${String(error).slice(0, 300)})`;
      log?.(`${region.id} vessels FAILED: ${String(error)}`);
    }
  }
  return { inserted };
}
