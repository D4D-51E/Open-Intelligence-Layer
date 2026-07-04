const liveCacheKeyDefault = 'airmaven:live-scenarios';
const refreshIndexKey = 'airmaven:refresh-index';
const userAgent = 'AirMaven-Lite-Cloudflare-Worker/0.1 public-osint-real-data';

const regions = [
  {
    id: 'global',
    bbox: [-180, -60, 180, 82],
    center: [20, 20],
    newsQuery: 'military aircraft airspace maritime security naval exercise',
    global: true,
    osintLimit: 12,
  },
  {
    id: 'taiwan-strait',
    bbox: [118.4271213, 23.4204107, 120.7974216, 25.5523561],
    center: [24.4917388, 119.6054017],
    newsQuery: 'Taiwan Strait aircraft airspace',
  },
  {
    id: 'seoul-airspace',
    bbox: [124.3727348, 36.8544193, 127.8481129, 38.2811104],
    center: [37.5665, 126.978],
    newsQuery: 'KADIZ aircraft Korea airspace',
  },
  {
    id: 'south-china-sea',
    bbox: [102.2384722, -3.2287222, 122.1513056, 25.5672778],
    center: [11.1692778, 112.1948889],
    newsQuery: 'South China Sea aircraft maritime patrol',
  },
  {
    id: 'west-sea-nll',
    bbox: [123.547708291629, 37.626084840136, 126.688972200141, 38.2047340114075],
    center: [37.91540942577175, 125.118340245885],
    newsQuery: 'West Sea Korea aircraft KADIZ',
  },
];

class HttpStatusError extends Error {
  constructor(response, body) {
    super(`HTTP ${response.status} ${response.statusText}`.trim());
    this.status = response.status;
    this.headers = response.headers;
    this.body = body;
  }
}

function liveCacheKey(env) {
  return env.LIVE_CACHE_KEY || liveCacheKeyDefault;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolFromEnv(env, name, fallback = true) {
  const value = env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function publicErrorMessage(error) {
  if (error instanceof HttpStatusError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status: init.status ?? 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...init.headers,
    },
  });
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
    if (!response.ok) throw new HttpStatusError(response, text);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options) {
  return JSON.parse(await fetchText(url, options));
}

async function readBundledSnapshot(env) {
  const response = await env.ASSETS.fetch(new Request('https://assets.local/data/live-scenarios.json'));
  if (!response.ok) throw new Error(`Bundled snapshot unavailable: HTTP ${response.status}`);
  return response.json();
}

async function readStoredSnapshot(env) {
  const stored = await env.LIVE_SCENARIOS.get(liveCacheKey(env), 'json');
  if (stored) return stored;
  return readBundledSnapshot(env);
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
  return {
    id: `live-${regionId}-${icao24}`,
    source: 'opensky-cache',
    callsign,
    originCountry: originCountry || 'Unknown',
    platformType: classifyPlatform(callsign, Boolean(onGround)),
    baselineCorridorKm: 25,
    notes: 'Cloudflare Worker public OpenSky state vector cache. Public ADS-B coverage is incomplete.',
    points: [{
      lat,
      lon,
      altitudeM: Math.max(0, Math.round(Number(baroAltitude || 0))),
      velocityMs: Math.max(0, Math.round(Number(velocity || 0) * 10) / 10),
      headingDeg: Math.round(Number(trueTrack || 0)),
      observedAt: isoFromUnixSeconds(Number(timePosition || lastContact || Date.now() / 1000)),
    }],
  };
}

function retryAfterUntil(error, generatedAt, fallbackMs) {
  const header = error?.headers?.get?.('retry-after');
  const seconds = header ? Number.parseInt(header, 10) : NaN;
  const delayMs = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : fallbackMs;
  return new Date(new Date(generatedAt).getTime() + delayMs).toISOString();
}

