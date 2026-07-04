import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate } from 'satellite.js';
import WebSocket from 'ws';
import {
  parsePositiveInteger,
  publicErrorMessage,
  recommendedOpenSkyIntervalMs,
  retryAfterSecondsFromHeaders,
} from './live-fetch-utils.mjs';

const execFileAsync = promisify(execFile);
const outPath = path.resolve('public/data/live-scenarios.json');
const userAgent = 'AirMaven-Verify-Hackathon/0.1 public-osint-real-data';
const openSkyTokenUrl = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const copernicusStacSearchUrl = 'https://stac.dataspace.copernicus.eu/v1/search';

const regions = [
  {
    id: 'global',
    shortName: 'Global',
    bbox: [-180, -60, 180, 82],
    center: [20, 20],
    newsQuery: 'military aircraft airspace maritime security naval exercise',
    notamLocations: [],
    global: true,
    osintLimit: 12,
  },
  {
    id: 'taiwan-strait',
    shortName: '대만해협',
    bbox: [118.4271213, 23.4204107, 120.7974216, 25.5523561],
    center: [24.4917388, 119.6054017],
    newsQuery: 'Taiwan Strait aircraft airspace',
    notamLocations: ['RCBS', 'RCQC', 'RCSS'],
  },
  {
    id: 'seoul-airspace',
    shortName: '수도권 상공',
    bbox: [124.3727348, 36.8544193, 127.8481129, 38.2811104],
    center: [37.5665, 126.978],
    newsQuery: 'KADIZ aircraft Korea airspace',
    notamLocations: ['RKSI', 'RKSS', 'RKSM'],
  },
  {
    id: 'south-china-sea',
    shortName: '남중국해',
    bbox: [102.2384722, -3.2287222, 122.1513056, 25.5672778],
    center: [11.1692778, 112.1948889],
    newsQuery: 'South China Sea aircraft maritime patrol',
    notamLocations: ['RPLL', 'VVTS', 'WSSS'],
  },
  {
    id: 'west-sea-nll',
    shortName: '서해/NLL 인근',
    bbox: [123.547708291629, 37.626084840136, 126.688972200141, 38.2047340114075],
    center: [37.91540942577175, 125.118340245885],
    newsQuery: 'West Sea Korea aircraft KADIZ',
    notamLocations: ['RKSI', 'RKSS'],
  },
];

class HttpStatusError extends Error {
  constructor(status, statusText, body, headers) {
    super(`HTTP ${status}${statusText ? ` ${statusText}` : ''}`);
    this.status = status;
    this.headers = headers;
    this.body = body;
  }
}

