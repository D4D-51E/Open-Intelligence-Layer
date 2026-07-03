import { ExternalLink, FileText } from 'lucide-react';
import type { Briefing } from '../lib/types';
import { safeExternalUrl } from '../lib/safeLinks';
import { generatedByLabel } from '../lib/display';

export function BriefingPanel({ briefing }: { briefing: Briefing }) {
  return (
    <section className="panel briefing-panel">
      <div className="panel__header panel__header--row">
        <div>
          <p className="eyebrow">분석 브리핑</p>
          <h2>{briefing.headline}</h2>
        </div>
        <span className="pill">{generatedByLabel(briefing.generatedBy)}</span>
      </div>
      <p className="briefing-summary">{briefing.situationSummary}</p>
      <div className="briefing-grid">
        <div>
          <h3>핵심 관찰</h3>
          <ul>
            {briefing.keyFindings.map((finding) => <li key={finding}>{finding}</li>)}
          </ul>
        </div>
        <div>
          <h3>다음 확인</h3>
          <ul>
            {briefing.recommendedNextChecks.map((check) => <li key={check}>{check}</li>)}
          </ul>
        </div>
      </div>
      <div className="caveat-box">
        <FileText size={16} />
        <ul>
          {briefing.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
        </ul>
      </div>
      <h3>근거 카드</h3>
      <div className="source-cards">
        {briefing.citations.slice(0, 8).map((cite) => {
          const safeUrl = safeExternalUrl(cite.url);
          return (
            <article key={cite.id} className="source-card">
              <strong>{cite.label}</strong>
              <p>{cite.source} · 신뢰도 {Math.round(cite.confidence * 100)}%</p>
              {cite.observedAt && <small>{new Date(cite.observedAt).toLocaleString()}</small>}
              {safeUrl && <a href={safeUrl} target="_blank" rel="noreferrer">원문 열기 <ExternalLink size={12} /></a>}
            </article>
          );
        })}
      </div>
    </section>
  );
}
