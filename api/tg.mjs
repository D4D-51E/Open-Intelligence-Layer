// Telegram bot webhook — lets an operator query AirMaven's internal fused data from mobile.
// Serverless (no polling worker): Telegram POSTs updates here; we read Neon + OpenAI and reply.
//
// Security (internal/defence data → default-deny):
//   • TELEGRAM_BOT_TOKEN         — bot token (secret; never in the repo).
//   • TELEGRAM_WEBHOOK_SECRET    — must match Telegram's X-Telegram-Bot-Api-Secret-Token header.
//   • TELEGRAM_ALLOWED_CHAT_IDS  — comma-separated chat ids allowed to run DATA commands.
// /start & /help always work (they only echo your chat id + usage); data commands require the
// caller's chat id to be whitelisted. Public data, non-targeting.
import { getSql } from '../db/client.mjs';
import { assessClaims, geolocate } from '../db/claimAssess.mjs';
import { fetchFirms, bboxAround } from '../db/firms.mjs';

export const config = { maxDuration: 30 };

// NASA FIRMS thermal hotspots (same source the web verification panel uses) from the static live
// cache. Merged across regions + deduped. Best-effort: reliability still scores on cross-source
// corroboration alone if this is unavailable.
async function fetchThermals(host) {
  try {
    const res = await fetch(`https://${host}/data/live-scenarios.json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const json = await res.json();
    const seen = new Set();
    const out = [];
    for (const region of Object.values(json.regions ?? {})) {
      for (const t of region?.thermalAnomalies ?? []) {
        const k = t.id ?? `${t.lat},${t.lon},${t.observedAt}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(t);
      }
    }
    return out;
  } catch {
    return [];
  }
}

// Score recent geolocated Telegram claims with the shared reliability logic (assessClaims).
async function gatherClaims(sql, host) {
  const rows = await sql`SELECT channel_label, color, text, url, observed_at FROM telegram_posts WHERE observed_at > now() - interval '24 hours' ORDER BY observed_at DESC LIMIT 120`;
  const posts = rows.map((r) => ({
    channelLabel: r.channel_label,
    color: r.color ?? '#8aa',
    text: r.text,
    url: r.url ?? undefined,
    date: r.observed_at instanceof Date ? r.observed_at.toISOString() : String(r.observed_at),
  }));
  // Distinct geolocated claim regions → live FIRMS bboxes, so the thermal axis fires over the
  // ACTUAL claim areas (Middle East / Ukraine), not just the cached AOI regions.
  const bboxes = [];
  const seenPlace = new Set();
  for (const p of posts) {
    const g = geolocate(p.text);
    if (g && !seenPlace.has(g.place)) { seenPlace.add(g.place); bboxes.push(bboxAround(g.lat, g.lon)); }
  }
  const [cached, live] = await Promise.all([fetchThermals(host), fetchFirms(bboxes, { dayRange: 3 })]);
  return assessClaims(posts, [...cached, ...live], Date.now());
}

const API = (method) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

const SYSTEM = `당신은 공개 데이터(공개 ADS-B 항적, AIS 선박, OSINT/텔레그램, NASA FIRMS 열적) 기반 항공·해상 상황인식 융합 분석관입니다. 제공된 JSON 데이터에만 근거해 한국어로 간결히 답하세요.
- 항공기/선박/사건/수치를 지어내지 말고, 각 주장 끝에 출처를 [ADS-B][AIS][텔레그램][검증] 등으로 표기.
- 특정 선박/항공기 질문이면 context.vessels.matches / context.tracks.matches(이름으로 조회한 결과)를 먼저 보고 답하세요. 매치가 있으면 이름·종류·속도·침로·좌표·관측시각으로 설명하고, 비어 있으면 "현재 수집 범위(AIS/ADS-B 커버리지) 내 해당 명칭의 신호 없음"이라고만 하세요(존재 자체를 단정하지 말 것).
- context.claims 는 텔레그램 주장의 신뢰도 분석 결과입니다: verdict(TRUE 확인 / LIKELY 가능성 / NOT LIKELY 미확인 / FALSE 허위), confidence(0–100), evidence(근거). 신뢰도를 물으면 이 필드를 근거로 답하세요. 확인=≥2개 독립근거(열적·교차출처), 가능성=단일/부분, 미확인=미교차(취재 공백일 수 있음), 허위=강한 주장인데 예상 신호 부재. [검증]
- 데이터가 희소하면 그렇다고 명시(신호 부재 ≠ 활동 부재). 식별·표적화가 아닌 공개정보 융합 보조. 마크다운 헤더 없이 본문만.`;

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

