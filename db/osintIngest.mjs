// Global OSINT collector: GDELT DOC 2.0 (broad news-volume signal) + curated defense/world RSS.
// Used by scripts/record-observations.mjs (local) and api/cron/record.mjs (Vercel Cron).
// Writes into osint_items (see db/schema.sql) keyed by natural_key for idempotent re-runs.

const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';
const RSS_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// GDELT rate-limits to ~1 request / 5 seconds; anything faster returns 429.
const GDELT_PACE_MS = 5200;

// GDELT requires OR'd terms to be grouped in parentheses, e.g. "(a OR b)".
export const gdeltQueries = [
  '(military aircraft OR airspace OR fighter jet)',
  '(naval OR warship OR carrier)',
  '(missile OR drone OR airstrike)',
  '(NATO OR PLA OR KADIZ OR incursion)',
];

export const rssFeeds = [
  { url: 'https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=945&max=20', source: 'defense.gov', tier: 'authoritative' },
  { url: 'https://www.defensenews.com/arc/outboundfeeds/rss/?outputType=xml', source: 'defense-news', tier: 'authoritative' },
  { url: 'https://breakingdefense.com/feed/', source: 'breaking-defense', tier: 'authoritative' },
  { url: 'https://news.usni.org/feed', source: 'usni-news', tier: 'authoritative' },
  { url: 'https://www.twz.com/feed', source: 'the-war-zone', tier: 'authoritative' },
  { url: 'https://en.yna.co.kr/RSS/news.xml', source: 'yonhap', tier: 'authoritative' },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: 'bbc-world', tier: 'broad' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml', source: 'al-jazeera', tier: 'broad' },
];

// Country/region keyword -> [lat, lon] centroid. Matched case-insensitively.
export const gazetteer = {
  'united states': [39.8, -98.6],
  usa: [39.8, -98.6],
  china: [35.9, 104.2],
  taiwan: [23.7, 121.0],
  'south korea': [36.5, 127.8],
  korea: [36.5, 127.8],
  'north korea': [40.3, 127.5],
  japan: [36.2, 138.3],
  russia: [61.5, 105.3],
  ukraine: [48.4, 31.2],
  israel: [31.0, 34.8],
  iran: [32.4, 53.7],
  india: [21.0, 78.0],
  pakistan: [30.4, 69.3],
  'united kingdom': [54.0, -2.0],
  uk: [54.0, -2.0],
  france: [46.6, 2.2],
  germany: [51.2, 10.5],
  poland: [51.9, 19.1],
  syria: [34.8, 38.5],
  yemen: [15.6, 48.0],
  philippines: [12.9, 121.8],
  vietnam: [14.1, 108.3],
  australia: [-25.3, 133.8],
  canada: [56.1, -106.3],
  turkey: [38.9, 35.2],
  'saudi arabia': [23.9, 45.1],
  egypt: [26.8, 30.8],
  'south china sea': [11.17, 112.19],
  'taiwan strait': [24.49, 119.6],
  'black sea': [43.4, 34.0],
  baltic: [58.0, 20.0],
  mediterranean: [35.0, 18.0],
  'red sea': [20.0, 38.0],
  'persian gulf': [26.5, 52.0],
  'korean peninsula': [37.9, 127.5],
};

const aoiPresets = [
  { id: 'taiwan-strait', center: [24.49, 119.6] },
  { id: 'seoul-airspace', center: [37.57, 126.98] },
  { id: 'south-china-sea', center: [11.17, 112.19] },
  { id: 'west-sea-nll', center: [37.9, 125.1] },
];
const AOI_RADIUS_KM = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function haversineKm(aLat, aLon, bLat, bLon) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function regionIdForPoint(lat, lon) {
  if (lat == null || lon == null) return 'global';
  for (const aoi of aoiPresets) {
    const [aLat, aLon] = aoi.center;
    if (haversineKm(lat, lon, aLat, aLon) <= AOI_RADIUS_KM) return aoi.id;
  }
  return 'global';
}

function geoFromCountryName(countryName) {
  const key = String(countryName ?? '').trim().toLowerCase();
  if (!key) return null;
  return gazetteer[key] ?? null;
}

function geoFromKeywords(text) {
  const lower = String(text ?? '').toLowerCase();
  for (const [keyword, centroid] of Object.entries(gazetteer)) {
    if (lower.includes(keyword)) return centroid;
  }
  return null;
}

