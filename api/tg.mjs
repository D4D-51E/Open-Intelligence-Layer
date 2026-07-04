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

export const config = { maxDuration: 30 };

const API = (method) => `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`;

const SYSTEM = `당신은 공개 데이터(공개 ADS-B 항적, AIS 선박, OSINT/텔레그램) 기반 항공·해상 상황인식 융합 분석관입니다. 제공된 JSON 데이터에만 근거해 한국어로 간결히 답하세요. 항공기/선박/사건/수치를 지어내지 말고, 각 주장 끝에 출처를 [ADS-B][AIS][텔레그램] 등으로 표기하세요. 데이터가 희소하면 그렇다고 명시(신호 부재 ≠ 활동 부재). 식별·표적화가 아닌 공개정보 융합 보조입니다. 마크다운 헤더 없이 본문만.`;

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

async function buildAiContext(sql) {
  const tracks = await sql`SELECT DISTINCT ON (icao24) callsign, region_id, altitude_m, velocity_ms, is_military, round(lat::numeric,2) AS lat, round(lon::numeric,2) AS lon FROM track_observations WHERE observed_at > now() - interval '15 minutes' AND icao24 IS NOT NULL ORDER BY icao24, observed_at DESC LIMIT 40`;
  const posts = await sql`SELECT channel_label, left(text, 200) AS text FROM telegram_posts ORDER BY observed_at DESC LIMIT 10`;
  const [ves] = await sql`SELECT count(DISTINCT mmsi) AS v FROM vessel_observations WHERE observed_at > now() - interval '15 minutes'`;
  return {
    generatedAt: new Date().toISOString(),
    tracks: { total: tracks.length, military: tracks.filter((t) => t.is_military).length, sample: tracks },
    vessels: { count: Number(ves?.v ?? 0) },
    telegram: posts,
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
  '/ai <질문> — 현재 데이터 기반 AI 브리핑',
  '/help — 도움말',
  '',
  '공개 데이터 융합 보조 · 비표적화',
].join('\n');

const DATA_COMMANDS = new Set(['/status', '/mil', '/ai']);

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
      if (cmd === '/ai') {
        const context = await buildAiContext(sql);
        const answer = await askOpenAI(rest, context);
        await reply(chatId, answer);
        return;
      }
    }

    await reply(chatId, `알 수 없는 명령입니다.\n\n${HELP}`);
}
