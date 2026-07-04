// Shared observation-ingest logic. Used by scripts/record-observations.mjs (local)
// and api/cron/record.mjs (Vercel Cron). Fetches live public sources server-side and
// appends time-series rows to Neon.

import { collectOsint } from './osintIngest.mjs';
import { collectNotam } from './notamIngest.mjs';
import { collectTelegram } from './telegramIngest.mjs';

const ADSB_BASE = 'https://api.adsb.lol/v2';
const OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';

export const regions = [
  { id: 'taiwan-strait', center: [24.4917388, 119.6054017], bbox: [118.4271213, 23.4204107, 120.7974216, 25.5523561] },
  { id: 'seoul-airspace', center: [37.5665, 126.978], bbox: [124.3727348, 36.8544193, 127.8481129, 38.2811104] },
  { id: 'south-china-sea', center: [11.1692778, 112.1948889], bbox: [102.2384722, -3.2287222, 122.1513056, 25.5672778] },
  { id: 'west-sea-nll', center: [37.91540942577175, 125.118340245885], bbox: [123.547708291629, 37.626084840136, 126.688972200141, 38.2047340114075] },
];

const EARTH_NM = 3440.065;
const toRad = (d) => (d * Math.PI) / 180;
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

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// adsb.lol `now` is milliseconds in some deployments, seconds in others — normalize both.
function normalizeNowMs(rawNow) {
  const n = num(rawNow);
  if (n == null) return Date.now();
  return n > 1e12 ? n : n * 1000;
}
function safeObservedAt(ms) {
  const now = Date.now();
  if (!Number.isFinite(ms) || ms < now - 24 * 3600 * 1000 || ms > now + 3600 * 1000) return new Date(now).toISOString();
  return new Date(ms).toISOString();
}

async function fetchJson(url, { retries = 2, backoffMs = 2500 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'AirMaven-Recorder/0.1' } });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < retries) {
      await sleep(backoffMs * (attempt + 1));
      continue;
    }
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

async function collectWeather(region) {
  const [lat, lon] = region.center;
  const url = new URL(OPEN_METEO);
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m,precipitation,weather_code,cloud_cover,wind_gusts_10m');
  url.searchParams.set('hourly', 'visibility');
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('forecast_days', '1');
  const json = await fetchJson(url);
  const c = json.current ?? {};
  const observedAt = c.time ? `${c.time}:00Z` : new Date().toISOString();
  let visibility = null;
  if (json.hourly?.time?.length && json.hourly?.visibility?.length) {
    const target = new Date(observedAt).getTime();
    let best = 0;
    let bestD = Infinity;
    json.hourly.time.forEach((t, i) => {
      const d = Math.abs(new Date(`${t}:00Z`).getTime() - target);
      if (d < bestD) { bestD = d; best = i; }
    });
    visibility = num(json.hourly.visibility[best]);
  }
  return {
    observedAt,
    regionId: region.id,
    temperatureC: num(c.temperature_2m),
    windGustKmh: num(c.wind_gusts_10m),
    visibilityM: visibility,
    cloudPct: num(c.cloud_cover),
    precipMm: num(c.precipitation),
  };
}

async function recordRegion(sql, region, mil, log) {
  const result = { region: region.id, tracks: 0, military: 0, weather: 0, errors: [] };
  try {
    const tracks = await collectTracks(region, mil);
    if (tracks.length) {
      await sql.transaction(tracks.map((t) => sql`
        INSERT INTO track_observations
          (observed_at, region_id, icao24, callsign, lat, lon, altitude_m, velocity_ms, heading_deg, is_military, type_code, registration, source)
        VALUES (${t.observedAt}, ${t.regionId}, ${t.icao24}, ${t.callsign}, ${t.lat}, ${t.lon}, ${t.altitudeM}, ${t.velocityMs}, ${t.headingDeg}, ${t.isMilitary}, ${t.typeCode}, ${t.registration}, ${t.source})
      `));
    }
    result.tracks = tracks.length;
    result.military = tracks.filter((t) => t.isMilitary).length;
    await sql`INSERT INTO ingest_runs (region_id, source, status, records, detail) VALUES (${region.id}, 'adsb-lol', 'ok', ${tracks.length}, ${`mil=${result.military}`})`;
    log?.(`${region.id} tracks=${tracks.length} (mil=${result.military})`);
  } catch (error) {
    result.errors.push(`tracks: ${String(error)}`);
    await sql`INSERT INTO ingest_runs (region_id, source, status, records, detail) VALUES (${region.id}, 'adsb-lol', 'error', 0, ${String(error).slice(0, 300)})`;
    log?.(`${region.id} tracks FAILED: ${String(error)}`);
  }

  try {
    const w = await collectWeather(region);
    await sql`
      INSERT INTO weather_observations (observed_at, region_id, temperature_c, wind_gust_kmh, visibility_m, cloud_pct, precip_mm)
      VALUES (${w.observedAt}, ${w.regionId}, ${w.temperatureC}, ${w.windGustKmh}, ${w.visibilityM}, ${w.cloudPct}, ${w.precipMm})
    `;
    result.weather = 1;
    await sql`INSERT INTO ingest_runs (region_id, source, status, records, detail) VALUES (${region.id}, 'open-meteo', 'ok', 1, NULL)`;
    log?.(`${region.id} weather ok (cloud=${w.cloudPct}%)`);
  } catch (error) {
    result.errors.push(`weather: ${String(error)}`);
    await sql`INSERT INTO ingest_runs (region_id, source, status, records, detail) VALUES (${region.id}, 'open-meteo', 'error', 0, ${String(error).slice(0, 300)})`;
    log?.(`${region.id} weather FAILED: ${String(error)}`);
  }
  return result;
}

// Runs one full collection pass across all AOIs. `opts.paceMs` throttles adsb.lol calls.
export async function recordAllObservations(sql, { paceMs = 2000, log } = {}) {
  let mil = { aircraft: [], nowMs: Date.now() };
  try {
    mil = await fetchGlobalMilitary();
    log?.(`global /mil aircraft=${mil.aircraft.length}`);
  } catch (error) {
    log?.(`/mil failed (continuing with point feeds only): ${String(error)}`);
  }
  const regionResults = [];
  for (const region of regions) {
    await sleep(paceMs);
    regionResults.push(await recordRegion(sql, region, mil, log));
  }

  // OSINT (GDELT + curated RSS) and NOTAM (FAA) collectors. AIS vessels are collected by a
  // separate cron (api/cron/record-vessels.mjs) because the WebSocket window has a very
  // different timing profile and would otherwise push this pass toward the function limit.
  let osint = { inserted: 0 };
  let notam = { inserted: 0 };
  try {
    osint = await collectOsint(sql, { log });
  } catch (error) {
    log?.(`osint failed: ${String(error)}`);
  }
  try {
    notam = await collectNotam(sql, { log });
  } catch (error) {
    log?.(`notam failed: ${String(error)}`);
  }
  let telegram = { inserted: 0 };
  try {
    telegram = await collectTelegram(sql, { log });
  } catch (error) {
    log?.(`telegram failed: ${String(error)}`);
  }

  return {
    militaryFeed: mil.aircraft.length,
    totalTracks: regionResults.reduce((sum, r) => sum + r.tracks, 0),
    totalWeather: regionResults.reduce((sum, r) => sum + r.weather, 0),
    osint: osint.inserted ?? 0,
    notam: notam.inserted ?? 0,
    telegram: telegram.inserted ?? 0,
    regions: regionResults,
  };
}