async function tg(method, payload) {
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  try {
    await fetch(API(method), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify(payload),
    });
  } catch { /* best-effort: Telegram will not retry a delivered 200 */ }
}

function reply(chatId, text) {
  // Telegram caps messages at 4096 chars.
  return tg('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true });
}

async function askOpenAI(query, context) {
  if (!process.env.OPENAI_API_KEY) return 'AI 키가 설정되지 않아 요약을 생성할 수 없습니다.';
  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(26_000),
      body: JSON.stringify({
        model: process.env.COPILOT_MODEL ?? 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `현재 내부 데이터(JSON):\n${JSON.stringify(context)}\n\n질문: ${query || '현재 상황을 요약해줘'}\n\n답변을 지금 작성하세요.` },
        ],
      }),
    });
    if (!upstream.ok) return `AI 오류 (${upstream.status}).`;
    const data = await upstream.json();
    return (data?.choices?.[0]?.message?.content ?? '').trim() || '응답이 비었습니다.';
  } catch (e) {
    return `AI 오류: ${String(e).slice(0, 120)}`;
  }
}

async function buildStatus(sql) {
  const [trk] = await sql`SELECT count(DISTINCT icao24) AS ac, count(DISTINCT icao24) FILTER (WHERE is_military) AS mil FROM track_observations WHERE observed_at > now() - interval '15 minutes'`;
  const [ves] = await sql`SELECT count(DISTINCT mmsi) AS v FROM vessel_observations WHERE observed_at > now() - interval '15 minutes'`;
  const [osi] = await sql`SELECT count(*) AS n FROM osint_items WHERE observed_at > now() - interval '6 hours'`;
  const [tgp] = await sql`SELECT count(*) AS n FROM telegram_posts WHERE observed_at > now() - interval '6 hours'`;
  return { ac: Number(trk?.ac ?? 0), mil: Number(trk?.mil ?? 0), v: Number(ves?.v ?? 0), osint: Number(osi?.n ?? 0), telegram: Number(tgp?.n ?? 0) };
}

// Distinctive alphabetic tokens from a query, used to look up a specific vessel/aircraft by name.
function nameTerms(query) {
  const stop = new Set(['the', 'and', 'ship', 'vessel', 'about', 'tell', 'show', 'this', 'that', 'info', 'give', 'what', 'where', 'status']);
  return [...new Set((query.match(/[A-Za-z]{3,}/g) ?? []).map((t) => t.toUpperCase()))]
    .filter((t) => !stop.has(t.toLowerCase()))
    .slice(0, 5);
}

