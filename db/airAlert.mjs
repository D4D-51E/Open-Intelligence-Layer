// Ukrainian air-raid alert layer — parses the public @air_alert_ua Telegram feed (keyless
// t.me/s/ scrape; structured alert APIs like alerts.in.ua/ukrainealarm require tokens) into
// oblast-level alert state. Posts look like:
//   🔴 Повітряна тривога в <район/область>   → alert DECLARED
//   🟢 Відбій тривоги в <район/область>       → all-clear
//   🟡 ... тривога ще триває                  → still ongoing (active)
// We replay recent posts chronologically and keep the latest status per oblast. This is a
// "recent alert state" view derived from the feed, not a guaranteed-complete live map. Public data.

// Oblast centroids + Ukrainian name/raion/city stems (lowercased substrings) that map to them.
// Covers the war-relevant oblasts; stems include common frontline raion + admin-centre forms.
const OBLASTS = [
  { key: 'zaporizhzhia', en: 'Zaporizhzhia', lat: 47.5, lon: 35.2, stems: ['запор', 'мелітопол', 'василівськ', 'бердянськ', 'пологівськ', 'оріхів'] },
  { key: 'donetsk', en: 'Donetsk', lat: 48.0, lon: 37.8, stems: ['донец', 'краматорськ', 'бахмут', 'маріупол', 'волновас', 'горлівськ', 'кальміусь', 'покровськ', 'слов', 'єнакієв'] },
  { key: 'kharkiv', en: 'Kharkiv', lat: 49.99, lon: 36.23, stems: ['харків', 'харкі', 'куп', 'ізюм', 'чугуїв', 'лозівськ', 'богодух'] },
  { key: 'kherson', en: 'Kherson', lat: 46.64, lon: 32.61, stems: ['херсон', 'каховськ', 'бериславськ', 'скадовськ', 'генічеськ'] },
  { key: 'dnipro', en: 'Dnipropetrovsk', lat: 48.46, lon: 35.05, stems: ['дніпро', 'криворізьк', 'кривий ріг', 'нікопол', 'павлоград', 'кам’янськ', 'камянськ'] },
  { key: 'sumy', en: 'Sumy', lat: 50.9, lon: 34.8, stems: ['сумськ', 'сумі', 'шостк', 'конотоп', 'охтир', 'роменськ'] },
  { key: 'chernihiv', en: 'Chernihiv', lat: 51.5, lon: 31.3, stems: ['черніг', 'ніжин', 'прилук', 'новгород-сіверськ', 'корюків'] },
  { key: 'mykolaiv', en: 'Mykolaiv', lat: 46.98, lon: 31.99, stems: ['микола', 'вознесенськ', 'первомайськ', 'баштанськ'] },
  { key: 'odesa', en: 'Odesa', lat: 46.48, lon: 30.72, stems: ['одес', 'ізмаїл', 'білгород-дністр', 'березівськ', 'роздільнянськ'] },
  { key: 'kyiv', en: 'Kyiv', lat: 50.45, lon: 30.52, stems: ['київ'] },
  { key: 'poltava', en: 'Poltava', lat: 49.6, lon: 34.55, stems: ['полтав', 'кременчуцьк', 'лубенськ', 'миргород'] },
  { key: 'luhansk', en: 'Luhansk', lat: 48.6, lon: 39.3, stems: ['луган', 'сєвєродонецьк', 'старобільськ'] },
  { key: 'cherkasy', en: 'Cherkasy', lat: 49.44, lon: 32.06, stems: ['черкас', 'уманськ', 'золотоніськ'] },
  { key: 'kirovohrad', en: 'Kirovohrad', lat: 48.5, lon: 32.26, stems: ['кіровоград', 'кропивниц', 'олександрійськ', 'голованівськ'] },
  { key: 'vinnytsia', en: 'Vinnytsia', lat: 49.23, lon: 28.47, stems: ['вінниц', 'жмеринськ', 'могилів-подільськ', 'гайсинськ'] },
  { key: 'zhytomyr', en: 'Zhytomyr', lat: 50.25, lon: 28.66, stems: ['житомир', 'бердичівськ', 'коростенськ', 'новоград'] },
  { key: 'rivne', en: 'Rivne', lat: 50.62, lon: 26.25, stems: ['рівн', 'дубенськ', 'сарненськ'] },
  { key: 'volyn', en: 'Volyn', lat: 50.75, lon: 25.32, stems: ['волин', 'луцьк', 'ковельськ', 'володимир-волинськ'] },
  { key: 'lviv', en: 'Lviv', lat: 49.84, lon: 24.03, stems: ['львів', 'дрогобицьк', 'стрийськ', 'червоноград', 'золочівськ'] },
  { key: 'ivano-frankivsk', en: 'Ivano-Frankivsk', lat: 48.92, lon: 24.71, stems: ['франківськ', 'івано-франк', 'коломийськ', 'калуськ'] },
  { key: 'ternopil', en: 'Ternopil', lat: 49.55, lon: 25.59, stems: ['тернопіл', 'чортківськ', 'кременецьк'] },
  { key: 'khmelnytskyi', en: 'Khmelnytskyi', lat: 49.42, lon: 26.98, stems: ['хмельниц', 'кам’янець-подільськ', 'камянець-подільськ', 'шепетівськ'] },
  { key: 'zakarpattia', en: 'Zakarpattia', lat: 48.62, lon: 22.29, stems: ['закарпат', 'ужгород', 'мукачівськ', 'хустськ'] },
  { key: 'chernivtsi', en: 'Chernivtsi', lat: 48.29, lon: 25.94, stems: ['чернівц', 'вижницьк', 'дністровськ'] },
  { key: 'crimea', en: 'Crimea', lat: 45.3, lon: 34.4, stems: ['крим', 'севастопол', 'сімферопол', 'керч', 'джанко'] },
];