async function openSkyHeaders(env) {
  if (!env.OPENSKY_CLIENT_ID || !env.OPENSKY_CLIENT_SECRET) return {};
  const response = await fetch('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
    method: 'POST',
    headers: {
      'user-agent': userAgent,
      accept: 'application/json',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.OPENSKY_CLIENT_ID,
      client_secret: env.OPENSKY_CLIENT_SECRET,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new HttpStatusError(response, text);
  const json = JSON.parse(text);
  return json.access_token ? { authorization: `Bearer ${json.access_token}` } : {};
}

async function fetchOpenSky(region, env) {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  const url = new URL('https://opensky-network.org/api/states/all');
  url.searchParams.set('lamin', String(minLat));
  url.searchParams.set('lomin', String(minLon));
  url.searchParams.set('lamax', String(maxLat));
  url.searchParams.set('lomax', String(maxLon));
  const json = await fetchJson(url, { timeoutMs: 20000, headers: await openSkyHeaders(env) });
  const maxTracks = positiveInteger(env.OPENSKY_MAX_TRACKS_PER_REGION, 25);
  return (json.states || [])
    .map((state) => normalizeOpenSkyState(state, region.id))
    .filter(Boolean)
    .sort((a, b) => (b.points[0]?.velocityMs ?? 0) - (a.points[0]?.velocityMs ?? 0))
    .slice(0, maxTracks);
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
  const current = json.current || {};
  const observedAt = current.time ? `${current.time}:00Z` : new Date().toISOString();
  return {
    id: `live-wx-${region.id}`,
    source: 'open-meteo-cache',
    regionId: region.id,
    observedAt,
    temperatureC: Number(current.temperature_2m || 0),
    windSpeedKmh: Number(current.wind_speed_10m || 0),
    windGustKmh: Number(current.wind_gusts_10m || 0),
    visibilityM: nearestHourlyVisibility(json.hourly, observedAt),
    cloudCoverPct: Number(current.cloud_cover || 0),
    precipitationMm: Number(current.precipitation || 0),
    weatherCode: Number(current.weather_code || 0),
  };
}

function parseGdeltSeenDate(value) {
  if (!value || !/^\d{8}T\d{6}Z$/.test(value)) return new Date().toISOString();
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
}

async function fetchGdelt(region) {
  const url = new URL('https://api.gdeltproject.org/api/v2/doc/doc');
  url.searchParams.set('query', region.newsQuery);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', String(region.osintLimit || 5));
  url.searchParams.set('sort', 'HybridRel');
  const json = await fetchJson(url, { timeoutMs: 20000 });
  return (json.articles || []).slice(0, region.osintLimit || 5).map((article, index) => ({
    id: `live-osint-${region.id}-${index + 1}`,
    source: 'gdelt-cache',
    regionId: region.id,
    title: article.title || `GDELT article ${index + 1}`,
    url: article.url,
    domain: article.domain,
    publishedAt: parseGdeltSeenDate(article.seendate),
    summary: `Cloudflare Worker GDELT signal for query: ${region.newsQuery}. Language=${article.language || 'unknown'}, sourceCountry=${article.sourcecountry || 'unknown'}.`,
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
    headers: { 'user-agent': 'Mozilla/5.0 AirMaven-Lite-Cloudflare-Worker/0.1' },
  });
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, region.osintLimit || 5).map((match, index) => {
    const block = match[1];
    const link = xmlTag(block, 'link');
    const sourceName = xmlSource(block);
    const publishedAtRaw = xmlTag(block, 'pubDate');
    return {
      id: `live-osint-google-${region.id}-${index + 1}`,
      source: 'google-news-rss-cache',
      regionId: region.id,
      title: xmlTag(block, 'title') || `Google News RSS item ${index + 1}`,
      url: link,
      domain: sourceName || domainFromUrl(link),
      publishedAt: publishedAtRaw ? new Date(publishedAtRaw).toISOString() : new Date().toISOString(),
      summary: `Cloudflare Worker Google News RSS signal for query: ${region.newsQuery}. Source=${sourceName}.`,
      tags: ['google news', 'osint', 'news volume', region.id],
      confidence: Math.max(0.44, 0.64 - index * 0.05),
    };
  });
}

async function fetchOsint(region, generatedAt) {
  const sourceStatus = { gdelt: 'unavailable', googleNews: 'unavailable' };
  const sourceReasons = {};
  try {
    const items = await fetchGdelt(region);
    if (items.length > 0) {
      return {
        items,
        sourceStatus: { gdelt: 'live', googleNews: 'standby' },
        sourceReasons: { googleNews: 'GDELT succeeded; fallback feed not used' },
      };
    }
    sourceStatus.gdelt = 'empty';
    sourceReasons.gdelt = 'No GDELT articles';
  } catch (error) {
    sourceStatus.gdelt = error?.status === 429 ? 'rate-limited' : 'unavailable';
    sourceReasons.gdelt = publicErrorMessage(error);
  }

  try {
    const items = await fetchGoogleNews(region);
    if (items.length > 0) {
      return { items, sourceStatus: { ...sourceStatus, googleNews: 'live' }, sourceReasons };
    }
    sourceStatus.googleNews = 'empty';
    sourceReasons.googleNews = 'No Google News RSS items';
  } catch (error) {
    sourceStatus.googleNews = 'unavailable';
    sourceReasons.googleNews = publicErrorMessage(error);
  }

  return { items: [], sourceStatus, sourceReasons, retryAfterUntil: new Date(new Date(generatedAt).getTime() + 30 * 60 * 1000).toISOString() };
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
  return (osintItems || []).slice(0, limit).map((item, index) => {
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
        ...(item.tags || []),
        region.global ? 'global-review-point' : 'aoi-review-point',
        ...(point.hotspot ? [point.hotspot] : []),
        'not-geocoded',
      ])],
    };
  });
}

