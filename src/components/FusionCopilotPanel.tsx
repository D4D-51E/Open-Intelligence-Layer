import { CheckCircle2, ClipboardCheck, ExternalLink, Search, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { FusionEvent, FusionReviewStatus, QueryIntent, QueryModule } from '../lib/types';
import { safeExternalUrl } from '../lib/safeLinks';

export type QueryPreset = {
  id: string;
  label: string;
  query: string;
};

type FusionCopilotPanelProps = {
  query: string;
  presets: QueryPreset[];
  fusionEvents: FusionEvent[];
  reviewStates: Record<string, FusionReviewStatus>;
  intent?: QueryIntent;
  compact?: boolean;
  title?: string;
  eyebrow?: string;
  ariaLabel?: string;
  onQueryChange: (value: string) => void;
  onRunQuery: () => void;
  onPreset: (preset: QueryPreset) => void;
  onReviewChange: (eventId: string, status: FusionReviewStatus) => void;
};

const reviewLabels: Record<FusionReviewStatus, string> = {
  queued: '대기',
  needs_review: '검토 필요',
  confirmed: '확인됨',
  dismissed: '보류/무시',
};

const moduleLabels: Record<QueryModule, string> = {
  tracks: '항적',
  ships: '선박',
  weather: '기상',
  osint: 'OSINT',
  satellites: '위성',
  airspace: '공역',
  notices: '공지',
  fusion: '융합',
};

const focusLabels: Record<QueryIntent['focus'], string> = {
  overview: '개요',
  anomaly: '이상신호',
  activity: '활동 변화',
  'data-quality': '데이터 품질',
};

const reviewActions: Array<{ value: FusionReviewStatus; label: string; icon: ReactNode }> = [
  { value: 'needs_review', label: '검토', icon: <ClipboardCheck size={13} /> },
  { value: 'confirmed', label: '확인', icon: <CheckCircle2 size={13} /> },
  { value: 'dismissed', label: '보류', icon: <XCircle size={13} /> },
];

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function freshnessLabel(observedAt?: string) {
  if (!observedAt) return '시각 미상';
  const observedMs = Date.parse(observedAt);
  if (Number.isNaN(observedMs)) return '시각 미상';
  const ageMs = Math.max(0, Date.now() - observedMs);
  const minutes = Math.round(ageMs / 60_000);
  if (minutes < 90) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

function factorsLabel(fusionEvent: FusionEvent) {
  const { sourceReliability, freshness, crossSourceAgreement, missingDataPenalty } = fusionEvent.confidenceFactors;
  return `출처 ${percent(sourceReliability)} · 최신성 ${percent(freshness)} · 교차 ${percent(crossSourceAgreement)} · 공백 ${percent(missingDataPenalty)}`;
}

export function FusionCopilotPanel({
  query,
  presets,
  fusionEvents,
  reviewStates,
  intent,
  compact = false,
  title = '확인 대기',
  eyebrow = '질의',
  ariaLabel = '자연어 질의와 확인 대기',
  onQueryChange,
  onRunQuery,
  onPreset,
  onReviewChange,
}: FusionCopilotPanelProps) {
  return (
    <section className={`panel fusion-copilot-panel ${compact ? 'fusion-copilot-panel--compact' : ''}`} aria-label={ariaLabel}>
      <div className="panel__header panel__header--row">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        {intent ? (
          <span className="pill">
            {focusLabels[intent.focus]} · {intent.modules.slice(0, compact ? 3 : 5).map((module) => moduleLabels[module]).join('/')}
          </span>
        ) : null}
      </div>

      <form className="fusion-query" onSubmit={(event) => { event.preventDefault(); onRunQuery(); }}>
        <label htmlFor="fusion-query-input">자연어 질의</label>
        <div className="fusion-query__row">
          <input
            id="fusion-query-input"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="예: 대만해협 항적과 OSINT를 근거 중심으로 검토"
          />
          <button type="submit"><Search size={14} /> 적용</button>
        </div>
      </form>

      <div className="fusion-presets" aria-label="데모 질의 프리셋">
        {presets.map((preset) => (
          <button key={preset.id} type="button" onClick={() => onPreset(preset)}>
            {preset.label}
          </button>
        ))}
      </div>

      <div className="fusion-event-list">
        {fusionEvents.length === 0 ? (
          <p className="fusion-event-empty">현재 선택 지역에 융합할 실제 공개 데이터가 없습니다. 합성 이벤트는 만들지 않습니다.</p>
        ) : fusionEvents.map((fusionEvent) => {
          const status = reviewStates[fusionEvent.id] ?? fusionEvent.reviewDefault;
          return (
            <article key={fusionEvent.id} className={`fusion-event fusion-event--${fusionEvent.severity}`}>
              <div className="fusion-event__topline">
                <strong>{fusionEvent.title}</strong>
                <span>{reviewLabels[status]} · 신뢰도 {percent(fusionEvent.confidence)}</span>
              </div>
              <p>{fusionEvent.summary}</p>
              <small className="fusion-event__factors">{factorsLabel(fusionEvent)}</small>
              <div className="fusion-event__modules">
                {fusionEvent.modules.map((module) => <span key={module}>{moduleLabels[module] ?? module}</span>)}
              </div>
              <small className="fusion-event__safety">{compact ? '검토용 · 비표적화' : fusionEvent.safetyNote}</small>
              <small className="fusion-event__action">다음 확인: {fusionEvent.recommendedAction}</small>
              <div className="fusion-event__citations">
                {fusionEvent.citations.slice(0, compact ? 2 : 4).map((citation) => {
                  const safeUrl = safeExternalUrl(citation.url);
                  const label = `${citation.label} · ${citation.source} · ${percent(citation.confidence)} · ${freshnessLabel(citation.observedAt)}`;
                  return safeUrl ? (
                    <a key={citation.id} href={safeUrl} target="_blank" rel="noreferrer">{label} <ExternalLink size={11} /></a>
                  ) : <small key={citation.id}>{label}</small>;
                })}
              </div>
              <div className="fusion-event__review" aria-label={`${fusionEvent.title} 검토 상태`}>
                {reviewActions.map((action) => (
                  <button
                    key={action.value}
                    type="button"
                    className={status === action.value ? 'is-active' : ''}
                    onClick={() => onReviewChange(fusionEvent.id, action.value)}
                  >
                    {action.icon} {action.label}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