async function fetchText(url, { timeoutMs = 20000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: '*/*', ...headers } });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// GDELT's shared rate limit occasionally still 429s even at the documented 1-req/5s pace
// (e.g. other clients on the same egress IP). Retry a couple of times with backoff before
// giving up so one noisy neighbor doesn't kill the whole query.
async function fetchTextWithRetry(url, opts, { retries = 2, backoffMs = 6000 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchText(url, opts);
    } catch (error) {
      const isRateLimited = /HTTP 429/.test(String(error));
      if (isRateLimited && attempt < retries) {
        await sleep(backoffMs * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  throw new Error('unreachable');
}

function parseGdeltSeenDate(value) {
  if (!value || !/^\d{8}T\d{6}Z$/.test(value)) return new Date().toISOString();
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`;
}

async function fetchGdeltQuery(query) {
  const url = new URL(GDELT_BASE);
  url.searchParams.set('query', query);
  url.searchParams.set('mode', 'ArtList');
  url.searchParams.set('format', 'json');
  url.searchParams.set('maxrecords', '25');
  url.searchParams.set('sort', 'DateDesc');
  url.searchParams.set('timespan', '1d');
  const text = await fetchTextWithRetry(url, { headers: { 'user-agent': 'AirMaven-OSINT/0.1' } });
  const trimmed = (text || '').trim();
  // GDELT reports malformed-query errors as a plain-text 200, not JSON.
  if (trimmed && !trimmed.startsWith('{')) throw new Error(trimmed.slice(0, 200));
  const json = JSON.parse(trimmed || '{}');
  const articles = json.articles ?? [];
  return articles.map((article) => {
    const geo = geoFromCountryName(article.sourcecountry);
    const lat = geo ? geo[0] : null;
    const lon = geo ? geo[1] : null;
    return {
      observedAt: parseGdeltSeenDate(article.seendate),
      regionId: regionIdForPoint(lat, lon),
      source: article.domain || 'gdelt',
      tier: 'broad',
      title: article.title || 'GDELT article',
      url: article.url || null,
      summary: `sourceCountry=${article.sourcecountry || 'unknown'}, language=${article.language || 'unknown'}`,
      lat,
      lon,
    };
  });
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

function xmlLink(block) {
  // RSS <link>url</link>; Atom <link href="url"/>
  const attr = block.match(/<link[^>]*\shref=["']([^"']+)["'][^>]*\/?>/i);
  if (attr) return decodeXmlEntities(attr[1].trim());
  return xmlTag(block, 'link');
}

function stripHtml(value) {
  return decodeXmlEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function parseRssDate(value) {
  const time = new Date(value ?? '').getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

async function fetchRssFeed(feed) {
  const text = await fetchText(feed.url, { headers: { 'user-agent': RSS_USER_AGENT } });
  const blocks = [
    ...text.matchAll(/<item>([\s\S]*?)<\/item>/gi),
    ...text.matchAll(/<entry>([\s\S]*?)<\/entry>/gi),
  ].map((match) => match[1]);
  return blocks.map((block) => {
    const title = xmlTag(block, 'title') || 'Untitled';
    const rawSummary = xmlTag(block, 'description') || xmlTag(block, 'summary') || xmlTag(block, 'content');
    const summary = stripHtml(rawSummary);
    const geo = geoFromKeywords(`${title} ${summary}`);
    const lat = geo ? geo[0] : null;
    const lon = geo ? geo[1] : null;
    return {
      observedAt: parseRssDate(xmlTag(block, 'pubDate') || xmlTag(block, 'updated') || xmlTag(block, 'published')),
      regionId: regionIdForPoint(lat, lon),
      source: feed.source,
      tier: feed.tier,
      title,
      url: xmlLink(block) || null,
      summary,
      lat,
      lon,
    };
  });
}

function naturalKeyFor(item) {
  const raw = item.url || `${item.source}:${item.title}`;
  return raw.slice(0, 300);
}

async function insertItems(sql, items) {
  let inserted = 0;
  const batchSize = 50;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const rows = await sql.transaction(batch.map((item) => sql`
      INSERT INTO osint_items (observed_at, region_id, source, tier, title, url, summary, lat, lon, natural_key)
      VALUES (${item.observedAt}, ${item.regionId}, ${item.source}, ${item.tier}, ${item.title}, ${item.url}, ${item.summary}, ${item.lat}, ${item.lon}, ${naturalKeyFor(item)})
      ON CONFLICT DO NOTHING
      RETURNING id
    `));
    inserted += rows.reduce((sum, r) => sum + (r.length ?? 0), 0);
  }
  return inserted;
}

// Runs one full collection pass across GDELT + curated RSS feeds and writes to osint_items.
// Returns { inserted, bySource: { [source]: count } }.
export async function collectOsint(sql, { log } = {}) {
  const bySource = {};
  let inserted = 0;

  for (let i = 0; i < gdeltQueries.length; i += 1) {
    const query = gdeltQueries[i];
    if (i > 0) await sleep(GDELT_PACE_MS);
    try {
      const items = await fetchGdeltQuery(query);
      const count = await insertItems(sql, items);
      inserted += count;
      bySource.gdelt = (bySource.gdelt ?? 0) + count;
      log?.(`gdelt "${query}" fetched=${items.length} inserted=${count}`);
    } catch (error) {
      log?.(`gdelt "${query}" FAILED: ${String(error)}`);
    }
  }

  for (const feed of rssFeeds) {
    try {
      const items = await fetchRssFeed(feed);
      const count = await insertItems(sql, items);
      inserted += count;
      bySource[feed.source] = (bySource[feed.source] ?? 0) + count;
      log?.(`${feed.source} fetched=${items.length} inserted=${count}`);
    } catch (error) {
      log?.(`${feed.source} FAILED: ${String(error)}`);
    }
  }

  return { inserted, bySource };
}