function boolFromEnv(name, fallback = false) {
  const value = process.env[name];
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function hasOpenSkyOAuth() {
  return Boolean(process.env.OPENSKY_CLIENT_ID && process.env.OPENSKY_CLIENT_SECRET);
}

function openSkyAuthMode() {
  return hasOpenSkyOAuth() ? 'oauth2' : 'anonymous';
}

async function readPreviousCache() {
  try {
    return JSON.parse(await fs.readFile(outPath, 'utf8'));
  } catch {
    return null;
  }
}

function previousOpenSkyUpdatedAt(previousCache, regionId) {
  return previousCache?.regions?.[regionId]?.sourceUpdatedAt?.opensky ?? null;
}

function previousOpenSkyTracks(previousCache, regionId) {
  return previousCache?.regions?.[regionId]?.tracks ?? [];
}

function previousShips(previousCache, regionId) {
  return previousCache?.regions?.[regionId]?.ships ?? [];
}

function previousSourceUpdatedAt(previousCache, regionId, source) {
  return previousCache?.regions?.[regionId]?.sourceUpdatedAt?.[source] ?? null;
}

function previousAirspaceContexts(previousCache, regionId) {
  return previousCache?.regions?.[regionId]?.airspaceContexts ?? [];
}

function previousSatelliteScenes(previousCache, regionId) {
  return previousCache?.regions?.[regionId]?.satelliteScenes ?? [];
}

function previousThermalAnomalies(previousCache, regionId) {
  return previousCache?.regions?.[regionId]?.thermalAnomalies ?? [];
}

function standbyDetailLayer(source, previousValue = []) {
  return {
    ok: previousValue.length > 0,
    value: previousValue,
    status: previousValue.length > 0 ? 'cached' : 'standby',
    updatedAt: undefined,
    reason: `전세계 ${source} 전체 조회는 비용/제한 때문에 비활성입니다. 상세 AOI 선택 시 수집합니다.`,
  };
}

function standbySatelliteSceneLayer(region, previousCache) {
  const previous = previousSatelliteScenes(previousCache, region.id);
  const previousUpdatedAt = previousSourceUpdatedAt(previousCache, region.id, 'copernicusStac');
  return {
    scenes: previous,
    status: previous.length > 0 ? 'cached' : 'standby',
    updatedAt: previousUpdatedAt,
    reason: '전세계 Copernicus STAC 조회는 비용/응답량 때문에 비활성입니다. 상세 AOI 선택 시 조회합니다.',
  };
}

function standbyThermalLayer(region, previousCache) {
  const previous = previousThermalAnomalies(previousCache, region.id);
  const previousUpdatedAt = previousSourceUpdatedAt(previousCache, region.id, 'nasaFirms');
  return {
    thermalAnomalies: previous,
    status: previous.length > 0 ? 'cached' : 'standby',
    updatedAt: previousUpdatedAt,
    reason: '전세계 NASA FIRMS 조회는 거래량이 커서 비활성입니다. 상세 AOI 선택 시 조회합니다.',
    warnings: [],
  };
}

function standbyAisLayer(region, previousCache) {
  const previous = previousShips(previousCache, region.id);
  const previousUpdatedAt = previousSourceUpdatedAt(previousCache, region.id, 'ais');
  return {
    ships: previous,
    status: previous.length > 0 ? 'cached' : 'standby',
    updatedAt: previousUpdatedAt,
    reason: '전세계 AIS 전체 WebSocket 구독은 비활성입니다. 상세 AOI 선택 시 수집합니다.',
    warnings: [],
  };
}

function standbyFirLayer(region, previousCache) {
  const previous = previousAirspaceContexts(previousCache, region.id);
  const previousUpdatedAt = previousSourceUpdatedAt(previousCache, region.id, 'icaoFir');
  return {
    items: previous,
    status: previous.length > 0 ? 'cached' : 'standby',
    updatedAt: previousUpdatedAt,
    reason: '전세계 FIR 단일 중심점 조회는 의미가 없어 비활성입니다. 상세 AOI 선택 시 조회합니다.',
  };
}

function standbyNoticeLayer() {
  return {
    notices: [],
    status: 'standby',
    reason: '전세계 NOTAM 통합 조회는 비활성입니다. 상세 AOI/공항 코드 기준으로 조회합니다.',
    warnings: [],
  };
}

function openSkyRetryAfterUntil(previousCache) {
  const state = previousCache?.rateLimitState?.opensky;
  if (!state) return null;
  if (state.authMode && state.authMode !== openSkyAuthMode()) return null;
  if (!state.authMode && hasOpenSkyOAuth()) return null;
  const value = state.retryAfterUntil;
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function gdeltRetryAfterUntil(previousCache) {
  const value = previousCache?.rateLimitState?.gdelt?.retryAfterUntil;
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function isFresh(timestamp, nowMs, ttlMs) {
  if (!timestamp) return false;
  const value = new Date(timestamp).getTime();
  return Number.isFinite(value) && nowMs - value >= 0 && nowMs - value < ttlMs;
}

function openSkyMinFetchIntervalMs() {
  const defaultForMode = hasOpenSkyOAuth()
    ? 5 * 60 * 1000
    : recommendedOpenSkyIntervalMs(regions);
  return parsePositiveInteger(process.env.OPENSKY_MIN_FETCH_INTERVAL_MS, defaultForMode);
}

function openSkyMaxTracksPerRegion() {
  return parsePositiveInteger(process.env.OPENSKY_MAX_TRACKS_PER_REGION, 50);
}

function gdeltBackoffMs() {
  return parsePositiveInteger(process.env.GDELT_BACKOFF_MS, 30 * 60 * 1000);
}

function copernicusStacMinFetchIntervalMs() {
  return parsePositiveInteger(process.env.COPERNICUS_STAC_MIN_FETCH_INTERVAL_MS, 6 * 60 * 60 * 1000);
}

function copernicusStacMaxScenesPerRegion() {
  return parsePositiveInteger(process.env.COPERNICUS_STAC_MAX_SCENES_PER_REGION, 6);
}

function copernicusStacLookbackHours() {
  return parsePositiveInteger(process.env.COPERNICUS_STAC_LOOKBACK_HOURS, 72);
}

function nasaFirmsCacheTtlMs() {
  return parsePositiveInteger(process.env.NASA_FIRMS_CACHE_TTL_MS, 60 * 60 * 1000);
}

function nasaFirmsDayRange() {
  return Math.max(1, Math.min(10, parsePositiveInteger(process.env.NASA_FIRMS_DAY_RANGE, 1)));
}

function nasaFirmsMaxRecordsPerRegion() {
  return parsePositiveInteger(process.env.NASA_FIRMS_MAX_RECORDS_PER_REGION, 25);
}

function aisCacheTtlMs() {
  return parsePositiveInteger(process.env.AISSTREAM_CACHE_TTL_MS, 30 * 60 * 1000);
}

async function readCredentialsJson() {
  try {
    const raw = await fs.readFile(path.resolve('credentials.json'), 'utf8');
    const json = JSON.parse(raw);
    const clientId = json.OPENSKY_CLIENT_ID ?? json.openskyClientId ?? json.clientId;
    const clientSecret = json.OPENSKY_CLIENT_SECRET ?? json.openskyClientSecret ?? json.clientSecret;
    if (!process.env.OPENSKY_CLIENT_ID && clientId) process.env.OPENSKY_CLIENT_ID = String(clientId);
    if (!process.env.OPENSKY_CLIENT_SECRET && clientSecret) process.env.OPENSKY_CLIENT_SECRET = String(clientSecret);
  } catch {
    // credentials.json is optional.
  }
}

async function readEnv() {
  try {
    const raw = await fs.readFile(path.resolve('.env'), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    // .env is optional.
  }
  await readCredentialsJson();
}

async function fetchJson(url, { timeoutMs = 15000, headers = {} } = {}) {
  const text = await fetchText(url, { timeoutMs, headers });
  return JSON.parse(text);
}

async function fetchJsonPost(url, body, { timeoutMs = 15000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'user-agent': userAgent,
        accept: 'application/json',
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new HttpStatusError(response.status, response.statusText, text, response.headers);
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, { timeoutMs = 15000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': userAgent, accept: '*/*', ...headers },
    });
    const text = await response.text();
    if (!response.ok) throw new HttpStatusError(response.status, response.statusText, text, response.headers);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

let openSkyAccessToken = null;
let openSkyRuntimeBackoffUntil = null;

async function fetchOpenSkyAccessToken() {
  if (openSkyAccessToken) return openSkyAccessToken;
  const response = await fetch(openSkyTokenUrl, {
    method: 'POST',
    headers: {
      'user-agent': userAgent,
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.OPENSKY_CLIENT_ID,
      client_secret: process.env.OPENSKY_CLIENT_SECRET,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new HttpStatusError(response.status, response.statusText, text, response.headers);
  const json = JSON.parse(text);
  if (!json.access_token) throw new Error('OpenSky OAuth2 token response did not include access_token');
  openSkyAccessToken = json.access_token;
  return openSkyAccessToken;
}

async function openSkyHeaders() {
  if (!hasOpenSkyOAuth()) return {};
  return { authorization: `Bearer ${await fetchOpenSkyAccessToken()}` };
}

async function fetchJsonViaPython(url) {
  const code = `
import json, sys, urllib.request
req = urllib.request.Request(sys.argv[1], headers={"User-Agent": "${userAgent}"})
with urllib.request.urlopen(req, timeout=20) as r:
    print(r.read().decode("utf-8", "ignore"))
`;
  const { stdout } = await execFileAsync('python3', ['-c', code, url], { maxBuffer: 1024 * 1024 * 4 });
  return JSON.parse(stdout);
}

async function safeStep(label, fn, fallbackValue) {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, value: fallbackValue, error: `${label}: ${shortError(error)}` };
  }
}

function shortError(error) {
  return publicErrorMessage(error);
}

function isoFromUnixSeconds(seconds) {
  return new Date(seconds * 1000).toISOString();
}

function classifyPlatform(callsign, onGround) {
  if (onGround) return 'unknown';
  if (!callsign || callsign.length < 3) return 'unknown';
  return 'commercial';
}

function normalizeOpenSkyState(state, regionId) {
  const [
    icao24,
    rawCallsign,
    originCountry,
    timePosition,
    lastContact,
    lon,
    lat,
    baroAltitude,
    onGround,
    velocity,
    trueTrack,
  ] = state;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;
  const callsign = String(rawCallsign || icao24 || 'UNKNOWN').trim() || String(icao24);
  const observedAt = isoFromUnixSeconds(Number(timePosition || lastContact || Date.now() / 1000));
  return {
    id: `live-${regionId}-${icao24}`,
    source: 'opensky-cache',
    callsign,
    originCountry: originCountry || 'Unknown',
    platformType: classifyPlatform(callsign, Boolean(onGround)),
    baselineCorridorKm: 25,
    notes: 'Live OpenSky anonymous state vector cache. Public ADS-B coverage is incomplete.',
    points: [{
      lat,
      lon,
      altitudeM: Math.max(0, Math.round(Number(baroAltitude || 0))),
      velocityMs: Math.max(0, Math.round(Number(velocity || 0) * 10) / 10),
      headingDeg: Math.round(Number(trueTrack || 0)),
      observedAt,
    }],
  };
}

async function fetchOpenSky(region) {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  const url = new URL('https://opensky-network.org/api/states/all');
  url.searchParams.set('lamin', String(minLat));
  url.searchParams.set('lomin', String(minLon));
  url.searchParams.set('lamax', String(maxLat));
  url.searchParams.set('lomax', String(maxLon));
  const headers = await openSkyHeaders();
  const json = await fetchJson(url, { timeoutMs: 20000, headers });
  return (json.states || [])
    .map((state) => normalizeOpenSkyState(state, region.id))
    .filter(Boolean)
    .sort((a, b) => (b.points[0]?.velocityMs ?? 0) - (a.points[0]?.velocityMs ?? 0))
    .slice(0, openSkyMaxTracksPerRegion());
}

async function fetchOpenSkyWithCache(region, previousCache, generatedAt) {
  const nowMs = new Date(generatedAt).getTime();
  const minFetchMs = openSkyMinFetchIntervalMs();
  const previousTracks = previousOpenSkyTracks(previousCache, region.id);
  const previousUpdatedAt = previousOpenSkyUpdatedAt(previousCache, region.id);
  const retryUntil = openSkyRuntimeBackoffUntil ?? openSkyRetryAfterUntil(previousCache);

  if (!boolFromEnv('OPENSKY_FETCH_ENABLED', true)) {
    return {
      ok: previousTracks.length > 0,
      value: previousTracks,
      status: previousTracks.length > 0 ? 'cached' : 'unavailable',
      updatedAt: previousUpdatedAt,
      warning: 'OpenSky disabled by OPENSKY_FETCH_ENABLED=false',
      reason: 'OPENSKY_FETCH_ENABLED=false',
    };
  }

  if (retryUntil && retryUntil > nowMs) {
    return {
      ok: previousTracks.length > 0,
      value: previousTracks,
      status: previousTracks.length > 0 ? 'cached' : 'unavailable',
      updatedAt: previousUpdatedAt,
      retryAfterUntil: new Date(retryUntil).toISOString(),
      warning: `OpenSky ${region.id}: backoff active until ${new Date(retryUntil).toISOString()}`,
      reason: `429 backoff until ${new Date(retryUntil).toISOString()}`,
    };
  }

  if (previousTracks.length > 0 && isFresh(previousUpdatedAt, nowMs, minFetchMs)) {
    return {
      ok: true,
      value: previousTracks,
      status: 'cached',
      updatedAt: previousUpdatedAt,
      warning: `OpenSky ${region.id}: reused cache; min interval ${Math.round(minFetchMs / 60000)}m`,
      reason: `TTL ${Math.round(minFetchMs / 60000)}분 내 캐시 재사용`,
    };
  }

  try {
    const tracks = await fetchOpenSky(region);
    return {
      ok: true,
      value: tracks,
      status: 'live',
      updatedAt: generatedAt,
    };
  } catch (error) {
    const retryAfterSeconds = error?.status === 429 ? retryAfterSecondsFromHeaders(error.headers) : null;
    const retryAfterUntil = retryAfterSeconds == null
      ? null
      : new Date(nowMs + retryAfterSeconds * 1000).toISOString();
    if (retryAfterUntil) openSkyRuntimeBackoffUntil = new Date(retryAfterUntil).getTime();
    return {
      ok: false,
      value: previousTracks,
      status: previousTracks.length > 0 ? 'cached' : 'unavailable',
      updatedAt: previousTracks.length > 0 ? previousUpdatedAt : undefined,
      retryAfterUntil,
      warning: `OpenSky ${region.id}: ${shortError(error)}${retryAfterUntil ? `; retry after ${retryAfterUntil}` : ''}`,
      reason: retryAfterUntil ? `429 backoff until ${retryAfterUntil}` : shortError(error),
    };
  }
}

function nearestHourlyVisibility(hourly, currentTime) {
  if (!hourly?.time?.length || !hourly?.visibility?.length) return 10000;
  const target = new Date(currentTime).getTime();
  let bestIndex = 0;
  let bestDelta = Infinity;
  hourly.time.forEach((time, index) => {
    const delta = Math.abs(new Date(`${time}:00Z`).getTime() - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  });
  return Number(hourly.visibility[bestIndex] || 10000);
}

async function fetchOpenMeteo(region) {
  const [lat, lon] = region.center;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(lat));
  url.searchParams.set('longitude', String(lon));
  url.searchParams.set('current', 'temperature_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m');
  url.searchParams.set('hourly', 'visibility');
  url.searchParams.set('timezone', 'UTC');
  url.searchParams.set('forecast_days', '1');
  const json = await fetchJson(url);
  const current = json.current;
  return {
    id: `live-wx-${region.id}`,
    source: 'open-meteo-cache',
    regionId: region.id,
    observedAt: `${current.time}:00Z`,
    temperatureC: Number(current.temperature_2m || 0),
    windSpeedKmh: Number(current.wind_speed_10m || 0),
    windGustKmh: Number(current.wind_gusts_10m || 0),
    visibilityM: nearestHourlyVisibility(json.hourly, `${current.time}:00Z`),
    cloudCoverPct: Number(current.cloud_cover || 0),
    precipitationMm: Number(current.precipitation || 0),
    weatherCode: Number(current.weather_code || 0),
  };
}

async function fetchGdelt(region) {
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', region.newsQuery);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', String(region.osintLimit ?? 5));
  url.searchParams.set('sort', 'HybridRel');
  let json;
  try {
    json = await fetchJson(url, { timeoutMs: 20000 });
  } catch {
    json = await fetchJsonViaPython(url.toString());
  }
  return (json.articles || []).slice(0, region.osintLimit ?? 5).map((article, index) => ({
    id: `live-osint-${region.id}-${index + 1}`,
    source: 'gdelt-cache',
    regionId: region.id,
    title: article.title || `GDELT article ${index + 1}`,
    url: article.url,
    domain: article.domain,
    publishedAt: parseGdeltSeenDate(article.seendate),
    summary: `Live GDELT article signal for query: ${region.newsQuery}. Language=${article.language || 'unknown'}, sourceCountry=${article.sourcecountry || 'unknown'}.`,
    tags: ['gdelt', 'osint', 'news volume', region.id],
    confidence: Math.max(0.48, 0.72 - index * 0.06),
  }));
}

function decodeXmlEntities(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function xmlTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? decodeXmlEntities(match[1].trim()) : '';
}

function xmlSource(block) {
  const match = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
  return match ? decodeXmlEntities(match[1].trim()) : 'Google News';
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

async function fetchGoogleNews(region) {
  const url = new URL('https://news.google.com/rss/search');
  url.searchParams.set('q', region.newsQuery);
  url.searchParams.set('hl', 'en-US');
  url.searchParams.set('gl', 'US');
  url.searchParams.set('ceid', 'US:en');
  const xml = await fetchText(url, {
    timeoutMs: 20000,
    headers: { 'user-agent': 'Mozilla/5.0 AirMaven-Lite-Hackathon/0.1 public-osint-real-data' },
  });
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, region.osintLimit ?? 5).map((match) => match[1]);
  return itemBlocks.map((block, index) => {
    const link = xmlTag(block, 'link');
    const sourceName = xmlSource(block);
    const publishedAtRaw = xmlTag(block, 'pubDate');
    const publishedAt = publishedAtRaw ? new Date(publishedAtRaw).toISOString() : new Date().toISOString();
    return {
      id: `live-osint-google-${region.id}-${index + 1}`,
      source: 'google-news-rss-cache',
      regionId: region.id,
      title: xmlTag(block, 'title') || `Google News RSS item ${index + 1}`,
      url: link,
      domain: sourceName || domainFromUrl(link),
      publishedAt,
      summary: `Live Google News RSS search signal for query: ${region.newsQuery}. Source=${sourceName}.`,
      tags: ['google news', 'osint', 'news volume', region.id],
      confidence: Math.max(0.44, 0.64 - index * 0.05),
    };
  });
}

function isRateLimitedError(error) {
  return error?.status === 429 || /HTTP Error 429|HTTP 429|Too Many Requests/i.test(shortError(error));
}

async function fetchOsint(region, previousCache, generatedAt) {
  const warnings = [];
  const sourceStatus = { gdelt: 'unavailable', googleNews: 'unavailable' };
  const sourceReasons = {};
  let retryAfterUntil;
  const gdeltRetryUntil = gdeltRetryAfterUntil(previousCache);
  const nowMs = new Date(generatedAt).getTime();

  try {
    if (gdeltRetryUntil && gdeltRetryUntil > nowMs) {
      sourceStatus.gdelt = 'rate-limited';
      retryAfterUntil = new Date(gdeltRetryUntil).toISOString();
      sourceReasons.gdelt = `429 backoff until ${retryAfterUntil}`;
    } else {
      const items = await fetchGdelt(region);
      if (items.length > 0) {
        return {
          items,
          warnings,
          sourceStatus: { gdelt: 'live', googleNews: 'standby' },
          sourceReasons: { googleNews: 'GDELT 성공으로 대체 피드 미사용' },
        };
      }
      sourceStatus.gdelt = 'empty';
      sourceReasons.gdelt = '검색 결과 0건';
    }
  } catch (error) {
    if (isRateLimitedError(error)) {
      retryAfterUntil = new Date(nowMs + gdeltBackoffMs()).toISOString();
      sourceStatus.gdelt = 'rate-limited';
      sourceReasons.gdelt = '429 Too Many Requests; Google News로 대체';
    } else {
      sourceStatus.gdelt = 'unavailable';
      sourceReasons.gdelt = shortError(error);
      warnings.push(`GDELT ${region.id}: ${shortError(error)}`);
    }
  }

  try {
    const items = await fetchGoogleNews(region);
    if (items.length > 0) {
      return {
        items,
        warnings,
        retryAfterUntil,
        sourceStatus: { ...sourceStatus, googleNews: 'live' },
        sourceReasons,
      };
    }
    sourceStatus.googleNews = 'empty';
    sourceReasons.googleNews = '검색 결과 0건';
  } catch (error) {
    sourceStatus.googleNews = 'unavailable';
    sourceReasons.googleNews = shortError(error);
    warnings.push(`Google News RSS ${region.id}: ${shortError(error)}`);
  }

  return {
    items: [],
    warnings,
    retryAfterUntil,
    sourceStatus,
    sourceReasons,
  };
}

function parseGdeltSeenDate(value) {
  if (!value || !/^\d{8}T\d{6}Z$/.test(value)) return new Date().toISOString();
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
}

function commaListFromEnv(name, fallback) {
  return (process.env[name] ?? fallback)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function validIsoDate(value, fallback) {
  const time = new Date(value ?? '').getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : fallback;
}

function numberField(record, keys) {
  for (const key of keys) {
    const value = Number(record?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

function copernicusCollections() {
  return commaListFromEnv('COPERNICUS_STAC_COLLECTIONS', 'sentinel-2-l2a,sentinel-1-grd');
}

function normalizeCopernicusFeature(feature, region, index, generatedAt) {
  const properties = feature?.properties ?? {};
  const collection = String(feature?.collection ?? properties.collection ?? 'copernicus');
  const id = String(feature?.id ?? `${collection}-${index + 1}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
  const observedAt = validIsoDate(
    properties.datetime ?? properties.start_datetime ?? properties.end_datetime,
    generatedAt,
  );
  const cloudCoverPct = numberField(properties, ['eo:cloud_cover', 'cloudCover', 'cloud_cover']);
  const link = (feature?.links ?? []).find((item) => item.rel === 'self' || item.rel === 'canonical')
    ?? (feature?.links ?? [])[0];
  const platform = String(
    properties.platform
      ?? properties.constellation
      ?? collection,
  );
  const productType = properties['product:type']
    ?? properties.productType
    ?? properties['processing:level'];

  return {
    id: `copernicus-${region.id}-${id}`.slice(0, 160),
    regionId: region.id,
    source: 'copernicus-stac-cache',
    provider: 'Copernicus Data Space',
    platform,
    productType: productType ? String(productType) : undefined,
    observedAt,
    cloudCoverPct: cloudCoverPct == null ? undefined : Math.round(cloudCoverPct * 10) / 10,
    bbox: Array.isArray(feature?.bbox) && feature.bbox.length === 4 ? feature.bbox : region.bbox,
    url: link?.href ?? `https://stac.dataspace.copernicus.eu/v1/collections/${collection}/items/${encodeURIComponent(id)}`,
    summary: `${collection} 공개 STAC 장면 메타데이터입니다. 자동 피해 판독이 아니라 촬영 가능성·시간·운량 맥락입니다.`,
  };
}

async function fetchCopernicusScenes(region, generatedAt) {
  const end = new Date(generatedAt);
  const start = new Date(end.getTime() - copernicusStacLookbackHours() * 60 * 60 * 1000);
  const json = await fetchJsonPost(copernicusStacSearchUrl, {
    collections: copernicusCollections(),
    bbox: region.bbox,
    datetime: `${start.toISOString()}/${end.toISOString()}`,
    limit: copernicusStacMaxScenesPerRegion(),
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
  }, { timeoutMs: 25000 });

  return (json.features ?? [])
    .map((feature, index) => normalizeCopernicusFeature(feature, region, index, generatedAt))
    .slice(0, copernicusStacMaxScenesPerRegion());
}

async function fetchCopernicusScenesWithCache(region, previousCache, generatedAt) {
  const previous = previousSatelliteScenes(previousCache, region.id);
  const previousUpdatedAt = previousSourceUpdatedAt(previousCache, region.id, 'copernicusStac');
  const nowMs = new Date(generatedAt).getTime();
  const minFetchMs = copernicusStacMinFetchIntervalMs();

  if (!boolFromEnv('COPERNICUS_STAC_FETCH_ENABLED', true)) {
    return {
      scenes: previous,
      status: previous.length > 0 ? 'cached' : 'disabled',
      updatedAt: previousUpdatedAt,
      reason: 'COPERNICUS_STAC_FETCH_ENABLED=false',
    };
  }

  if (isFresh(previousUpdatedAt, nowMs, minFetchMs)) {
    return {
      scenes: previous,
      status: previous.length > 0 ? 'cached' : 'empty',
      updatedAt: previousUpdatedAt,
      reason: `TTL ${Math.round(minFetchMs / 3600000)}시간 내 Copernicus STAC 캐시 재사용`,
    };
  }

  try {
    const scenes = await fetchCopernicusScenes(region, generatedAt);
    return {
      scenes,
      status: scenes.length > 0 ? 'live' : 'empty',
      updatedAt: generatedAt,
      reason: scenes.length > 0 ? undefined : 'Copernicus STAC AOI/기간 장면 0건',
    };
  } catch (error) {
    return {
      scenes: previous,
      status: previous.length > 0 ? 'cached' : 'unavailable',
      updatedAt: previousUpdatedAt,
      warning: `Copernicus STAC ${region.id}: ${shortError(error)}`,
      reason: shortError(error),
    };
  }
}

function firmsObservedAt(record, fallback) {
  const date = record.acq_date;
  const time = String(record.acq_time ?? '').padStart(4, '0');
  if (/^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{4}$/.test(time)) {
    return `${date}T${time.slice(0, 2)}:${time.slice(2, 4)}:00Z`;
  }
  return validIsoDate(date, fallback);
}

function firmsConfidence(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'h' || raw === 'high') return 0.85;
  if (raw === 'n' || raw === 'nominal') return 0.65;
  if (raw === 'l' || raw === 'low') return 0.45;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) return Math.max(0.2, Math.min(0.95, numeric / 100));
  return undefined;
}

function normalizeFirmsRecord(record, region, index, generatedAt) {
  const lat = Number(record.latitude);
  const lon = Number(record.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!pointInRegion(region, lat, lon, 0.2)) return null;
  const observedAt = firmsObservedAt(record, generatedAt);
  const satellite = String(record.satellite ?? record.instrument ?? process.env.NASA_FIRMS_SOURCE ?? 'VIIRS').trim();
  const frpMw = numberField(record, ['frp', 'FRP']);
  const brightnessKelvin = numberField(record, ['bright_ti4', 'bright_t31', 'brightness']);
  const idParts = [region.id, satellite, observedAt, index + 1]
    .join('-')
    .replace(/[^a-zA-Z0-9_.-]/g, '-');
  return {
    id: `firms-${idParts}`.slice(0, 160),
    regionId: region.id,
    source: 'nasa-firms-cache',
    provider: 'NASA FIRMS',
    lat,
    lon,
    observedAt,
    confidence: firmsConfidence(record.confidence),
    brightnessKelvin,
    frpMw,
    satellite,
    url: 'https://firms.modaps.eosdis.nasa.gov/map/',
  };
}

async function fetchNasaFirms(region, generatedAt) {
  const source = process.env.NASA_FIRMS_SOURCE ?? 'VIIRS_SNPP_NRT';
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  const area = [minLon, minLat, maxLon, maxLat].join(',');
  const dateSuffix = process.env.NASA_FIRMS_DATE ? `/${encodeURIComponent(process.env.NASA_FIRMS_DATE)}` : '';
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(process.env.NASA_FIRMS_MAP_KEY)}/${encodeURIComponent(source)}/${area}/${nasaFirmsDayRange()}${dateSuffix}`;
  const text = await fetchText(url, { timeoutMs: 25000 });
  if (/invalid|error|map[_ ]?key/i.test(text) && !/^latitude,longitude,/i.test(text.trim())) {
    throw new Error(text.trim().slice(0, 180));
  }
  return parseCsv(text)
    .map((record, index) => normalizeFirmsRecord(record, region, index, generatedAt))
    .filter(Boolean)
    .sort((a, b) => (b.frpMw ?? 0) - (a.frpMw ?? 0))
    .slice(0, nasaFirmsMaxRecordsPerRegion());
}

async function fetchNasaFirmsWithCache(region, previousCache, generatedAt) {
  const previous = previousThermalAnomalies(previousCache, region.id);
  const previousUpdatedAt = previousSourceUpdatedAt(previousCache, region.id, 'nasaFirms');
  const nowMs = new Date(generatedAt).getTime();
  const minFetchMs = nasaFirmsCacheTtlMs();

  if (!boolFromEnv('NASA_FIRMS_FETCH_ENABLED', true)) {
    return {
      thermalAnomalies: previous,
      status: previous.length > 0 ? 'cached' : 'disabled',
      updatedAt: previousUpdatedAt,
      reason: 'NASA_FIRMS_FETCH_ENABLED=false',
      warnings: [],
    };
  }

  if (!process.env.NASA_FIRMS_MAP_KEY) {
    return {
      thermalAnomalies: previous,
      status: previous.length > 0 ? 'cached' : 'disabled',
      updatedAt: previousUpdatedAt,
      reason: 'NASA_FIRMS_MAP_KEY 미설정',
      warnings: [],
    };
  }

  if (isFresh(previousUpdatedAt, nowMs, minFetchMs)) {
    return {
      thermalAnomalies: previous,
      status: previous.length > 0 ? 'cached' : 'empty',
      updatedAt: previousUpdatedAt,
      reason: `TTL ${Math.round(minFetchMs / 60000)}분 내 NASA FIRMS 캐시 재사용`,
      warnings: [],
    };
  }

  try {
    const thermalAnomalies = await fetchNasaFirms(region, generatedAt);
    return {
      thermalAnomalies,
      status: thermalAnomalies.length > 0 ? 'live' : 'empty',
      updatedAt: generatedAt,
      reason: thermalAnomalies.length > 0 ? undefined : 'NASA FIRMS AOI/기간 열 이상 0건',
      warnings: [],
    };
  } catch (error) {
    return {
      thermalAnomalies: previous,
      status: previous.length > 0 ? 'cached' : 'unavailable',
      updatedAt: previousUpdatedAt,
      reason: shortError(error),
      warnings: [`NASA FIRMS ${region.id}: ${shortError(error)}`],
    };
  }
}

async function fetchCelesTrakSample() {
  const json = await fetchJson('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json', { timeoutMs: 25000 });
  return json.slice(0, 32).map((sat) => ({
    raw: sat,
    name: sat.OBJECT_NAME,
    noradId: String(sat.NORAD_CAT_ID),
    epoch: sat.EPOCH,
    inclination: sat.INCLINATION,
    meanMotion: sat.MEAN_MOTION,
  }));
}

function haversineKm(aLat, aLon, bLat, bLon) {
  const toRad = (value) => value * Math.PI / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function propagatedSatellitePosition(item, observedAt) {
  if (!item?.raw) return null;
  const satrec = json2satrec(item.raw);
  const positionAndVelocity = propagate(satrec, observedAt);
  if (!positionAndVelocity?.position || satrec.error) return null;
  const geodetic = eciToGeodetic(positionAndVelocity.position, gstime(observedAt));
  return {
    lat: degreesLat(geodetic.latitude),
    lon: degreesLong(geodetic.longitude),
    altitudeKm: Math.max(0, Math.round(geodetic.height)),
  };
}

function satelliteGroundTrack(item, centerTime, spanMinutes = 72, stepMinutes = 6) {
  const points = [];
  for (let offset = -spanMinutes / 2; offset <= spanMinutes / 2; offset += stepMinutes) {
    const observedAt = new Date(centerTime.getTime() + offset * 60 * 1000);
    const position = propagatedSatellitePosition(item, observedAt);
    if (position) points.push([Number(position.lat.toFixed(4)), Number(position.lon.toFixed(4))]);
  }
  return points;
}

function satelliteLayerForRegion(region, celestrakSample, generatedAt) {
  const observedAt = new Date(generatedAt);
  if (region.global) {
    return celestrakSample
      .map((item) => ({ item, position: propagatedSatellitePosition(item, observedAt) }))
      .filter((candidate) => candidate.position)
      .slice(0, 6)
      .map(({ item, position }) => ({
        id: `live-sat-${region.id}-${item.noradId}`,
        source: 'celestrak-cache',
        name: item.name,
        noradId: item.noradId,
        observedAt: generatedAt,
        lat: position.lat,
        lon: position.lon,
        groundTrack: satelliteGroundTrack(item, observedAt),
        altitudeKm: position.altitudeKm,
        direction: `inclination ${Number(item.inclination).toFixed(1)}°; global public orbital awareness layer`,
        roleHint: 'public orbital awareness',
      }));
  }
  const [regionLat, regionLon] = region.center;
  const candidates = celestrakSample
    .map((item) => ({ item, position: propagatedSatellitePosition(item, observedAt) }))
    .filter((candidate) => candidate.position)
    .map((candidate) => ({
      ...candidate,
      distanceKm: haversineKm(regionLat, regionLon, candidate.position.lat, candidate.position.lon),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm);
  const selected = candidates[0];
  if (!selected) return [];
  const item = selected?.item;
  return [{
    id: `live-sat-${region.id}-${item.noradId}`,
    source: 'celestrak-cache',
    name: item.name,
    noradId: item.noradId,
    observedAt: generatedAt,
    lat: selected.position.lat,
    lon: selected.position.lon,
    groundTrack: satelliteGroundTrack(item, observedAt),
    altitudeKm: selected.position.altitudeKm,
    direction: `inclination ${Number(item.inclination).toFixed(1)}°; nearest station-group subpoint ${Math.round(selected.distanceKm).toLocaleString()}km from AOI center`,
    roleHint: 'public orbital awareness',
  }];
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  values.push(current);
  return values;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = parseCsvLine(lines.shift() || '');
  return lines.map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(header.map((key, index) => [key, values[index] ?? '']));
  });
}

async function fetchOurAirportsSample() {
  const csv = await fetchText('https://davidmegginson.github.io/ourairports-data/airports.csv', { timeoutMs: 30000 });
  return parseCsv(csv);
}

function normalizeAirportType(value) {
  return ['large_airport', 'medium_airport', 'small_airport', 'heliport', 'closed'].includes(value) ? value : 'unknown';
}

function airportRank(airport) {
  const typeRank = {
    large_airport: 0,
    medium_airport: 1,
    small_airport: 2,
    heliport: 3,
    unknown: 4,
    closed: 5,
  };
  return (airport.scheduledService ? 0 : 10) + (typeRank[airport.type] ?? 4);
}

const globalMajorAirportIdents = new Set([
  'KJFK',
  'EGLL',
  'LFPG',
  'EDDF',
  'OMDB',
  'OTHH',
  'VHHH',
  'RJTT',
  'RKSI',
  'RCTP',
  'WSSS',
  'YSSY',
]);

function airportLayerForRegion(region, airportRows) {
  if (region.global) {
    return airportRows
      .filter((row) => globalMajorAirportIdents.has(row.ident))
      .map((row) => {
        const lat = Number(row.latitude_deg);
        const lon = Number(row.longitude_deg);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return {
          id: `apt-${region.id}-${String(row.ident || row.id).toLowerCase()}`,
          source: 'ourairports-cache',
          ident: row.ident || row.gps_code || row.local_code || 'UNK',
          name: row.name || 'Unknown airport',
          type: normalizeAirportType(row.type),
          lat,
          lon,
          elevationFt: row.elevation_ft ? Number(row.elevation_ft) : undefined,
          municipality: row.municipality || undefined,
          isoCountry: row.iso_country || undefined,
          scheduledService: row.scheduled_service === 'yes',
          url: row.wikipedia_link || `https://ourairports.com/airports/${encodeURIComponent(row.ident || '')}/`,
        };
      })
      .filter(Boolean)
      .sort((a, b) => airportRank(a) - airportRank(b))
      .slice(0, 12);
  }
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  const margin = region.id === 'west-sea-nll' ? 1.4 : 0.25;
  const airports = airportRows
    .map((row) => {
      const lat = Number(row.latitude_deg);
      const lon = Number(row.longitude_deg);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: `apt-${region.id}-${String(row.ident || row.id).toLowerCase()}`,
        source: 'ourairports-cache',
        ident: row.ident || row.gps_code || row.local_code || 'UNK',
        name: row.name || 'Unknown airport',
        type: normalizeAirportType(row.type),
        lat,
        lon,
        elevationFt: row.elevation_ft ? Number(row.elevation_ft) : undefined,
        municipality: row.municipality || undefined,
        isoCountry: row.iso_country || undefined,
        scheduledService: row.scheduled_service === 'yes',
        url: row.wikipedia_link || `https://ourairports.com/airports/${encodeURIComponent(row.ident || '')}/`,
      };
    })
    .filter(Boolean)
    .filter((airport) => airport.lat >= minLat - margin && airport.lat <= maxLat + margin && airport.lon >= minLon - margin && airport.lon <= maxLon + margin)
    .sort((a, b) => airportRank(a) - airportRank(b))
    .slice(0, 8);

  return airports;
}

function airRouteLayerForRegion(region, airports) {
  const visibleAirports = airports.filter((airport) => airport.source === 'ourairports-cache').slice(0, 4);
  if (visibleAirports.length >= 2) {
    return [{
      id: `route-${region.id}-airport-axis`,
      regionId: region.id,
      source: 'ourairports-derived-route',
      name: '공항 연결 참고 항로',
      description: 'OurAirports 공항 좌표를 연결한 공개 데이터 기반 이동 축입니다. 공식 항공로/관제 경로는 아닙니다.',
      points: visibleAirports.map((airport) => [airport.lat, airport.lon]),
      corridorKm: 35,
      sourceUrl: 'https://ourairports.com/data/',
    }];
  }
  return [];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const globalOsintHotspots = [
  { name: 'North Atlantic', lat: 52, lon: -32 },
  { name: 'Baltic / Northern Europe', lat: 57, lon: 20 },
  { name: 'Black Sea', lat: 44, lon: 33 },
  { name: 'Eastern Mediterranean', lat: 34, lon: 31 },
  { name: 'Red Sea / Bab el-Mandeb', lat: 15, lon: 42 },
  { name: 'Persian Gulf', lat: 26, lon: 52 },
  { name: 'Indian Ocean', lat: 4, lon: 73 },
  { name: 'South China Sea', lat: 12, lon: 114 },
  { name: 'Taiwan Strait', lat: 24, lon: 120 },
  { name: 'Korean Peninsula / KADIZ', lat: 38, lon: 126 },
  { name: 'Western Pacific', lat: 22, lon: 145 },
  { name: 'Eastern Pacific', lat: 28, lon: -125 },
];

function osintReviewPoint(region, index) {
  if (region.global) {
    const base = globalOsintHotspots[index % globalOsintHotspots.length];
    const drift = Math.floor(index / globalOsintHotspots.length) * 1.4;
    return {
      lat: clamp(base.lat + Math.sin(index * 1.7) * (0.8 + drift), -58, 80),
      lon: clamp(base.lon + Math.cos(index * 1.3) * (1.2 + drift), -178, 178),
      hotspot: base.name,
    };
  }
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  const [centerLat, centerLon] = region.center;
  const latSpan = Math.max(0.08, maxLat - minLat);
  const lonSpan = Math.max(0.08, maxLon - minLon);
  const angle = (index * 137.508) * Math.PI / 180;
  const radius = 0.08 + (index % 5) * 0.035;
  const lat = clamp(centerLat + Math.sin(angle) * latSpan * radius, minLat + latSpan * 0.08, maxLat - latSpan * 0.08);
  const lon = clamp(centerLon + Math.cos(angle) * lonSpan * radius, minLon + lonSpan * 0.08, maxLon - lonSpan * 0.08);
  return { lat, lon };
}

function osintEventLayerForRegion(region, osintItems) {
  const limit = region.global ? 12 : 8;
  return (osintItems ?? []).slice(0, limit).map((item, index) => {
    const point = osintReviewPoint(region, index);
    return {
      id: `osint-review-${item.id}`,
      regionId: region.id,
      source: item.source,
      title: item.title,
      lat: point.lat,
      lon: point.lon,
      observedAt: item.publishedAt,
      confidence: item.confidence,
      relatedOsintId: item.id,
      domain: item.domain,
      url: item.url,
      tags: [...new Set([
        ...(item.tags ?? []),
        region.global ? 'global-review-point' : 'aoi-review-point',
        ...(point.hotspot ? [point.hotspot] : []),
        'not-geocoded',
      ])],
    };
  });
}

function aisStreamFetchMs() {
  return parsePositiveInteger(process.env.AISSTREAM_FETCH_MS, 20000);
}

function aisStreamMaxShipsPerRegion() {
  return parsePositiveInteger(process.env.AISSTREAM_MAX_SHIPS_PER_REGION, 30);
}

function aisStreamBoundingBoxes(region) {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return [[[minLat, minLon], [maxLat, maxLon]]];
}

function pointInRegion(region, lat, lon, marginDegrees = 0.05) {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return lat >= minLat - marginDegrees
    && lat <= maxLat + marginDegrees
    && lon >= minLon - marginDegrees
    && lon <= maxLon + marginDegrees;
}

function parseAisTimestamp(value, fallback) {
  if (!value) return fallback;
  const direct = new Date(value).getTime();
  if (Number.isFinite(direct)) return new Date(direct).toISOString();
  const normalized = String(value)
    .replace(' +0000 UTC', 'Z')
    .replace(' UTC', 'Z')
    .replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T');
  const normalizedTime = new Date(normalized).getTime();
  return Number.isFinite(normalizedTime) ? new Date(normalizedTime).toISOString() : fallback;
}

function normalizeHeading(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(((number % 360) + 360) % 360);
}

function normalizeAisVesselType(body) {
  const rawType = Number(body?.Type ?? body?.ShipType ?? body?.Shiptype);
  if (!Number.isFinite(rawType)) return 'unknown';
  if (rawType === 30) return 'fishing';
  if (rawType >= 70 && rawType <= 79) return 'cargo';
  if (rawType >= 80 && rawType <= 89) return 'tanker';
  return 'unknown';
}

function normalizeAisMessage(raw, region, generatedAt) {
  if (raw?.error) throw new Error(`AISStream error: ${raw.error}`);
  const messageType = raw?.MessageType;
  const body = raw?.Message?.[messageType] ?? raw?.Message?.PositionReport ?? raw?.Message ?? {};
  const metadata = raw?.MetaData ?? raw?.Metadata ?? {};
  const lat = Number(body.Latitude ?? body.latitude ?? metadata.Latitude ?? metadata.latitude);
  const lon = Number(body.Longitude ?? body.longitude ?? metadata.Longitude ?? metadata.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!pointInRegion(region, lat, lon)) return null;
  const mmsi = String(body.UserID ?? metadata.MMSI ?? metadata.Mmsi ?? metadata.UserID ?? '').trim();
  if (!mmsi) return null;
  const rawName = String(body.Name ?? metadata.ShipName ?? metadata.ShipNameRaw ?? '').trim();
  const name = rawName && rawName !== '[CLASS B]' ? rawName : `MMSI ${mmsi}`;
  const speedKnots = Number(body.Sog ?? body.SOG ?? body.SpeedOverGround ?? 0);
  const courseDeg = normalizeHeading(body.Cog ?? body.COG ?? body.CourseOverGround ?? body.TrueHeading ?? 0);
  return {
    id: `ais-${region.id}-${mmsi}`,
    source: 'ais-cache',
    name,
    mmsi,
    vesselType: normalizeAisVesselType(body),
    notes: `AISStream live ${messageType ?? 'AIS'} message. Public receiver coverage is incomplete.`,
    points: [{
      lat,
      lon,
      speedKnots: Math.max(0, Math.round((Number.isFinite(speedKnots) ? speedKnots : 0) * 10) / 10),
      courseDeg,
      observedAt: parseAisTimestamp(metadata.time_utc ?? metadata.TimeUtc ?? metadata.timestamp, generatedAt),
    }],
  };
}

function mergeShipPosition(existing, incoming) {
  const pointsByTime = new Map(existing.points.map((point) => [point.observedAt, point]));
  for (const point of incoming.points) pointsByTime.set(point.observedAt, point);
  return {
    ...existing,
    name: incoming.name.startsWith('MMSI ') ? existing.name : incoming.name,
    vesselType: incoming.vesselType === 'unknown' ? existing.vesselType : incoming.vesselType,
    notes: incoming.notes,
    points: [...pointsByTime.values()]
      .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime())
      .slice(-6),
  };
}

async function fetchAisStream(region, previousCache, generatedAt) {
  const previous = previousShips(previousCache, region.id);
  const previousUpdatedAt = previousSourceUpdatedAt(previousCache, region.id, 'ais');
  const previousFresh = previous.length > 0 && isFresh(previousUpdatedAt, new Date(generatedAt).getTime(), aisCacheTtlMs());

  if (!boolFromEnv('AISSTREAM_FETCH_ENABLED', true)) {
    return {
      ships: previousFresh ? previous : [],
      status: previousFresh ? 'cached' : 'disabled',
      updatedAt: previousFresh ? previousUpdatedAt : undefined,
      reason: 'AISSTREAM_FETCH_ENABLED=false',
      warnings: [],
    };
  }
  if (!process.env.AISSTREAM_API_KEY) {
    return {
      ships: previousFresh ? previous : [],
      status: previousFresh ? 'cached' : 'disabled',
      updatedAt: previousFresh ? previousUpdatedAt : undefined,
      reason: 'AISSTREAM_API_KEY 미설정',
      warnings: [],
    };
  }

  const timeoutMs = aisStreamFetchMs();
  const maxShips = aisStreamMaxShipsPerRegion();
  return new Promise((resolve) => {
    const shipsById = new Map();
    let opened = false;
    let settled = false;
    let socket;

    const finish = (status, warning) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket && socket.readyState === WebSocket.OPEN) socket.close(1000, 'AirMaven fetch window complete');
      const ships = [...shipsById.values()]
        .sort((a, b) => (b.points.at(-1)?.speedKnots ?? 0) - (a.points.at(-1)?.speedKnots ?? 0))
        .slice(0, maxShips);
      if (ships.length > 0) {
        resolve({ ships, status: 'live', updatedAt: generatedAt, warnings: warning ? [warning] : [] });
        return;
      }
      if (opened && previousFresh) {
        resolve({
          ships: previous,
          status: 'cached',
          updatedAt: previousUpdatedAt,
          reason: `이번 ${Math.round(timeoutMs / 1000)}초 window 수신 0; 직전 AIS 캐시 유지`,
          warnings: warning ? [warning] : [],
        });
        return;
      }
      if (opened) {
        resolve({
          ships: [],
          status: 'empty',
          updatedAt: generatedAt,
          reason: `WebSocket 연결 성공, ${Math.round(timeoutMs / 1000)}초 window 수신 0`,
          warnings: warning ? [warning] : [],
        });
        return;
      }
      resolve({
        ships: [],
        status,
        reason: warning ?? 'AISStream 연결 실패',
        warnings: warning ? [warning] : [],
      });
    };

    const timer = setTimeout(() => finish(opened ? 'live' : 'unavailable'), timeoutMs);
    socket = new WebSocket('wss://stream.aisstream.io/v0/stream', {
      headers: { 'user-agent': userAgent },
    });

    socket.on('open', () => {
      opened = true;
      socket.send(JSON.stringify({
        APIKey: process.env.AISSTREAM_API_KEY,
        BoundingBoxes: aisStreamBoundingBoxes(region),
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
        const raw = JSON.parse(data.toString());
        const ship = normalizeAisMessage(raw, region, generatedAt);
        if (!ship) return;
        const existing = shipsById.get(ship.id);
        shipsById.set(ship.id, existing ? mergeShipPosition(existing, ship) : ship);
        if (shipsById.size >= maxShips) finish('live');
      } catch (error) {
        finish('unavailable', `AISStream ${region.id}: ${shortError(error)}`);
      }
    });

    socket.on('error', (error) => {
      finish(opened && shipsById.size > 0 ? 'live' : 'unavailable', `AISStream ${region.id}: ${shortError(error)}`);
    });

    socket.on('close', () => {
      if (!settled) finish(opened ? 'live' : 'unavailable');
    });
  });
}

function fillTemplate(template, region, location) {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return template
    .replaceAll('{regionId}', encodeURIComponent(region.id))
    .replaceAll('{location}', encodeURIComponent(location ?? ''))
    .replaceAll('{icao}', encodeURIComponent(location ?? ''))
    .replaceAll('{minLat}', encodeURIComponent(String(minLat)))
    .replaceAll('{minLon}', encodeURIComponent(String(minLon)))
    .replaceAll('{maxLat}', encodeURIComponent(String(maxLat)))
    .replaceAll('{maxLon}', encodeURIComponent(String(maxLon)))
    .replaceAll('{apiKey}', encodeURIComponent(process.env.ICAO_API_KEY ?? ''));
}

function icaoNotamUrlsForRegion(region) {
  const endpoint = process.env.ICAO_NOTAM_ENDPOINT;
  if (!endpoint) return [];
  const maxLocations = parsePositiveInteger(process.env.ICAO_NOTAM_MAX_LOCATIONS_PER_REGION, 2);
  if (endpoint.includes('{location}') || endpoint.includes('{icao}')) {
    return region.notamLocations
      .slice(0, maxLocations)
      .map((location) => fillTemplate(endpoint, region, location));
  }
  return [fillTemplate(endpoint, region, region.notamLocations[0])];
}

function withIcaoAuth(urlString) {
  const authMode = (process.env.ICAO_API_KEY_AUTH ?? 'query').toLowerCase();
  const headers = {};
  const url = new URL(urlString);
  if (authMode === 'bearer') {
    headers.authorization = `Bearer ${process.env.ICAO_API_KEY}`;
  } else if (authMode === 'header') {
    headers[process.env.ICAO_API_KEY_HEADER ?? 'x-api-key'] = process.env.ICAO_API_KEY;
  } else if (!url.searchParams.has(process.env.ICAO_API_KEY_PARAM ?? 'api_key')) {
    url.searchParams.set(process.env.ICAO_API_KEY_PARAM ?? 'api_key', process.env.ICAO_API_KEY);
  }
  return { url: url.toString(), headers };
}

function icaoApiBaseUrl() {
  return (process.env.ICAO_API_BASE_URL ?? 'https://dataservices.icao.int/api').replace(/\/+$/, '');
}

function icaoFirMinFetchIntervalMs() {
  return parsePositiveInteger(process.env.ICAO_FIR_MIN_FETCH_INTERVAL_MS, 24 * 60 * 60 * 1000);
}

function normalizeIcaoFirRecord(record, region, index, generatedAt) {
  const [lat, lon] = region.center;
  const icaoCode = String(record?.ICAOCODE ?? record?.icaoCode ?? record?.icao_code ?? record?.code ?? '').trim();
  const firName = String(record?.FIR_name ?? record?.firName ?? record?.fir_name ?? record?.name ?? '').trim();
  if (!icaoCode && !firName) return null;
  return {
    id: `icao-fir-${region.id}-${String(icaoCode || index + 1).toLowerCase()}`,
    regionId: region.id,
    source: 'icao-fir-cache',
    icaoCode: icaoCode || 'UNKNOWN',
    firName: firName || 'UNKNOWN',
    state: record?.State ?? record?.state,
    icaoRegion: record?.ICAO_Region ?? record?.icaoRegion ?? record?.icao_region,
    type: record?.Type ?? record?.type,
    lat,
    lon,
    observedAt: generatedAt,
  };
}

async function fetchIcaoFir(region, generatedAt) {
  const [lat, lon] = region.center;
  const url = new URL(`${icaoApiBaseUrl()}/fir-by-location`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lon));
  url.searchParams.set('api_key', process.env.ICAO_API_KEY);
  const json = await fetchJson(url, { timeoutMs: 20000 });
  return (Array.isArray(json) ? json : recordsFromIcaoPayload(json))
    .map((record, index) => normalizeIcaoFirRecord(record, region, index, generatedAt))
    .filter(Boolean);
}

async function fetchIcaoFirWithCache(region, previousCache, generatedAt) {
  const previousItems = previousAirspaceContexts(previousCache, region.id);
  const previousUpdatedAt = previousSourceUpdatedAt(previousCache, region.id, 'icaoFir');
  const nowMs = new Date(generatedAt).getTime();
  const minFetchMs = icaoFirMinFetchIntervalMs();

  if (!boolFromEnv('ICAO_FIR_FETCH_ENABLED', true)) {
    return {
      items: previousItems,
      status: previousItems.length > 0 ? 'cached' : 'disabled',
      updatedAt: previousUpdatedAt,
      warning: 'ICAO FIR disabled by ICAO_FIR_FETCH_ENABLED=false',
      reason: 'ICAO_FIR_FETCH_ENABLED=false',
    };
  }

  if (!process.env.ICAO_API_KEY) {
    return {
      items: previousItems,
      status: previousItems.length > 0 ? 'cached' : 'disabled',
      updatedAt: previousUpdatedAt,
      warning: 'ICAO FIR disabled: ICAO_API_KEY missing',
      reason: 'ICAO_API_KEY 미설정',
    };
  }

  if (previousItems.length > 0 && isFresh(previousUpdatedAt, nowMs, minFetchMs)) {
    return {
      items: previousItems,
      status: 'cached',
      updatedAt: previousUpdatedAt,
      warning: `ICAO FIR ${region.id}: reused cache; min interval ${Math.round(minFetchMs / 3600000)}h`,
      reason: `TTL ${Math.round(minFetchMs / 3600000)}시간 내 캐시 재사용`,
    };
  }

  try {
    const items = await fetchIcaoFir(region, generatedAt);
    return {
      items,
      status: items.length > 0 ? 'live' : 'unavailable',
      updatedAt: items.length > 0 ? generatedAt : previousUpdatedAt,
      warning: items.length > 0 ? undefined : `ICAO FIR ${region.id}: no FIR returned for AOI center`,
      reason: items.length > 0 ? undefined : 'AOI 중심점 FIR 결과 0건',
    };
  } catch (error) {
    return {
      items: previousItems,
      status: previousItems.length > 0 ? 'cached' : 'unavailable',
      updatedAt: previousUpdatedAt,
      warning: `ICAO FIR ${region.id}: ${shortError(error)}`,
      reason: shortError(error),
    };
  }
}

function parseMaybeJsonOrCsv(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  return parseCsv(trimmed);
}

function recordsFromIcaoPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (payload.type === 'FeatureCollection' && Array.isArray(payload.features)) {
    return payload.features.map((feature) => ({
      ...(feature.properties ?? {}),
      geometry: feature.geometry,
    }));
  }
  for (const key of ['data', 'Data', 'result', 'results', 'items', 'notams', 'NOTAMS', 'features']) {
    if (Array.isArray(payload[key])) {
      return key === 'features'
        ? payload[key].map((feature) => ({ ...(feature.properties ?? feature), geometry: feature.geometry }))
        : payload[key];
    }
  }
  return [payload];
}

function parseDateField(record, names, fallback) {
  for (const name of names) {
    const value = record?.[name];
    if (!value) continue;
    const time = new Date(value).getTime();
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return fallback;
}

function flattenGeoJsonPositions(geometry, out = []) {
  if (!geometry) return out;
  if (geometry.type === 'GeometryCollection') {
    for (const child of geometry.geometries ?? []) flattenGeoJsonPositions(child, out);
    return out;
  }
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
      out.push({ lon: value[0], lat: value[1] });
      return;
    }
    for (const child of value) visit(child);
  };
  visit(geometry.coordinates);
  return out;
}

function centerOfPositions(positions) {
  if (!positions.length) return null;
  const lat = positions.reduce((sum, point) => sum + point.lat, 0) / positions.length;
  const lon = positions.reduce((sum, point) => sum + point.lon, 0) / positions.length;
  return { lat, lon };
}

function radiusKmFromPositions(center, positions) {
  if (!center || positions.length === 0) return 5;
  return Math.max(5, Math.min(250, Math.ceil(Math.max(
    ...positions.map((point) => haversineKm(center.lat, center.lon, point.lat, point.lon)),
  ))));
}

function directNumber(record, names) {
  for (const name of names) {
    const value = Number(record?.[name]);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function noticeSeverity(text) {
  const upper = text.toUpperCase();
  if (/(CLOSED|PROHIBITED|DANGER|MISSILE|FIRING|RESTRICTED|HAZARD)/.test(upper)) return 'warning';
  if (/(EXERCISE|WARNING|OBSTACLE|RUNWAY|NAV|UAS|DRONE)/.test(upper)) return 'watch';
  return 'info';
}

function normalizeIcaoNotice(record, region, index, generatedAt) {
  const geometryPositions = flattenGeoJsonPositions(record.geometry);
  const geometryCenter = centerOfPositions(geometryPositions);
  const directLat = directNumber(record, ['lat', 'latitude', 'Latitude', 'LATITUDE']);
  const directLon = directNumber(record, ['lon', 'lng', 'longitude', 'Longitude', 'LONGITUDE']);
  const center = directLat != null && directLon != null ? { lat: directLat, lon: directLon } : geometryCenter;
  if (!center || !pointInRegion(region, center.lat, center.lon, 1.5)) return null;
  const text = String(
    record.text
      ?? record.message
      ?? record.notamText
      ?? record.NOTAM_TEXT
      ?? record.description
      ?? record.Desc
      ?? record.E
      ?? '',
  ).replace(/\s+/g, ' ').trim();
  const title = String(
    record.title
      ?? record.subject
      ?? record.qcode
      ?? record.QCODE
      ?? record.NOTAM_ID
      ?? record.id
      ?? `ICAO NOTAM ${index + 1}`,
  ).replace(/\s+/g, ' ').trim();
  const radiusFromField = directNumber(record, ['radiusKm', 'radius_km', 'RadiusKm']);
  const radiusNm = directNumber(record, ['radiusNm', 'radius_nm', 'RADIUS_NM']);
  const radiusKm = radiusFromField
    ?? (radiusNm != null ? radiusNm * 1.852 : radiusKmFromPositions(center, geometryPositions));

  return {
    id: `icao-notam-${region.id}-${String(record.id ?? record.NOTAM_ID ?? record.number ?? index + 1).replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    regionId: region.id,
    source: 'icao-notam-cache',
    title: title.slice(0, 140),
    description: (text || title).slice(0, 320),
    publishedAt: parseDateField(record, ['publishedAt', 'issued', 'issueDate', 'created', 'lastUpdated', 'LAST_UPDATED'], generatedAt),
    effectiveFrom: parseDateField(record, ['effectiveFrom', 'effectiveStart', 'startTime', 'B'], undefined),
    effectiveTo: parseDateField(record, ['effectiveTo', 'effectiveEnd', 'endTime', 'C'], undefined),
    lat: center.lat,
    lon: center.lon,
    radiusKm: Math.max(1, Math.round(radiusKm)),
    severity: noticeSeverity(`${title} ${text}`),
    url: record.url ?? record.URL,
  };
}

async function fetchIcaoNotams(region, generatedAt) {
  if (!boolFromEnv('ICAO_NOTAM_FETCH_ENABLED', true)) {
    return { notices: [], status: 'disabled', reason: 'ICAO_NOTAM_FETCH_ENABLED=false', warnings: [] };
  }
  if (!process.env.ICAO_API_KEY) {
    return { notices: [], status: 'disabled', reason: 'ICAO_API_KEY 미설정', warnings: [] };
  }
  const urls = icaoNotamUrlsForRegion(region);
  if (urls.length === 0) {
    return {
      notices: [],
      status: 'unsupported',
      reason: '현재 ICAO 서비스 목록에 NOTAM endpoint 없음',
      warnings: [],
    };
  }

  const warnings = [];
  const notices = [];
  const maxNotices = parsePositiveInteger(process.env.ICAO_NOTAM_MAX_PER_REGION, 8);
  for (const rawUrl of urls) {
    try {
      const { url, headers } = withIcaoAuth(rawUrl);
      const text = await fetchText(url, { timeoutMs: 20000, headers });
      const payload = parseMaybeJsonOrCsv(text);
      const records = recordsFromIcaoPayload(payload);
      for (const [index, record] of records.entries()) {
        const notice = normalizeIcaoNotice(record, region, notices.length + index, generatedAt);
        if (notice) notices.push(notice);
        if (notices.length >= maxNotices) break;
      }
    } catch (error) {
      warnings.push(`ICAO NOTAM ${region.id}: ${shortError(error)}`);
    }
    if (notices.length >= maxNotices) break;
  }

  const deduped = [...new Map(notices.map((notice) => [notice.id, notice])).values()].slice(0, maxNotices);
  if (deduped.length === 0 && warnings.length === 0) {
    warnings.push(`ICAO NOTAM ${region.id}: no geocoded notices returned`);
  }
  return {
    notices: deduped,
    status: deduped.length > 0 ? 'live' : warnings.length === urls.length ? 'unavailable' : 'empty',
    reason: deduped.length > 0 ? undefined : warnings.at(0) ?? 'geocoded NOTAM 0건',
    warnings,
  };
}

function sourceUpdatedAt(sourceStatus, generatedAt) {
  return Object.fromEntries(
    Object.entries(sourceStatus)
      .filter(([, status]) => status === 'live' || status === 'empty')
      .map(([source]) => [source, generatedAt]),
  );
}

function shouldRecordWarning(message) {
  if (!message) return false;
  return !/reused cache|min interval|backoff active/i.test(message);
}

async function main() {
  await readEnv();
  const generatedAt = new Date().toISOString();
  const previousCache = await readPreviousCache();
  const celestrakResult = await safeStep('CelesTrak', fetchCelesTrakSample, []);
  const airportsResult = await safeStep('OurAirports', fetchOurAirportsSample, []);
  const regionsOut = {};
  const errors = [];
  const rateLimitState = {};
  if (!celestrakResult.ok) errors.push(celestrakResult.error);
  if (!airportsResult.ok) errors.push(airportsResult.error);
  if (process.env.OPENSKY_USERNAME || process.env.OPENSKY_PASSWORD) {
    errors.push('OpenSky Basic Auth env vars are ignored; use OPENSKY_CLIENT_ID and OPENSKY_CLIENT_SECRET for OAuth2.');
  }

  for (const region of regions) {
    const [
      openSkyResult,
      weatherResult,
      osintResult,
      copernicusResult,
      firmsResult,
      aisResult,
      icaoFirResult,
      notamResult,
    ] = await Promise.all([
      region.global
        ? Promise.resolve(standbyDetailLayer('OpenSky', previousOpenSkyTracks(previousCache, region.id)))
        : fetchOpenSkyWithCache(region, previousCache, generatedAt),
      region.global
        ? Promise.resolve({ ok: true, value: null })
        : safeStep(`Open-Meteo ${region.id}`, () => fetchOpenMeteo(region), null),
      safeStep(`OSINT ${region.id}`, () => fetchOsint(region, previousCache, generatedAt), {
        items: [],
        warnings: [],
        sourceStatus: { gdelt: 'unavailable', googleNews: 'unavailable' },
        sourceReasons: { gdelt: 'OSINT 수집 실패', googleNews: 'OSINT 수집 실패' },
      }),
      region.global
        ? Promise.resolve(standbySatelliteSceneLayer(region, previousCache))
        : fetchCopernicusScenesWithCache(region, previousCache, generatedAt),
      region.global
        ? Promise.resolve(standbyThermalLayer(region, previousCache))
        : fetchNasaFirmsWithCache(region, previousCache, generatedAt),
      region.global
        ? Promise.resolve({ ok: true, value: standbyAisLayer(region, previousCache) })
        : safeStep(`AISStream ${region.id}`, () => fetchAisStream(region, previousCache, generatedAt), {
          ships: [],
          status: 'unavailable',
          reason: 'AISStream 수집 실패',
          warnings: [],
        }),
      region.global
        ? Promise.resolve(standbyFirLayer(region, previousCache))
        : fetchIcaoFirWithCache(region, previousCache, generatedAt),
      region.global
        ? Promise.resolve({ ok: true, value: standbyNoticeLayer() })
        : safeStep(`ICAO NOTAM ${region.id}`, () => fetchIcaoNotams(region, generatedAt), {
          notices: [],
          status: 'unavailable',
          reason: 'ICAO NOTAM 수집 실패',
          warnings: [],
        }),
    ]);
    for (const result of [weatherResult, osintResult, aisResult, notamResult]) {
      if (!result.ok) errors.push(result.error);
    }
    if (shouldRecordWarning(openSkyResult.warning)) errors.push(openSkyResult.warning);
    if (shouldRecordWarning(copernicusResult.warning)) errors.push(copernicusResult.warning);
    if (shouldRecordWarning(icaoFirResult.warning)) errors.push(icaoFirResult.warning);
    if (openSkyResult.retryAfterUntil) {
      rateLimitState.opensky = {
        retryAfterUntil: openSkyResult.retryAfterUntil,
        authMode: openSkyAuthMode(),
      };
    }
    if (osintResult.value.retryAfterUntil) {
      rateLimitState.gdelt = {
        retryAfterUntil: osintResult.value.retryAfterUntil,
      };
    }
    errors.push(...osintResult.value.warnings);
    errors.push(...firmsResult.warnings);
    errors.push(...aisResult.value.warnings);
    errors.push(...notamResult.value.warnings);
    const ships = aisResult.value.ships;
    const airspaceContexts = icaoFirResult.items;
    const satelliteScenes = copernicusResult.scenes;
    const thermalAnomalies = firmsResult.thermalAnomalies;
    const airports = airportLayerForRegion(region, airportsResult.value);
    const airRoutes = airRouteLayerForRegion(region, airports);
    const osintEvents = osintEventLayerForRegion(region, osintResult.value.items);
    const notices = notamResult.value.notices;
    const sourceStatus = {
      opensky: openSkyResult.status,
      openMeteo: region.global ? 'standby' : weatherResult.ok ? 'live' : 'unavailable',
      ...osintResult.value.sourceStatus,
      celestrak: celestrakResult.ok && celestrakResult.value.length > 0 ? 'live' : 'unavailable',
      copernicusStac: copernicusResult.status,
      nasaFirms: firmsResult.status,
      ais: aisResult.value.status,
      icaoFir: icaoFirResult.status,
      ourAirports: airportsResult.ok ? 'live' : 'unavailable',
      airRoutes: airportsResult.ok && airRoutes.length > 0 ? 'live' : 'unavailable',
      notices: notamResult.value.status,
      osintEvents: osintEvents.length > 0 ? 'live' : 'empty',
    };
    const sourceReasons = {
      ...(openSkyResult.reason ? { opensky: openSkyResult.reason } : {}),
      ...(region.global
        ? { openMeteo: '전세계 단일 중심점 기상은 의미가 낮아 비활성입니다. 상세 AOI에서 조회합니다.' }
        : weatherResult.ok ? {} : { openMeteo: weatherResult.error }),
      ...(osintResult.value.sourceReasons ?? {}),
      ...(copernicusResult.reason ? { copernicusStac: copernicusResult.reason } : {}),
      ...(firmsResult.reason ? { nasaFirms: firmsResult.reason } : {}),
      ...(aisResult.value.reason ? { ais: aisResult.value.reason } : {}),
      ...(icaoFirResult.reason ? { icaoFir: icaoFirResult.reason } : {}),
      ...(celestrakResult.ok ? {} : { celestrak: celestrakResult.error }),
      ...(airportsResult.ok ? {} : { ourAirports: airportsResult.error }),
      ...(notamResult.value.reason ? { notices: notamResult.value.reason } : {}),
      ...(osintEvents.length > 0
        ? { osintEvents: 'OSINT 기사 기반 AOI 검토 포인트입니다. 기사 본문 자동 지오코딩/정확 위치 주장은 하지 않습니다.' }
        : { osintEvents: 'OSINT 기사 없음 또는 공개 피드 수집 실패' }),
    };
    const updatedAt = sourceUpdatedAt(sourceStatus, generatedAt);
    if (openSkyResult.updatedAt) updatedAt.opensky = openSkyResult.updatedAt;
    if (copernicusResult.updatedAt) updatedAt.copernicusStac = copernicusResult.updatedAt;
    if (firmsResult.updatedAt) updatedAt.nasaFirms = firmsResult.updatedAt;
    if (aisResult.value.updatedAt) updatedAt.ais = aisResult.value.updatedAt;
    if (icaoFirResult.updatedAt) updatedAt.icaoFir = icaoFirResult.updatedAt;
    regionsOut[region.id] = {
      tracks: openSkyResult.value,
      ships,
      weather: weatherResult.value,
      osint: osintResult.value.items,
      osintEvents,
      satellites: satelliteLayerForRegion(region, celestrakResult.value, generatedAt),
      satelliteScenes,
      thermalAnomalies,
      airports,
      airRoutes,
      notices,
      airspaceContexts,
      sourceStatus,
      sourceReasons,
      sourceUpdatedAt: updatedAt,
    };
  }

  const payload = {
    schemaVersion: 1,
    generatedAt,
    mode: 'public-live-cache',
    refreshPolicy: {
      browserPollMs: 30_000,
      recommendedFetchLoopMs: 300_000,
      openSkyMinFetchIntervalMs: openSkyMinFetchIntervalMs(),
      openSkyMaxTracksPerRegion: openSkyMaxTracksPerRegion(),
      copernicusStacMinFetchIntervalMs: copernicusStacMinFetchIntervalMs(),
      copernicusStacMaxScenesPerRegion: copernicusStacMaxScenesPerRegion(),
      copernicusStacLookbackHours: copernicusStacLookbackHours(),
      nasaFirmsCacheTtlMs: nasaFirmsCacheTtlMs(),
      nasaFirmsDayRange: nasaFirmsDayRange(),
      nasaFirmsMaxRecordsPerRegion: nasaFirmsMaxRecordsPerRegion(),
      aisStreamFetchMs: aisStreamFetchMs(),
      aisStreamMaxShipsPerRegion: aisStreamMaxShipsPerRegion(),
      aisStreamCacheTtlMs: aisCacheTtlMs(),
      gdeltBackoffMs: gdeltBackoffMs(),
      icaoFirMinFetchIntervalMs: icaoFirMinFetchIntervalMs(),
    },
    note: 'Public API cache generated by scripts/fetch-live-data.mjs. OpenSky is TTL-cached and rate-limit aware; AISStream is collected server-side via WebSocket when configured. Generated placeholder layers are disabled; unavailable sources produce empty layers.',
    regions: regionsOut,
    rateLimitState,
    errors,
  };
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
  console.log(`Sources with warnings: ${errors.length}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
