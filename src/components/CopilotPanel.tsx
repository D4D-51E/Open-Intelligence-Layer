import { useState } from 'react';
import { Bot, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { askCopilot, type CopilotMode } from '../lib/copilotApi';

// OpenAI copilot pane: a natural-language query → regional situation summary, plus a one-click
// anomaly analysis over the current fused situation. Grounded in the passed `context`.
export function CopilotPanel({ context }: { context: unknown }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState<CopilotMode | null>(null);
  const [result, setResult] = useState<{ mode: CopilotMode; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (mode: CopilotMode, q?: string) => {
    setLoading(mode);
    setError(null);
    const res = await askCopilot(mode, context, q);
    setLoading(null);
    if (res.ok && res.text) {
      setResult({ mode, text: res.text });
    } else {
      setResult(null);
      setError(res.reason === 'no_key'
        ? '서버에 OPENAI_API_KEY가 설정되지 않았습니다.'
        : (res.message ?? '요청에 실패했습니다.'));
    }
  };

  return (
    <div className="copilot">
      <form
        className="copilot-query"
        onSubmit={(e) => { e.preventDefault(); if (query.trim() && loading === null) void run('summary', query.trim()); }}
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="질문 예: 현재 서해 상황 요약해줘"
          aria-label="자연어 질의"
        />
        <button type="submit" disabled={loading !== null || !query.trim()}>
          {loading === 'summary' ? <Loader2 className="copilot-spin" size={13} /> : <Sparkles size={13} />} 요약
        </button>
      </form>
      <button type="button" className="copilot-anomaly-btn" onClick={() => void run('anomaly')} disabled={loading !== null}>
        {loading === 'anomaly' ? <Loader2 className="copilot-spin" size={13} /> : <TriangleAlert size={13} />} 이상징후 분석
      </button>

      {error ? <p className="copilot-error">{error}</p> : null}
      {result ? (
        <article className="copilot-result">
          <div className="copilot-result__head">
            <Bot size={12} /> {result.mode === 'anomaly' ? '이상징후 분석' : '상황 요약'} · OpenAI
          </div>
          <p>{result.text}</p>
          <small>공개 데이터 융합 보조입니다. 식별·표적화·교전 판단이 아닙니다.</small>
        </article>
      ) : loading ? (
        <p className="copilot-hint">분석 중…</p>
      ) : (
        <p className="copilot-hint">
          자연어로 질문하거나 이상징후 분석을 실행하세요. 현재 화면의 항적·선박·OSINT·검증·규칙기반 이상탐지를 근거로 OpenAI가 요약합니다.
        </p>
      )}
    </div>
  );
}
