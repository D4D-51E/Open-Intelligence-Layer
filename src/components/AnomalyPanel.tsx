import { AlertTriangle, ExternalLink, Info, ShieldAlert } from 'lucide-react';
import type { Anomaly } from '../lib/types';
import { safeExternalUrl } from '../lib/safeLinks';

function Icon({ severity }: { severity: Anomaly['severity'] }) {
  if (severity === 'warning') return <ShieldAlert size={18} />;
  if (severity === 'watch') return <AlertTriangle size={18} />;
  return <Info size={18} />;
}

type AnomalyPanelProps = {
  anomalies: Anomaly[];
  compact?: boolean;
};

function anomalyObservedAt(anomaly: Anomaly) {
  const timestamps = anomaly.citations
    .map((cite) => cite.observedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (!timestamps.length) return null;
  return new Date(Math.max(...timestamps)).toISOString();
}

function formatSignalTime(value: string | null) {
  if (!value) return '시간 미확인';
  return new Date(value).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function AnomalyPanel({ anomalies, compact = false }: AnomalyPanelProps) {
  return (
    <section className="panel anomaly-panel">
      <div className="panel__header">
        <p className="eyebrow">경보</p>
        <h2>확인 신호</h2>
      </div>
      <div className="anomaly-list">
        {anomalies.length === 0 ? (
          <p className="anomaly-empty">현재 즉시 확인할 경보는 없습니다.</p>
        ) : anomalies.map((anomaly) => (
          <article className={`anomaly-card anomaly-card--${anomaly.severity}`} key={anomaly.id}>
            <div className="anomaly-card__title">
              <Icon severity={anomaly.severity} />
              <strong>{anomaly.title}</strong>
              <span>신뢰도 {Math.round(anomaly.confidence * 100)}%</span>
            </div>
            {compact && (
              <small className="anomaly-card__meta">
                확인 {formatSignalTime(anomalyObservedAt(anomaly))}
                {' · '}
                근거 {anomaly.citations.length}
                {' · '}
                항적 {anomaly.relatedTrackIds.length}
              </small>
            )}
            {!compact && <p>{anomaly.description}</p>}
            {!compact && (
              <div className="citation-mini-row">
                {anomaly.citations.slice(0, 3).map((cite) => {
                  const safeUrl = safeExternalUrl(cite.url);
                  const label = `${cite.label} · ${cite.source} · ${Math.round(cite.confidence * 100)}%`;
                  return safeUrl ? (
                    <a key={cite.id} href={safeUrl} target="_blank" rel="noreferrer">
                      {label} <ExternalLink size={11} />
                    </a>
                  ) : <small key={cite.id}>{label}</small>;
                })}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
