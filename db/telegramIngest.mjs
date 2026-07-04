// Telegram OSINT collector — scrapes public t.me/s/<channel> preview pages, filters to
// strike/damage/casualty RESULTS, translates non-Latin text (keyless Google Translate), and
// upserts into telegram_posts (idempotent by natural_key = channel:postId). Used by the
// 15-min recorder (db/ingest.mjs). Public data only; no API key/bot.

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
  // --- 50 large-scale OSINT channels added 2026-07-05 (each verified reachable via live
  // t.me/s/ scrape; channels that disable the web preview were excluded, not guessed) ---
  { name: 'UAWeapons', label: '🇺🇦 UA Weapons', color: '#ffd633' },
  { name: 'liveuamap', label: 'Liveuamap', color: '#4aa3df' },
  { name: 'KyivIndependent_official', label: '🇺🇦 Kyiv Independent', color: '#3d7fd1' },
  { name: 'Osint613', label: 'OSINT613', color: '#33bbaa' },
  { name: 'SputnikInt', label: '🇷🇺 Sputnik Intl', color: '#cc3b2f' },
  { name: 'Osinttechnical', label: 'OSINT Technical', color: '#5fb0d0' },
  { name: 'ukr_leaks_eng', label: '🇺🇦 UkrLeaks', color: '#e0b530' },
  { name: 'worldsource24', label: 'WorldSource24', color: '#8a9bb5' },
  { name: 'Slavyangrad', label: '🇷🇺 Slavyangrad', color: '#b5432f' },
  { name: 'Megatron_ron', label: 'Megatron', color: '#9b6fc0' },
  { name: 'AuroraIntel', label: 'Aurora Intel', color: '#e05a8a' },
  { name: 'IsraelWarRoom', label: '🇮🇱 Israel War Room', color: '#2f6fd1' },
  { name: 'i24NEWS_EN', label: '🇮🇱 i24NEWS', color: '#1f9dd1' },
  { name: 'insiderpaper', label: 'Insider Paper', color: '#c0504d' },
  { name: 'TRTWorld', label: 'TRT World', color: '#3a8a5f' },
  { name: 'WarClandestine', label: 'War Clandestine', color: '#7a8fb0' },
  { name: 'clashreport', label: 'Clash Report', color: '#d08a2f' },
  { name: 'breaking911', label: 'Breaking911', color: '#c94b4b' },
  { name: 'WarMonitors', label: 'War Monitor', color: '#8877bb' },
  { name: 'spectatorindex', label: 'Spectator Index', color: '#556b8f' },
  { name: 'disclosetv', label: 'Disclose.tv', color: '#5fa0c0' },
  { name: 'GeneralStaffZSU', label: '🇺🇦 General Staff ZSU', color: '#f0c419' },
  { name: 'Faytuks', label: 'Faytuks Network', color: '#6699bb' },
  { name: 'jacksonhinkle', label: 'Jackson Hinkle', color: '#cc7744' },
  { name: 'suriyakmaps', label: 'Suriyak Maps', color: '#88bb66' },
  { name: 'RALee85', label: 'Rob Lee (OSINT)', color: '#77aacc' },
  { name: 'IraqiSecurity', label: '🇮🇶 Iraqi Security', color: '#aa8844' },
  { name: 'uniannet', label: '🇺🇦 UNIAN', color: '#3d8fd1' },
  { name: 'ukrpravda_news', label: '🇺🇦 Ukrainska Pravda', color: '#4488cc' },
  { name: 'war_home', label: 'War Home', color: '#99667f' },
  { name: 'RVvoenkor', label: '🇷🇺 RV Voenkor', color: '#bb4433' },
  { name: 'wargonzo', label: '🇷🇺 WarGonzo', color: '#aa3322' },
  { name: 'milchronicles', label: 'Military Chronicles', color: '#8fa0b5' },
  { name: 'swodki', label: '🇷🇺 Svodki', color: '#b55544' },
  { name: 'milinfolive', label: '🇷🇺 Military Informant', color: '#c05540' },
  { name: 'epoddubny', label: '🇷🇺 Poddubny', color: '#aa4433' },
  { name: 'Sladkov_plus', label: '🇷🇺 Sladkov', color: '#bb5544' },
  { name: 'tass_agency', label: '🇷🇺 TASS', color: '#cc4433' },
  { name: 'grey_zone', label: '🇷🇺 Grey Zone', color: '#777777' },
  { name: 'warmonitor', label: 'War Monitor (WM)', color: '#8b7fae' },
  { name: 'TheStudyofWar', label: 'ISW (Study of War)', color: '#5f7fb0' },
  { name: 'ChuvKm', label: 'Chuv Km', color: '#99aabb' },
  { name: 'bild_russian', label: '🇷🇺 BILD (RU)', color: '#b06a4a' },
  { name: 'AJEnglish', label: 'Al Jazeera Eng', color: '#c9a83a' },
  { name: 'vxunderground', label: 'vx-underground', color: '#66aa88' },
  { name: 'ukrainenowenglish', label: '🇺🇦 Ukraine Now', color: '#3d8fc9' },
  { name: 'nexta_tv', label: 'NEXTA', color: '#5fb0a0' },
  { name: 'readovkanews', label: '🇷🇺 Readovka', color: '#bb5533' },
  { name: 'pravda_gerashchenko', label: '🇺🇦 Gerashchenko', color: '#e0c020' },
  { name: 'moscowtimes', label: '🇷🇺 Moscow Times', color: '#a06a5a' },
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
const BATCH_SIZE = 12;  // 84 channels → ~7 batches; keeps collection within the cron time budget
const translationCache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hasNonLatinText = (text) => /[֐-׿؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿Ѐ-ӿ]/.test(text);

