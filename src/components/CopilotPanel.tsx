import { useEffect, useRef, useState } from 'react';
import { Bot, Loader2, Sparkles, TriangleAlert } from 'lucide-react';
import { askCopilot, type ChatMessage, type CopilotMode } from '../lib/copilotApi';

// OpenAI copilot — multi-turn chat over the current fused situation. Natural-language questions
// (with prior-turn continuity) get a regional summary; a one-tap button runs anomaly analysis.
// Every turn is grounded in the live `context` snapshot passed from App.
export function CopilotPanel({ context }: { context: unknown }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState<CopilotMode | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  const run = async (mode: CopilotMode, q?: string) => {
    if (loading !== null) return;
    const userText = mode === 'anomaly' ? '이상징후 분석' : (q ?? '').trim();
    if (mode === 'summary' && !userText) return;
    const history = messages.slice(-8); // prior turns for continuity
    setMessages((prev) => [...prev, { role: 'user', content: userText }]);
    if (mode === 'summary') setQuery('');
    setLoading(mode);
    const res = await askCopilot(mode, context, q, history);
    setLoading(null);
    const reply = res.ok && res.text
      ? res.text
      : (res.reason === 'no_key' ? '⚠ 서버에 OPENAI_API_KEY가 설정되지 않았습니다.' : `⚠ 요청 실패: ${res.message ?? res.reason ?? 'unknown'}`);
    setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
  };

  return (
    <div className="copilot">
      <div className="copilot-thread" ref={threadRef}>
        {messages.length === 0 && loading === null ? (
          <p className="copilot-hint">
            자연어로 질문하면 이어지는 대화(멀티턴)로 답합니다. 현재 화면의 항적·선박·OSINT·검증·규칙기반 이상탐지를 근거로 OpenAI가 요약합니다. "이상징후" 버튼으로 즉시 분석도 가능합니다.
          </p>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={`copilot-msg copilot-msg--${m.role}`}>
            <div className="copilot-msg__role">{m.role === 'user' ? '나' : <><Bot size={11} /> AI</>}</div>
            <p>{m.content}</p>
          </div>
        ))}
        {loading !== null ? (
          <div className="copilot-msg copilot-msg--assistant">
            <div className="copilot-msg__role"><Bot size={11} /> AI</div>
            <p><Loader2 className="copilot-spin" size={13} /> {loading === 'anomaly' ? '이상징후 분석 중…' : '분석 중…'}</p>
          </div>
        ) : null}
      </div>

      <div className="copilot-actions">
        <button type="button" className="copilot-anomaly-btn" onClick={() => void run('anomaly')} disabled={loading !== null}>
          <TriangleAlert size={12} /> 이상징후
        </button>
        {messages.length > 0 ? (
          <button type="button" className="copilot-clear-btn" onClick={() => setMessages([])} disabled={loading !== null}>
            새 대화
          </button>
        ) : null}
      </div>

      <form className="copilot-query" onSubmit={(e) => { e.preventDefault(); void run('summary', query); }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="질문 예: 이 지역 상황 요약 / 위 항적 더 설명해줘"
          aria-label="자연어 질의"
        />
        <button type="submit" disabled={loading !== null || !query.trim()} aria-label="전송">
          {loading === 'summary' ? <Loader2 className="copilot-spin" size={14} /> : <Sparkles size={14} />}
        </button>
      </form>
      <small className="copilot-note">공개 데이터 융합 보조입니다. 식별·표적화·교전 판단이 아닙니다.</small>
    </div>
  );
}
