import { ExternalLink, FileWarning, Radar, ShieldCheck } from 'lucide-react';
import type { EvidenceItem, EvidenceStance, VerificationCase, VerificationVerdictLabel } from '../lib/types';
import { safeExternalUrl } from '../lib/safeLinks';

type VerificationPanelProps = {
  verificationCase?: VerificationCase;
  compact?: boolean;
};

const verdictLabels: Record<VerificationVerdictLabel, string> = {
  confirmed: 'Confirmed',
  likely_true: 'Likely True',
  plausible_unverified: 'Plausible / Unverified',
  inconclusive: 'Inconclusive',
  likely_false: 'Likely False',
  false: 'False / Deceptive',
};

const stanceLabels: Record<EvidenceStance, string> = {
  supports: '지지',
  contradicts: '반박',
  gap: '공백',
  context: '맥락',
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatTime(value?: string) {
  if (!value) return '시각 미상';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '시각 미상';
  return date.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function groupedEvidence(evidence: EvidenceItem[]) {
  return {
    supports: evidence.filter((item) => item.stance === 'supports'),
    contradicts: evidence.filter((item) => item.stance === 'contradicts'),
    gap: evidence.filter((item) => item.stance === 'gap'),
    context: evidence.filter((item) => item.stance === 'context'),
  };
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  const safeUrl = safeExternalUrl(item.url);
  return (
    <article className={`evidence-row evidence-row--${item.stance}`}>
      <div className="evidence-row__topline">
        <strong>{item.title}</strong>
        <span>{stanceLabels[item.stance]} · {percent(item.confidence)}</span>
      </div>
      <p>{item.summary}</p>
      <small>{item.source} · {item.category} · {formatTime(item.observedAt)}</small>
      {item.caveat ? <small className="evidence-row__caveat">주의: {item.caveat}</small> : null}
      {safeUrl ? <a href={safeUrl} target="_blank" rel="noreferrer">근거 열기 <ExternalLink size={11} /></a> : null}
    </article>
  );
}

export function VerificationPanel({ verificationCase, compact = false }: VerificationPanelProps) {
  if (!verificationCase) {
    return (
      <section className="panel verification-panel" aria-label="검증 판정">
        <div className="panel__header">
          <p className="eyebrow">Verdict</p>
          <h2>검증 대상 없음</h2>
        </div>
        <p className="verification-empty">Claim Queue에서 검증할 주장을 선택하세요.</p>
      </section>
    );
  }

  const groups = groupedEvidence(verificationCase.evidence);
  const evidenceToRender = compact
    ? [...groups.contradicts, ...groups.supports, ...groups.gap, ...groups.context].slice(0, 7)
    : verificationCase.evidence;

  return (
    <section className={`panel verification-panel verification-panel--${verificationCase.verdict.label} ${compact ? 'verification-panel--compact' : ''}`} aria-label="검증 판정">
      <div className="panel__header panel__header--row">
        <div>
          <p className="eyebrow">Verdict</p>
          <h2>{verificationCase.claim.shortTitle}</h2>
        </div>
        <span className={`verdict-badge verdict-badge--${verificationCase.verdict.label}`}>
          <ShieldCheck size={14} /> {verdictLabels[verificationCase.verdict.label]} · {percent(verificationCase.verdict.confidence)}
        </span>
      </div>

      <div className="verification-summary">
        <p>{verificationCase.verdict.summary}</p>
        <small>{verificationCase.claim.claimedLocation.name} · 주장 시각 {formatTime(verificationCase.claim.claimedAt)} · {verificationCase.claim.actor}</small>
      </div>

      <div className="evidence-matrix" aria-label="근거 매트릭스">
        <span><strong>{groups.supports.length}</strong>지지</span>
        <span><strong>{groups.contradicts.length}</strong>반박</span>
        <span><strong>{groups.gap.length}</strong>공백</span>
        <span><strong>{groups.context.length}</strong>맥락</span>
      </div>

      <div className="evidence-list">
        {evidenceToRender.map((item) => <EvidenceRow key={item.id} item={item} />)}
      </div>

      <div className="verification-next-checks">
        <h3><Radar size={14} /> 다음 확인</h3>
        <ul>
          {verificationCase.verdict.nextChecks.slice(0, compact ? 3 : 4).map((check) => <li key={check}>{check}</li>)}
        </ul>
      </div>

      {!compact && (
        <div className="verification-caveats">
          <h3><FileWarning size={14} /> 한계</h3>
          <ul>
            {verificationCase.verdict.caveats.map((caveat) => <li key={caveat}>{caveat}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
