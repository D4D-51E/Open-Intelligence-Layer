// AirMaven persistent AIS collector — Option A.
// Holds ONE long-lived AISStream WebSocket (global by default), keeps the latest position per
// MMSI, and flushes throttled snapshots into the SAME Neon vessel_observations table the app
// already queries by viewport bbox. The frontend and /api/history?kind=vessels are unchanged —
// only the ingestion source moves from the 5-min AOI cron to this always-on process.
//
// Meant to run as a Railway "worker" service (no HTTP). Server-side only: AISSTREAM_API_KEY and
// DATABASE_URL must never reach the browser. See README.md for deploy steps.
import WebSocket from 'ws';
import { neon } from '@neondatabase/serverless';
import { startAircraftCollector } from './aircraft.mjs';

const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.AISSTREAM_API_KEY;
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
if (!API_KEY) throw new Error('AISSTREAM_API_KEY is not set');

const sql = neon(DATABASE_URL);

// Global by default. Narrow to cut volume, e.g. AIS_BBOX='[[[-15,90],[55,150]]]' (Asia-Pacific).
// AISStream bbox format is [[[minLat,minLon],[maxLat,maxLon]], ...].
const BBOX = JSON.parse(process.env.AIS_BBOX ?? '[[[-90,-180],[90,180]]]');
const FLUSH_MS = Number(process.env.FLUSH_MS ?? 30_000);            // how often to write snapshots
const WRITE_THROTTLE_MS = Number(process.env.WRITE_THROTTLE_MS ?? 180_000); // ≤1 row per MMSI / 3 min
const MAX_ROWS_PER_FLUSH = Number(process.env.MAX_ROWS_PER_FLUSH ?? 2_000);
const PRUNE_HOURS = Number(process.env.PRUNE_HOURS ?? 24);          // retention (frontend needs ~6h)
const STALE_MS = PRUNE_HOURS * 3_600_000;
const SOURCE = 'aisstream-live';

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
function vesselType(body) {
  const t = Number(body?.Type ?? body?.ShipType ?? body?.Shiptype);
  if (!Number.isFinite(t)) return 'unknown';
  if (t === 30) return 'fishing';
  if (t >= 70 && t <= 79) return 'cargo';
  if (t >= 80 && t <= 89) return 'tanker';
  return 'unknown';
}
function heading(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(((n % 360) + 360) % 360) : null;
}
function parseTs(v) {
  if (!v) return new Date().toISOString();
  const d = new Date(v).getTime();
  if (Number.isFinite(d)) return new Date(d).toISOString();
  const nn = String(v).replace(' +0000 UTC', 'Z').replace(' UTC', 'Z').replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
  const t = new Date(nn).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : new Date().toISOString();
}
function normalize(raw) {
  const mt = raw?.MessageType;
  const body = raw?.Message?.[mt] ?? raw?.Message?.PositionReport ?? raw?.Message ?? {};
  const meta = raw?.MetaData ?? raw?.Metadata ?? {};
  const lat = num(body.Latitude ?? body.latitude ?? meta.Latitude ?? meta.latitude);
  const lon = num(body.Longitude ?? body.longitude ?? meta.Longitude ?? meta.longitude);
  if (lat == null || lon == null) return null;
  const mmsi = String(body.UserID ?? meta.MMSI ?? meta.Mmsi ?? meta.UserID ?? '').trim();
  if (!mmsi) return null;
  const rawName = String(body.Name ?? meta.ShipName ?? meta.ShipNameRaw ?? '').trim();
  const sog = num(body.Sog ?? body.SOG ?? body.SpeedOverGround);
  return {
    mmsi,
    name: rawName && rawName !== '[CLASS B]' ? rawName : null,
    vesselType: vesselType(body),
    lat,
    lon,
    sogKnots: sog == null ? null : Math.max(0, Math.round(sog * 10) / 10),
    cogDeg: heading(body.Cog ?? body.COG ?? body.CourseOverGround ?? body.TrueHeading),
    observedAt: parseTs(meta.time_utc ?? meta.TimeUtc ?? meta.timestamp),
  };
}