function sourceUpdatedAt(sourceStatus, previousUpdatedAt, generatedAt) {
  const out = { ...(previousUpdatedAt || {}) };
  for (const [source, status] of Object.entries(sourceStatus)) {
    if (status === 'live') out[source] = generatedAt;
  }
  return out;
}

function mergeRefreshPolicy(previous) {
  return {
    ...(previous?.refreshPolicy || {}),
    browserPollMs: 30_000,
    recommendedFetchLoopMs: 15 * 60 * 1000,
    openSkyMaxTracksPerRegion: 25,
    cloudflareMode: 'free-plan-rotating-aoi',
  };
}

async function updateRegion(region, previousCache, env, generatedAt) {
  const previousRegion = previousCache.regions?.[region.id] || {};
  const sourceStatus = { ...(previousRegion.sourceStatus || {}) };
  const sourceReasons = { ...(previousRegion.sourceReasons || {}) };
  const nextRegion = { ...previousRegion };
  const rateLimitState = {};
  const errors = [];

  if (region.global) {
    nextRegion.tracks = previousRegion.tracks || [];
    sourceStatus.opensky = nextRegion.tracks.length ? 'cached' : 'standby';
    sourceReasons.opensky = 'Global OpenSky sweep disabled; select a detailed AOI for aircraft collection.';
  } else if (boolFromEnv(env, 'OPENSKY_FETCH_ENABLED', true)) {
    try {
      nextRegion.tracks = await fetchOpenSky(region, env);
      sourceStatus.opensky = 'live';
      delete sourceReasons.opensky;
    } catch (error) {
      const hasPrevious = Boolean(previousRegion.tracks?.length);
      nextRegion.tracks = previousRegion.tracks || [];
      sourceStatus.opensky = hasPrevious ? 'cached' : 'unavailable';
      sourceReasons.opensky = publicErrorMessage(error);
      errors.push(`OpenSky ${region.id}: ${publicErrorMessage(error)}`);
      if (error?.status === 429) {
        rateLimitState.opensky = { retryAfterUntil: retryAfterUntil(error, generatedAt, 30 * 60 * 1000) };
      }
    }
  } else {
    sourceStatus.opensky = previousRegion.tracks?.length ? 'cached' : 'disabled';
    sourceReasons.opensky = 'OPENSKY_FETCH_ENABLED=false';
  }

  if (region.global) {
    nextRegion.weather = null;
    sourceStatus.openMeteo = 'standby';
    sourceReasons.openMeteo = 'Global single-point weather is disabled; select a detailed AOI for weather context.';
  } else try {
    nextRegion.weather = await fetchOpenMeteo(region);
    sourceStatus.openMeteo = 'live';
    delete sourceReasons.openMeteo;
  } catch (error) {
    sourceStatus.openMeteo = previousRegion.weather ? 'cached' : 'unavailable';
    sourceReasons.openMeteo = publicErrorMessage(error);
    errors.push(`Open-Meteo ${region.id}: ${publicErrorMessage(error)}`);
  }

  const osint = await fetchOsint(region, generatedAt);
  nextRegion.osint = osint.items.length > 0 ? osint.items : previousRegion.osint || [];
  nextRegion.osintEvents = osintEventLayerForRegion(region, nextRegion.osint);
  Object.assign(sourceStatus, osint.sourceStatus, {
    osintEvents: nextRegion.osintEvents.length > 0 ? 'live' : 'empty',
  });
  Object.assign(sourceReasons, osint.sourceReasons, nextRegion.osintEvents.length > 0
    ? { osintEvents: region.global ? 'Global OSINT hotspot review points; not article-body geocoding or exact event coordinates.' : 'OSINT article AOI review points; not article-body geocoding or exact event coordinates.' }
    : { osintEvents: 'No OSINT article points available' });
  if (osint.retryAfterUntil) rateLimitState.gdelt = { retryAfterUntil: osint.retryAfterUntil };

  nextRegion.sourceStatus = sourceStatus;
  nextRegion.sourceReasons = sourceReasons;
  nextRegion.sourceUpdatedAt = sourceUpdatedAt(sourceStatus, previousRegion.sourceUpdatedAt, generatedAt);

  return { region: nextRegion, rateLimitState, errors };
}

