// Telegram OSINT — scrapes public channels via the t.me/s/<channel> preview page (no API key,
// no bot). Ported from IRONSIGHT. One request per channel returns the ~15 most recent posts;
// non-Latin text is translated with the keyless Google Translate endpoint. The strict filter
// keeps only strike/damage/casualty RESULTS (not warnings, launches, politics, or ceremonies).
// Public data only. Browser polls GET /api/telegram; results are CDN-cached briefly.

export const config = { maxDuration: 60 };

const CHANNELS = [
  { name: 'IDFofficial', label: 'IDF Official', color: '#3388ff' },
  { name: 'RocketAlert', label: 'Rocket Alert', color: '#ff3366' },
  { name: 'PressTV', label: 'PressTV (Iran)', color: '#cc3333' },
  { name: 'OSINTdefender', label: 'OSINT Defender', color: '#00aaff' },
  { name: 'middle_east_spectator', label: 'ME Spectator', color: '#ff6600' },
  { name: 'iranintl_en', label: 'Iran Intl', color: '#00ff88' },
  { name: 'Alertisrael', label: 'Alert Israel', color: '#ff6688' },
  { name: 'QudsNen', label: 'Quds News', color: '#33cc66' },
  { name: 'TimesofIsrael', label: 'Times of Israel', color: '#0066cc' },
  { name: 'FarsNews_EN', label: 'Fars News', color: '#669933' },
  { name: 'FotrosResistancee', label: 'Fotros Resist.', color: '#dd4444' },
  { name: 'warfareanalysis', label: 'Warfare Analysis', color: '#8888cc' },
  { name: 'rnintel', label: 'RN Intel', color: '#44aacc' },
  { name: 'GeoPWatch', label: 'GeoPol Watch', color: '#cc66aa' },
  { name: 'thecradlemedia', label: 'The Cradle', color: '#aa8844' },
  { name: 'HAMASW', label: 'Hamas-Israel War', color: '#339933' },
  { name: 'TasnimNewsEN', label: 'Tasnim News', color: '#557733' },
  { name: 'AbuAliExpress', label: 'Abu Ali Express', color: '#dd7733' },
  { name: 'dropsitenews', label: 'Drop Site News', color: '#e63946' },
  { name: 'france24_en', label: 'France 24', color: '#2266bb' },
  { name: 'sepah', label: 'IRGC Official', color: '#774433' },
  { name: 'aljazeeraglobal', label: 'Al Jazeera', color: '#d4a843' },
  // Russia–Ukraine war (air-war monitoring)
  { name: 'kpszsu', label: '🇺🇦 UA Air Force Cmd', color: '#ffd700' },
  { name: 'air_alert_ua', label: '🇺🇦 UA Air Alert', color: '#0057b7' },
  { name: 'operativnoZSU', label: '🇺🇦 Operational ZSU', color: '#4488cc' },
  { name: 'mod_russia_en', label: '🇷🇺 RU MoD (EN)', color: '#dd3333' },
  { name: 'zvezdanews', label: '🇷🇺 Zvezda (RU MoD)', color: '#aa2222' },
  { name: 'DeepStateUA', label: '🗺 DeepState UA', color: '#5599dd' },
  { name: 'Tatarigami_UA', label: 'Frontelligence', color: '#66aacc' },
  { name: 'wartranslated', label: 'WarTranslated', color: '#88aabb' },
  { name: 'rybar', label: '🇷🇺 Rybar', color: '#bb4444' },
  { name: 'intelslava', label: '🇷🇺 Intel Slava', color: '#bb5533' },
  { name: 'serhii_flash', label: '🇺🇦 Serhii Flash (EW)', color: '#ffcc33' },
  { name: 'wild_hornets', label: '🇺🇦 Wild Hornets (UAV)', color: '#ffaa22' },
];

const WAR_KEYWORDS = new RegExp([
  'destroy(?:ed|ing|s)?', 'struck', 'airstrike', 'air\\s?strike', 'missile\\s?strike', 'drone\\s?strike',
  'shell(?:ed|ing)?', 'bombard(?:ed|ment|ing)?', 'bomb(?:ed|ing)?', '\\bhit\\b', 'direct\\s?hit',
  'shot\\s?down', 'downed', 'intercept(?:ed|s)?', 'eliminat(?:ed|ing)?', 'liquidat', 'neutraliz(?:ed)?',
  'obliterat(?:ed)?', 'wiped\\s?out', 'blown\\s?up', 'set\\s?ablaze', 'ablaze', 'on\\s?fire',
  'took\\s?out', 'knocked\\s?out', 'damag(?:ed|es|e)\\b', 'explos', 'detonat', 'blast',
  'kill(?:ed|s)?', '\\bdead\\b', 'death\\s?toll', 'casualt', 'wounded', 'injur(?:ed|ies|y)?',
  'fatalit', 'losses', 'massacre', '\\bslain\\b',
].join('|'), 'i');