function detectStatus(text) {
  const t = text.toLowerCase();
  if (t.includes('відбій') || text.includes('🟢')) return 'clear';
  if (t.includes('повітряна тривога') || t.includes('ракетна небезпека') || text.includes('🔴')) return 'alert';
  if (t.includes('тривога ще триває') || text.includes('🟡')) return 'alert';
  return null;
}

function matchOblasts(text) {
  const t = text.toLowerCase();
  const hits = [];
  for (const o of OBLASTS) {
    if (o.stems.some((s) => t.includes(s))) hits.push(o.key);
  }
  return hits;
}

const cleanHtml = (raw) => raw
  .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

async function fetchPage(before) {
  // Best-effort: a slow/failed page never aborts the whole scan (returns []).
  try {
    const url = before ? `https://t.me/s/air_alert_ua?before=${before}` : 'https://t.me/s/air_alert_ua';
    const res = await fetch(url, { signal: AbortSignal.timeout(11000), headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    if (!res.ok) return [];
    const html = await res.text();
    const out = [];
    for (const block of html.split('data-post="').slice(1)) {
      const idMatch = block.match(/^[^"/]+\/(\d+)"/);
      const textMatch = block.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>(.*?)<\/div>/s);
      const dateMatch = block.match(/<time[^>]*datetime="([^"]+)"/);
      if (!idMatch || !textMatch) continue;
      out.push({ postId: Number(idMatch[1]), text: cleanHtml(textMatch[1]), at: dateMatch ? dateMatch[1] : null });
    }
    return out;
  } catch {
    return [];
  }
}

// Scrape up to `pages` pages of @air_alert_ua and compute the current per-oblast alert state by
// replaying events chronologically (latest event per oblast wins). Returns active-alert oblasts.
export async function fetchActiveAlerts({ pages = 3, maxAgeH = 6 } = {}) {
  const all = [];
  let before;
  for (let p = 0; p < pages; p += 1) {
    const page = await fetchPage(before);
    if (!page.length) break;
    all.push(...page);
    before = Math.min(...page.map((x) => x.postId));
  }
  // De-dupe and sort ascending by time so the newest event per oblast wins.
  const seen = new Set();
  const events = [];
  for (const post of all) {
    if (seen.has(post.postId)) continue;
    seen.add(post.postId);
    const status = detectStatus(post.text);
    if (!status) continue;
    const ms = post.at ? Date.parse(post.at) : NaN;
    if (Number.isNaN(ms)) continue;
    for (const key of matchOblasts(post.text)) events.push({ key, status, ms });
  }
  events.sort((a, b) => a.ms - b.ms);
  const state = new Map();
  for (const e of events) state.set(e.key, e);
  const cutoff = Date.now() - maxAgeH * 3600 * 1000;
  const active = [];
  for (const o of OBLASTS) {
    const e = state.get(o.key);
    if (e && e.status === 'alert' && e.ms >= cutoff) {
      active.push({ key: o.key, oblast: o.en, lat: o.lat, lon: o.lon, since: new Date(e.ms).toISOString() });
    }
  }
  return { active, eventCount: events.length, scanned: all.length };
}