const latest = new Map();     // mmsi -> latest normalized position
const lastWrite = new Map();  // mmsi -> last DB write epoch ms
let seen = 0;
let written = 0;
let ws;
let backoff = 1_000;

function connect() {
  ws = new WebSocket('wss://stream.aisstream.io/v0/stream', { headers: { 'user-agent': 'AirMaven-Collector/1.0' } });
  ws.on('open', () => {
    backoff = 1_000;
    ws.send(JSON.stringify({
      APIKey: API_KEY,
      BoundingBoxes: BBOX,
      FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport', 'ExtendedClassBPositionReport', 'LongRangeAisBroadcastMessage'],
    }));
    console.log(`[ais] connected · bbox=${JSON.stringify(BBOX)}`);
  });
  ws.on('message', (data) => {
    let raw;
    try { raw = JSON.parse(data.toString()); } catch { return; }
    if (raw?.error) { console.error('[ais] server error:', raw.error); return; }
    const v = normalize(raw);
    if (!v) return;
    seen += 1;
    // keep a name once we've seen one (position reports often omit it)
    if (!v.name) v.name = latest.get(v.mmsi)?.name ?? null;
    latest.set(v.mmsi, v);
  });
  ws.on('close', () => { console.warn(`[ais] closed · reconnect in ${backoff}ms`); scheduleReconnect(); });
  ws.on('error', (err) => { console.error('[ais] ws error:', err.message); try { ws.terminate(); } catch { /* noop */ } });
}
function scheduleReconnect() {
  setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 60_000);
}

async function flush() {
  const now = Date.now();
  const due = [];
  for (const [mmsi, v] of latest) {
    if (now - (lastWrite.get(mmsi) ?? 0) >= WRITE_THROTTLE_MS) {
      due.push(v);
      if (due.length >= MAX_ROWS_PER_FLUSH) break;
    }
  }
  if (!due.length) return;
  const CHUNK = 200;
  for (let i = 0; i < due.length; i += CHUNK) {
    const batch = due.slice(i, i + CHUNK);
    try {
      await sql.transaction(batch.map((v) => sql`
        INSERT INTO vessel_observations (observed_at, region_id, mmsi, name, vessel_type, lat, lon, sog_knots, cog_deg, source)
        VALUES (${v.observedAt}, 'global', ${v.mmsi}, ${v.name}, ${v.vesselType}, ${v.lat}, ${v.lon}, ${v.sogKnots}, ${v.cogDeg}, ${SOURCE})
      `));
      for (const v of batch) lastWrite.set(v.mmsi, now);
      written += batch.length;
    } catch (err) {
      console.error('[db] flush batch failed:', err.message);
    }
  }
}

async function prune() {
  // Bound the table to the retention window (frontend only queries the last ~6h).
  try {
    await sql`DELETE FROM vessel_observations WHERE observed_at < now() - make_interval(hours => ${PRUNE_HOURS})`;
  } catch (err) {
    console.error('[db] prune failed:', err.message);
  }
  // Evict stale MMSIs from memory so the maps don't grow unbounded.
  const cutoff = Date.now() - STALE_MS;
  for (const [mmsi, v] of latest) {
    if (Date.parse(v.observedAt) < cutoff) { latest.delete(mmsi); lastWrite.delete(mmsi); }
  }
}

async function shutdown() {
  console.log('[ais] shutting down · final flush');
  try { await flush(); } catch { /* noop */ }
  try { ws?.close(); } catch { /* noop */ }
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

connect();
// Always-on aircraft (ADS-B) collection into track_observations, alongside the AIS stream.
// Set COLLECT_AIRCRAFT=0 to disable (e.g. if run as a separate service).
if (process.env.COLLECT_AIRCRAFT !== '0') {
  startAircraftCollector(sql, { log: console.log });
}
setInterval(() => { void flush(); }, FLUSH_MS);
setInterval(() => { void prune(); }, 3_600_000);
setInterval(() => { console.log(`[stat] tracked=${latest.size} seen=${seen} written=${written}`); }, 60_000);
console.log(`[ais] collector started · flush=${FLUSH_MS}ms throttle=${WRITE_THROTTLE_MS}ms prune=${PRUNE_HOURS}h`);
