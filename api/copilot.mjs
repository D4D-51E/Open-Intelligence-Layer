// OpenAI copilot — two modes over the client's already-fused, region-scoped situation JSON:
//   mode 'summary'  → answers a natural-language question with a regional situation summary
//   mode 'anomaly'  → assesses tracks + rule-based anomalies for abnormal patterns / approach events
// Server-side only (OPENAI_API_KEY never reaches the browser). Graceful ok:false when no key,
// so the UI can show a keyless message instead of breaking. Grounds every claim ONLY in the
// provided data — public data, non-targeting.

import { getSql } from '../db/client.mjs';
import { lookupByName } from '../db/nameLookup.mjs';

export const config = { maxDuration: 30 };

const MODEL = process.env.COPILOT_MODEL ?? 'gpt-4o-mini';

// GPT-5 / o-series are reasoning models: they use max_completion_tokens (not max_tokens) and
// reject a custom temperature. Adapt the request shape by model so gpt-4o-mini and gpt-5.x both work.
export function chatParams(model, maxOut) {
  return /^(gpt-5|o\d)/.test(model)
    ? { max_completion_tokens: Math.max(maxOut, 1400), reasoning_effort: 'low' }
    : { temperature: 0.3, max_tokens: maxOut };
}

const SYSTEM_SUMMARY = `당신은 공개 데이터(공개 ADS-B 항적, AIS 선박, OSINT/텔레그램, FAA NOTAM, NASA FIRMS 열적, 공역) 기반 항공·해상 상황인식 융합 분석관입니다. 사용자의 질문에 대해 아래 규칙으로 한국어 브리핑을 작성하세요.
- 제공된 데이터에만 근거하고, 항공기/선박/사건/수치를 지어내지 마세요.
- 각 주장 끝에 출처를 대괄호로 표기: [ADS-B] [AIS] [OSINT] [텔레그램] [NOTAM] [FIRMS] [공역].
- 간결하고 사실 위주로. 데이터가 희소하면(조용한 시간대) 그렇다고 명시. 신호 부재 ≠ 활동 부재(군용기는 트랜스폰더를 끄고 비행하기도 함)임을 항적 0일 때 언급.
- 특정 선박/항공기 질문이면 context.vessels.matches / context.tracks.matches(이름으로 조회한 결과)를 먼저 보고 이름·종류·속도·침로·좌표·관측시각으로 답하세요. 비어 있으면 "현재 수집 범위 내 해당 명칭의 신호 없음"이라고만 하고 존재를 단정하지 마세요.
- context.telegramClaims 의 verdict·confidence·evidence(근거)로 신뢰도를 설명하세요. [검증]
- 식별·표적화·교전 판단이 아니라 공개 정보 융합 보조입니다. 마크다운 헤더/서두 없이 바로 본문.`;

const SYSTEM_ANOMALY = `당신은 공개 ADS-B 항적 이상징후 분석관입니다. 제공된 항적 요약과 규칙기반 이상탐지 결과를 바탕으로 비정상 항적(급격한 방위/고도 변화, 경로 이탈, 선회 등)과 접근 이벤트(관심공역/상호 근접)를 평가하세요.
- 제공된 데이터에만 근거. 지어내지 마세요.
- 가장 유의미한 이상징후를 우선순위 순으로 3~6개 bullet로, 각 항목에 대상(콜사인 등)과 한 줄 근거.
- 각 주장 끝 출처 표기 [ADS-B] [규칙탐지] [공역] 등.
- 이상징후가 없으면 "현재 뚜렷한 이상징후 없음"이라고 명시. 식별·표적화가 아닌 공개정보 보조. 마크다운 헤더 없이.`;

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try { return JSON.parse(raw || '{}'); } catch { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ ok: false, reason: 'method' }); return; }
  if (!process.env.OPENAI_API_KEY) { res.status(200).json({ ok: false, reason: 'no_key' }); return; }
  try {
    const body = await readJson(req);
    const mode = body?.mode === 'anomaly' ? 'anomaly' : 'summary';
    const query = String(body?.query ?? '').slice(0, 500);
    const context = body?.context ?? {};
    // Server-side name lookup (same as the telegram bot) so a specific vessel/aircraft in the
    // question resolves against the DB even if it's outside the client's viewport sample.
    if (mode !== 'anomaly' && query) {
      try {
        const { vesselMatches, trackMatches } = await lookupByName(getSql(), query);
        if (vesselMatches.length) context.vessels = { ...(context.vessels ?? {}), matches: vesselMatches };
        if (trackMatches.length) context.tracks = { ...(context.tracks ?? {}), matches: trackMatches };
      } catch { /* best-effort enrichment; fall back to client context */ }
    }
    // Prior conversation turns for multi-turn continuity (bounded to keep tokens sane).
    const history = Array.isArray(body?.history)
      ? body.history
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
          .slice(-8)
          .map((m) => ({ role: m.role, content: String(m.content).slice(0, 2000) }))
      : [];
    const system = mode === 'anomaly' ? SYSTEM_ANOMALY : SYSTEM_SUMMARY;
    const userContent = mode === 'anomaly'
      ? `현재 상황 데이터(JSON):\n${JSON.stringify(context, null, 2)}\n\n이상징후 분석을 지금 작성하세요.`
      : `현재 지역 상황 데이터(JSON):\n${JSON.stringify(context, null, 2)}\n\n질문: ${query || '현재 지역 상황을 요약해줘'}\n\n(이전 대화 맥락이 있으면 이어서) 답변을 지금 작성하세요.`;

    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(28000),
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: system }, ...history, { role: 'user', content: userContent }],
        ...chatParams(MODEL, 650),
      }),
    });
    if (!upstream.ok) {
      const t = await upstream.text();
      res.status(200).json({ ok: false, reason: 'error', message: `OpenAI ${upstream.status}: ${t.slice(0, 200)}` });
      return;
    }
    const data = await upstream.json();
    const text = (data?.choices?.[0]?.message?.content ?? '').trim();
    res.status(200).json({ ok: true, mode, text, model: data?.model ?? MODEL });
  } catch (error) {
    res.status(200).json({ ok: false, reason: 'error', message: String(error) });
  }
}