async function nextRegionsToRefresh(env, count) {
  const raw = await env.LIVE_SCENARIOS.get(refreshIndexKey);
  const start = positiveInteger(raw, 0) % regions.length;
  const selected = [];
  for (let offset = 0; offset < count; offset += 1) {
    selected.push(regions[(start + offset) % regions.length]);
  }
  await env.LIVE_SCENARIOS.put(refreshIndexKey, String((start + count) % regions.length));
  return selected;
}

async function refreshLiveScenarios(env, { all = false } = {}) {
  const previousCache = await readStoredSnapshot(env);
  const generatedAt = new Date().toISOString();
  const count = all ? regions.length : Math.min(regions.length, positiveInteger(env.REFRESH_REGIONS_PER_RUN, 1));
  const selectedRegions = all ? regions : await nextRegionsToRefresh(env, count);
  const nextCache = {
    ...previousCache,
    schemaVersion: 1,
    generatedAt,
    mode: 'public-live-cache',
    refreshPolicy: mergeRefreshPolicy(previousCache),
    note: 'Public API cache refreshed by Cloudflare Worker. Free-plan mode rotates AOIs and preserves cached static layers.',
    regions: { ...(previousCache.regions || {}) },
    rateLimitState: { ...(previousCache.rateLimitState || {}) },
    errors: [],
  };

  for (const region of selectedRegions) {
    const result = await updateRegion(region, previousCache, env, generatedAt);
    nextCache.regions[region.id] = result.region;
    Object.assign(nextCache.rateLimitState, result.rateLimitState);
    nextCache.errors.push(...result.errors);
  }

  await env.LIVE_SCENARIOS.put(liveCacheKey(env), JSON.stringify(nextCache));
  return { ok: true, generatedAt, refreshedRegions: selectedRegions.map((region) => region.id), errors: nextCache.errors };
}

async function handleLiveScenarios(env) {
  const cache = await readStoredSnapshot(env);
  return jsonResponse(cache);
}

async function handleManualRefresh(request, env) {
  const authHeader = request.headers.get('authorization');
  if (!env.CRON_SECRET || authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(request.url);
  const result = await refreshLiveScenarios(env, { all: url.searchParams.get('all') === '1' });
  return jsonResponse(result);
}

// adsb.lol sends no CORS header, so the browser cannot call it directly.
// Proxy /adsb-lol/* same-origin to https://api.adsb.lol/* (mirrors the Vite dev proxy
// and the Vercel rewrite) so the browser fetch succeeds.
async function handleAdsbLolProxy(url) {
  const target = `https://api.adsb.lol${url.pathname.replace(/^\/adsb-lol/, '')}${url.search}`;
  const upstream = await fetch(target, { headers: { 'user-agent': userAgent, accept: 'application/json' } });
  const body = await upstream.text();
  return new Response(body, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/live-scenarios') return handleLiveScenarios(env);
    if (url.pathname === '/api/refresh-live-data') return handleManualRefresh(request, env);
    if (url.pathname.startsWith('/adsb-lol/')) return handleAdsbLolProxy(url);
    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller, env) {
    await refreshLiveScenarios(env);
  },
};
