// Persistent aircraft (ADS-B) collector. Polls adsb.lol per AOI on a short interval and appends
// to the SAME track_observations table the app queries by viewport (/api/history?kind=tracks) —
// replacing the sparse */15 GitHub Actions cron with continuous collection, mirroring the AIS
// worker. Self-contained (the Docker image only copies collector/), so the adsb.lol normalization
// is a faithful copy of db/ingest.mjs; keep the two in sync if that logic changes.

const ADSB_BASE = 'https://api.adsb.lol/v2';

// Same AOIs as db/ingest.mjs. adsb.lol is queried per region by centre + radius (NM).
const REGIONS = [
  { id: 'taiwan-strait', center: [24.4917388, 119.6054017], bbox: [118.4271213, 23.4204107, 120.7974216, 25.5523561] },
  { id: 'seoul-airspace', center: [37.5665, 126.978], bbox: [124.3727348, 36.8544193, 127.8481129, 38.2811104] },
  { id: 'south-china-sea', center: [11.1692778, 112.1948889], bbox: [102.2384722, -3.2287222, 122.1513056, 25.5672778] },
  { id: 'west-sea-nll', center: [37.91540942577175, 125.118340245885], bbox: [123.547708291629, 37.626084840136, 126.688972200141, 38.2047340114075] },
];

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const toRad = (d) => (d * Math.PI) / 180;
const EARTH_NM = 3440.065;

function haversineNm(aLat, aLon, bLat, bLon) {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return EARTH_NM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function regionRadiusNm(region) {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  const [cLat, cLon] = region.center;
  const r = Math.max(
    haversineNm(cLat, cLon, minLat, minLon),
    haversineNm(cLat, cLon, minLat, maxLon),
    haversineNm(cLat, cLon, maxLat, minLon),
    haversineNm(cLat, cLon, maxLat, maxLon),
  );
  return Math.min(250, Math.max(6, Math.round(r * 1.12)));
}
function inBbox(region, lat, lon, pad = 0.5) {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return lat >= minLat - pad && lat <= maxLat + pad && lon >= minLon - pad && lon <= maxLon + pad;
}

// adsb.lol `now` is milliseconds in some deployments, seconds in others — normalize both.
function normalizeNowMs(now) {
  const n = Number(now);
  if (!Number.isFinite(n)) return Date.now();
  return n < 1e12 ? n * 1000 : n;
}
// Guard against implausible observation times (clock skew / bad `seen`): clamp to a sane window.
function safeObservedAt(ms) {
  const now = Date.now();
  if (!Number.isFinite(ms) || ms > now + 60_000 || ms < now - 24 * 3_600_000) return new Date().toISOString();
  return new Date(ms).toISOString();
}

async function fetchJson(url, { retries = 2, backoffMs = 2500 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'AirMaven-Collector/1.0' } });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) { await sleep(backoffMs * (attempt + 1)); continue; }
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  throw new Error('unreachable');
}

function normalizeAircraft(region, nowMs, ac, forceMilitary) {
  const lat = num(ac.lat);
  const lon = num(ac.lon);
  if (lat == null || lon == null) return null;
  const seen = Math.max(0, num(ac.seen) ?? num(ac.seen_pos) ?? 0);
  const altFt = num(ac.alt_baro) ?? num(ac.alt_geom);
  const knots = num(ac.gs) ?? num(ac.ias) ?? num(ac.tas);
  const heading = num(ac.true_heading) ?? num(ac.track) ?? num(ac.mag_heading);
  const hex = String(ac.hex ?? '').trim().toLowerCase() || null;
  const callsign = String(ac.flight ?? '').trim().replace(/\s+/g, '') || String(ac.r ?? '').trim() || hex || null;
  return {
    observedAt: safeObservedAt(nowMs - seen * 1000),
    regionId: region.id,
    icao24: hex,
    callsign,
    lat,
    lon,
    altitudeM: altFt == null ? null : Math.max(0, Math.round(altFt * 0.3048)),
    velocityMs: knots == null ? null : Math.round(knots * 0.514444 * 10) / 10,
    headingDeg: heading == null ? null : Math.round(heading),
    isMilitary: forceMilitary || ((num(ac.dbFlags) ?? 0) & 1) === 1,
    typeCode: String(ac.t ?? '').trim() || null,
    registration: String(ac.r ?? '').trim() || null,
    source: 'adsb-lol',
  };
}