const TELEGRAM_NOISE = /\bsubscribe\b|join\s+(?:our|the|us)|t\.me\/\+|follow\s+us|advertis|sponsor|giveaway|discount|promo\s?code|click\s+here|link\s+in\s+bio/i;

const OFFTOPIC = new RegExp([
  'held\\s+a\\s+meeting', 'in\\s+a\\s+meeting', 'met\\s+with', '\\bsummit\\b', 'peace\\s+talks',
  'negotiat', 'diplomat', 'ambassador', 'parliament', 'election', 'referendum', 'lawmaker',
  'imposed\\s+sanctions', 'new\\s+sanctions', 'trade\\s+deal', 'delegation', 'state\\s+visit',
  'press\\s+conference', 'congratulat', 'inaugurat',
  'funeral', 'farewell\\s+to', 'mourning', 'condolence', 'memorial\\s+service', 'anniversary\\s+of',
  'laid\\s+to\\s+rest', 'prayer\\s+service', '\\bburied\\b', 'commemorat',
  'terror\\s+cell', 'operative\\s+cell', 'sleeper\\s+cell', 'spy\\s+(?:ring|network)', 'espionage',
  'arrest(?:ed|s)?', 'detain(?:ed|s)?', 'smuggl',
  'emergency\\s+landing', 'forced\\s+landing', 'engine\\s+(?:problem|failure|trouble)', 'made\\s+an\\s+emergency',
  'inflation', 'currency', 'oil\\s+price', 'stock\\s+market', 'championship', 'football\\s+match',
  'weather\\s+forecast', 'charity', 'fundrais',
].join('|'), 'i');

const POSTS_PER_CHANNEL = 12;
const BATCH_SIZE = 6;
const lastGood = {};
const translationCache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function hasNonLatinText(text) {
  return /[֐-׿؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿Ѐ-ӿ]/.test(text);
}

// Keyless Google Translate (unofficial gtx endpoint) — auto-detect → English.
async function translateFreeText(text) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3500), headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) return text;
    const data = await res.json();
    const translated = (data[0] ?? []).map((part) => part[0]).join('');
    return translated || text;
  } catch {
    return text;
  }
}

async function maybeTranslate(text) {
  if (!hasNonLatinText(text)) return text;
  const cached = translationCache.get(text);
  if (cached) return cached;
  const translated = await translateFreeText(text);
  if (translationCache.size > 2000) translationCache.clear();
  translationCache.set(text, translated);
  return translated;
}

function cleanHtml(raw) {
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#036;/g, '$').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchChannel(channel) {
  try {
    const res = await fetch(`https://t.me/s/${channel.name}`, {
      signal: AbortSignal.timeout(8000),
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) return lastGood[channel.name] ?? [];
    const html = await res.text();
    const blocks = html.split('data-post="');
    const parsed = [];
    for (const block of blocks.slice(1)) {
      const idMatch = block.match(/^[^"/]+\/(\d+)"/);
      if (!idMatch) continue;
      const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)<\/div>/s);
      if (!textMatch) continue;
      const text = cleanHtml(textMatch[1]);
      if (!text) continue;
      const dateMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
      parsed.push({ postId: Number(idMatch[1]), text, date: dateMatch ? dateMatch[1] : new Date().toISOString() });
    }
    const latest = parsed.slice(-POSTS_PER_CHANNEL);
    const posts = await Promise.all(latest.map(async (p) => ({
      channel: channel.name,
      channelLabel: channel.label,
      color: channel.color,
      postId: p.postId,
      text: await maybeTranslate(p.text),
      date: p.date,
      url: `https://t.me/${channel.name}/${p.postId}`,
    })));
    if (posts.length) lastGood[channel.name] = posts;
    return posts.length ? posts : (lastGood[channel.name] ?? []);
  } catch {
    return lastGood[channel.name] ?? [];
  }
}

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=45, stale-while-revalidate=120');
  try {
    const all = [];
    for (let i = 0; i < CHANNELS.length; i += BATCH_SIZE) {
      const batch = CHANNELS.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(fetchChannel));
      for (const r of results) if (r.status === 'fulfilled') all.push(...r.value);
      if (i + BATCH_SIZE < CHANNELS.length) await sleep(300);
    }
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const posts = all.filter((p) => {
      const t = new Date(p.date).getTime();
      if (!Number.isNaN(t) && t < cutoff) return false;
      if (!WAR_KEYWORDS.test(p.text)) return false;
      if (OFFTOPIC.test(p.text)) return false;
      if (TELEGRAM_NOISE.test(p.text)) return false;
      return true;
    });
    posts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    res.status(200).json({ ok: true, posts, channels: CHANNELS.map((c) => c.label), updated: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error), posts: [] });
  }
}