async function buildAiContext(sql, host, query = '') {
  const tracks = await sql`SELECT DISTINCT ON (icao24) callsign, region_id, altitude_m, velocity_ms, is_military, round(lat::numeric,2) AS lat, round(lon::numeric,2) AS lon FROM track_observations WHERE observed_at > now() - interval '15 minutes' AND icao24 IS NOT NULL ORDER BY icao24, observed_at DESC LIMIT 40`;
  const posts = await sql`SELECT channel_label, left(text, 200) AS text FROM telegram_posts ORDER BY observed_at DESC LIMIT 10`;
  const [ves] = await sql`SELECT count(DISTINCT mmsi) AS v FROM vessel_observations WHERE observed_at > now() - interval '15 minutes'`;

  // Named lookups so specific-vessel/aircraft questions ("이 선박 알려줘") resolve against the DB
  // rather than falling back to "no data". Match the query's distinctive tokens by name.
  const terms = nameTerms(query);
  let vesselMatches = [];
  let trackMatches = [];
  if (terms.length) {
    const patterns = terms.map((t) => `%${t}%`);
    // ILIKE ALL = name/callsign must contain every distinctive token → precise (avoids matching a
    // single common substring across unrelated vessels).
    [vesselMatches, trackMatches] = await Promise.all([
      sql`SELECT DISTINCT ON (mmsi) name, mmsi, vessel_type, sog_knots AS sog_kn, cog_deg, round(lat::numeric,3) AS lat, round(lon::numeric,3) AS lon, observed_at FROM vessel_observations WHERE observed_at > now() - interval '24 hours' AND name IS NOT NULL AND name ILIKE ALL(${patterns}) ORDER BY mmsi, observed_at DESC LIMIT 12`,
      sql`SELECT DISTINCT ON (icao24) callsign, icao24, region_id, altitude_m, velocity_ms, is_military, round(lat::numeric,3) AS lat, round(lon::numeric,3) AS lon, observed_at FROM track_observations WHERE observed_at > now() - interval '24 hours' AND callsign IS NOT NULL AND callsign ILIKE ALL(${patterns}) ORDER BY icao24, observed_at DESC LIMIT 12`,
    ]);
  }

  // Reliability-scored claims (same logic as the web verification panel), trimmed for the prompt.
  const assessed = await gatherClaims(sql, host);
  const claims = assessed.slice(0, 20).map((c) => ({ place: c.place, channel: c.channel, verdict: c.verdict, confidence: c.confidence, evidence: c.evidence, text: c.text.slice(0, 160) }));
  return {
    generatedAt: new Date().toISOString(),
    query,
    tracks: { total: tracks.length, military: tracks.filter((t) => t.is_military).length, sample: tracks, matches: trackMatches },
    vessels: { count: Number(ves?.v ?? 0), matches: vesselMatches },
    telegram: posts,
    claims,
  };
}

async function buildMil(sql) {
  const rows = await sql`SELECT DISTINCT ON (icao24) callsign, region_id, altitude_m FROM track_observations WHERE is_military AND observed_at > now() - interval '30 minutes' AND icao24 IS NOT NULL ORDER BY icao24, observed_at DESC LIMIT 15`;
  return rows;
}

const HELP = [
  'AirMaven 봇 — 내부 융합 데이터 조회',
  '',
  '/status — 최근 항적·선박·OSINT 요약',
  '/mil — 최근 30분 군용 추정 항적',
  '/verify [지명] — 텔레그램 주장 신뢰도 분석 (확인/가능성/미확인/허위)',
  '/ai <질문> — 현재 데이터 기반 AI 브리핑 (신뢰도 포함)',
  '/help — 도움말',
  '',
  '공개 데이터 융합 보조 · 비표적화',
].join('\n');

const DATA_COMMANDS = new Set(['/status', '/mil', '/verify', '/ai']);

const VERDICT_LABEL = { TRUE: '✅확인', LIKELY: '🟡가능성', 'NOT LIKELY': '🟠미확인', FALSE: '🔴허위' };

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ ok: false }); return; }
  // Verify the webhook secret so only Telegram (with our secret) can invoke this endpoint.
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    res.status(401).json({ ok: false }); return;
  }
  // Do the work and send the reply BEFORE responding: on serverless the function can be frozen the
  // moment the HTTP response is flushed, which would cut off the outbound sendMessage. Telegram
  // waits for our response (within maxDuration), so this is safe and it still receives a 200.
  try {
    await handleUpdate(req);
  } catch (e) {
    console.error('[tg] handler error:', e);
  }
  res.status(200).json({ ok: true });
}