async function fetchGlobalMilitary() {
  const mil = await fetchJson(`${ADSB_BASE}/mil`);
  return { aircraft: mil.ac ?? [], nowMs: normalizeNowMs(mil.now) };
}

async function collectTracks(region, mil) {
  const [lat, lon] = region.center;
  const radius = regionRadiusNm(region);
  const point = await fetchJson(`${ADSB_BASE}/lat/${lat}/lon/${lon}/dist/${radius}`);
  const nowMs = normalizeNowMs(point.now);
  const byId = new Map();
  for (const ac of point.ac ?? []) {
    const row = normalizeAircraft(region, nowMs, ac, false);
    if (row?.icao24) byId.set(row.icao24, row);
  }
  for (const ac of mil.aircraft) {
    const row = normalizeAircraft(region, mil.nowMs, ac, true);
    if (row && inBbox(region, row.lat, row.lon)) byId.set(row.icao24 ?? `${row.lat},${row.lon}`, row);
  }
  return [...byId.values()];
}

// Start the always-on aircraft loop. Non-throwing: one region's failure never stops the others,
// and a slow pass never overlaps the next (guarded by `running`).
export function startAircraftCollector(sql, opts = {}) {
  const intervalMs = Number(opts.intervalMs ?? process.env.AIRCRAFT_INTERVAL_MS ?? 60_000);
  const paceMs = Number(opts.paceMs ?? process.env.AIRCRAFT_PACE_MS ?? 1_500);
  const pruneHours = Number(opts.pruneHours ?? process.env.AIRCRAFT_PRUNE_HOURS ?? 24);
  const log = opts.log ?? console.log;
  let running = false;
  let written = 0;

  async function pass() {
    if (running) return;
    running = true;
    try {
      let mil;
      try { mil = await fetchGlobalMilitary(); } catch (e) { log(`[adsb] mil fetch failed: ${e.message}`); mil = { aircraft: [], nowMs: Date.now() }; }
      for (const region of REGIONS) {
        try {
          const tracks = await collectTracks(region, mil);
          const CHUNK = 200;
          for (let i = 0; i < tracks.length; i += CHUNK) {
            const batch = tracks.slice(i, i + CHUNK);
            await sql.transaction(batch.map((t) => sql`
              INSERT INTO track_observations
                (observed_at, region_id, icao24, callsign, lat, lon, altitude_m, velocity_ms, heading_deg, is_military, type_code, registration, source)
              VALUES (${t.observedAt}, ${t.regionId}, ${t.icao24}, ${t.callsign}, ${t.lat}, ${t.lon}, ${t.altitudeM}, ${t.velocityMs}, ${t.headingDeg}, ${t.isMilitary}, ${t.typeCode}, ${t.registration}, ${t.source})
            `));
            written += batch.length;
          }
          log(`[adsb] ${region.id} tracks=${tracks.length}`);
        } catch (e) {
          log(`[adsb] ${region.id} FAILED: ${e.message}`);
        }
        await sleep(paceMs);
      }
    } finally {
      running = false;
    }
  }

  async function prune() {
    try {
      await sql`DELETE FROM track_observations WHERE observed_at < now() - make_interval(hours => ${pruneHours})`;
    } catch (e) {
      log(`[adsb] prune failed: ${e.message}`);
    }
  }

  void pass();
  setInterval(() => { void pass(); }, intervalMs);
  setInterval(() => { void prune(); }, 3_600_000);
  setInterval(() => { log(`[adsb] written=${written}`); }, 60_000);
  log(`[adsb] aircraft collector started · interval=${intervalMs}ms pace=${paceMs}ms regions=${REGIONS.length} prune=${pruneHours}h`);
}
