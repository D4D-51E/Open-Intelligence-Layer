export type IngestLogEntry = {
  id: string;
  at: string;
  level: 'info' | 'warn' | 'error';
  message: string;
};

function levelLabel(level: IngestLogEntry['level']) {
  if (level === 'warn') return '주의';
  if (level === 'error') return '오류';
  return '정보';
}

export function IngestLogPanel({ logs }: { logs: IngestLogEntry[] }) {
  return (
    <section className="panel ingest-log-panel" aria-label="라이브 수집 로그">
      <div className="panel__header panel__header--row">
        <div>
          <p className="eyebrow">수집 로그</p>
          <h2>수집 상태</h2>
        </div>
        <span className="pill">터미널</span>
      </div>
      <div className="ingest-log" role="log" aria-live="polite" aria-relevant="additions">
        {logs.length === 0 ? (
          <p className="ingest-log__empty">첫 캐시 확인 대기 중...</p>
        ) : logs.map((entry) => (
          <article key={entry.id} className={`ingest-log__line ingest-log__line--${entry.level}`}>
            <time>{new Date(entry.at).toLocaleTimeString([], { hour12: false })}</time>
            <strong>{levelLabel(entry.level)}</strong>
            <span>{entry.message}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