async function handleUpdate(req) {
    const update = await readJson(req);
    const msg = update?.message ?? update?.edited_message;
    const text = typeof msg?.text === 'string' ? msg.text.trim() : '';
    const chatId = msg?.chat?.id;
    if (!chatId || !text) return;

    // /command@BotName arg… → command + rest
    const [rawCmd, ...restParts] = text.split(/\s+/);
    const cmd = rawCmd.toLowerCase().replace(/@.*$/, '');
    const rest = restParts.join(' ');

    if (cmd === '/start' || cmd === '/help') {
      await reply(chatId, `${HELP}\n\n당신의 chat id: ${chatId}`);
      return;
    }

    if (DATA_COMMANDS.has(cmd)) {
      // TELEGRAM_OPEN=1 → anyone who can reach the bot may run data commands (open demo mode).
      // Otherwise default-deny unless the caller's chat id is whitelisted.
      const open = process.env.TELEGRAM_OPEN === '1';
      const allow = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!open && !allow.includes(String(chatId))) {
        await reply(chatId, `권한이 없습니다. 이 chat id를 TELEGRAM_ALLOWED_CHAT_IDS에 추가하세요.\n당신의 chat id: ${chatId}`);
        return;
      }
      const sql = getSql();
      if (cmd === '/status') {
        const s = await buildStatus(sql);
        await reply(chatId, `📡 AirMaven 상황 (최근 15분)\n항적 ${s.ac}기 (군용 추정 ${s.mil})\n선박(AIS) ${s.v}척\nOSINT ${s.osint} · 텔레그램 ${s.telegram} (최근 6h)`);
        return;
      }
      if (cmd === '/mil') {
        const rows = await buildMil(sql);
        if (!rows.length) { await reply(chatId, '최근 30분 군용 추정 항적 없음. (신호 부재 ≠ 활동 부재)'); return; }
        const lines = rows.map((r) => `• ${r.callsign ?? '미상'} · ${r.region_id}${r.altitude_m != null ? ` · ${Math.round(r.altitude_m * 3.28084).toLocaleString()}ft` : ''}`);
        await reply(chatId, `🪖 군용 추정 항적 (최근 30분, ${rows.length})\n${lines.join('\n')}`);
        return;
      }
      if (cmd === '/verify') {
        const claims = await gatherClaims(sql, req.headers.host);
        const filtered = rest ? claims.filter((c) => c.place.toLowerCase().includes(rest.toLowerCase()) || c.text.toLowerCase().includes(rest.toLowerCase())) : claims;
        if (!filtered.length) {
          await reply(chatId, rest ? `"${rest}" 관련 지오로케이트된 텔레그램 주장이 없습니다. (지명이 가제티어에 있고 최근 24h 수집됐는지 확인)` : '지오로케이트 가능한 텔레그램 주장이 아직 없습니다.');
          return;
        }
        const lines = filtered.slice(0, 12).map((c) => `${VERDICT_LABEL[c.verdict]} ${c.confidence}% · ${c.place} (${c.channel})\n  ${c.text.slice(0, 100)}\n  └ ${c.evidence}`);
        await reply(chatId, `🔎 신뢰도 분석${rest ? ` · "${rest}"` : ''} (상위 ${Math.min(12, filtered.length)}/${filtered.length})\n\n${lines.join('\n\n')}\n\n공개 텔레그램 × NASA FIRMS 열적 × 교차출처 · 비표적화`);
        return;
      }
      if (cmd === '/ai') {
        const context = await buildAiContext(sql, req.headers.host, rest);
        const answer = await askOpenAI(rest, context);
        await reply(chatId, answer);
        return;
      }
    }

    await reply(chatId, `알 수 없는 명령입니다.\n\n${HELP}`);
}