async function translateFreeText(text) {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3500), headers: { 'user-agent': 'Mozilla/5.0' } });
    if (!res.ok) return text;
    const data = await res.json();
    return (data[0] ?? []).map((part) => part[0]).join('') || text;
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
    if (!res.ok) return [];
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
    return Promise.all(latest.map(async (p) => ({
      channel: channel.name,
      channelLabel: channel.label,
      color: channel.color,
      postId: p.postId,
      text: await maybeTranslate(p.text),
      date: p.date,
      url: `https://t.me/${channel.name}/${p.postId}`,
    })));
  } catch {
    return [];
  }
}

// Scrapes all channels, filters to strike-result posts, and upserts into telegram_posts.
export async function collectTelegram(sql, { log } = {}) {
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

  let inserted = 0;
  const CHUNK = 100;
  try {
    for (let i = 0; i < posts.length; i += CHUNK) {
      const batch = posts.slice(i, i + CHUNK);
      const rows = await sql.transaction(batch.map((p) => sql`
        INSERT INTO telegram_posts (observed_at, channel, channel_label, color, post_id, text, url, natural_key)
        VALUES (${new Date(p.date).toISOString()}, ${p.channel}, ${p.channelLabel}, ${p.color}, ${p.postId}, ${p.text}, ${p.url}, ${`${p.channel}:${p.postId}`})
        ON CONFLICT (natural_key) DO NOTHING
        RETURNING id
      `));
      inserted += rows.reduce((sum, r) => sum + (r.length ?? 0), 0);
    }
    // Bound retention to 14 days so the feed stays current.
    await sql`DELETE FROM telegram_posts WHERE observed_at < now() - make_interval(days => 14)`;
    await sql`INSERT INTO ingest_runs (region_id, source, status, records, detail) VALUES (NULL, 'telegram', 'ok', ${inserted}, ${`fetched=${posts.length}`})`;
    log?.(`telegram fetched=${posts.length} inserted=${inserted}`);
  } catch (error) {
    await sql`INSERT INTO ingest_runs (region_id, source, status, records, detail) VALUES (NULL, 'telegram', 'error', 0, ${String(error).slice(0, 300)})`;
    log?.(`telegram FAILED: ${String(error)}`);
  }
  return { inserted, fetched: posts.length };
}
