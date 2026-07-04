import { AlertTriangle, CheckCircle2, CircleHelp, ShieldQuestion } from 'lucide-react';
import type { VerificationCase, VerificationVerdictLabel } from '../lib/types';

type ClaimQueuePanelProps = {
  cases: VerificationCase[];
  activeClaimId?: string;
  compact?: boolean;
  onSelect: (claimId: string) => void;
};

const verdictLabels: Record<VerificationVerdictLabel, string> = {
  confirmed: '확인됨',
  likely_true: '사실 가능성 높음',
  plausible_unverified: '가능·미검증',
  inconclusive: '결론 보류',
  likely_false: '허위 가능성 높음',
  false: '허위 가능성 매우 높음',
};

function VerdictIcon({ label }: { label: VerificationVerdictLabel }) {
  if (label === 'confirmed' || label === 'likely_true') return <CheckCircle2 size={15} />;
  if (label === 'false' || label === 'likely_false') return <AlertTriangle size={15} />;
  if (label === 'plausible_unverified') return <ShieldQuestion size={15} />;
  return <CircleHelp size={15} />;
}

function evidenceCounts(verificationCase: VerificationCase) {
  return {
    supports: verificationCase.evidence.filter((item) => item.stance === 'supports').length,
    contradicts: verificationCase.evidence.filter((item) => item.stance === 'contradicts').length,
    gaps: verificationCase.evidence.filter((item) => item.stance === 'gap').length,
  };
}

export function ClaimQueuePanel({ cases, activeClaimId, compact = false, onSelect }: ClaimQueuePanelProps) {
  return (
    <section className={`panel claim-queue-panel ${compact ? 'claim-queue-panel--compact' : ''}`} aria-label="검증 주장 대기열">
      <div className="panel__header panel__header--row">
        <div>
          <p className="eyebrow">Claim Queue</p>
          <h2>주장 검증 대기열</h2>
        </div>
        <span className="pill">{cases.length}건</span>
      </div>
      <div className="claim-queue-list" role="list">
        {cases.length === 0 ? (
          <p className="claim-queue-empty">현재 선택 AOI에 검증할 주장이 없습니다.</p>
        ) : cases.map((verificationCase) => {
          const counts = evidenceCounts(verificationCase);
          const active = verificationCase.claim.id === activeClaimId;
          return (
            <div key={verificationCase.claim.id} role="listitem">
              <button
                type="button"
                className={`claim-card claim-card--${verificationCase.verdict.label} ${active ? 'is-active' : ''}`}
                onClick={() => onSelect(verificationCase.claim.id)}
                aria-pressed={active}
              >
                <span className="claim-card__topline">
                  <strong>{verificationCase.claim.shortTitle}</strong>
                  <em><VerdictIcon label={verificationCase.verdict.label} /> {verdictLabels[verificationCase.verdict.label]}</em>
                </span>
                {!compact && <span className="claim-card__summary">{verificationCase.claim.claimSummary}</span>}
                <span className="claim-card__meta">
                  {verificationCase.claim.claimedLocation.name} · 근거 {verificationCase.evidence.length} · 지지 {counts.supports} / 반박 {counts.contradicts} / 공백 {counts.gaps}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
