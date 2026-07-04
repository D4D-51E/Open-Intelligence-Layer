import { Bot, Clock, ExternalLink, Layers, Plane, Radio, Satellite, ShieldAlert, ShieldCheck, Ship } from 'lucide-react';
import { useState } from 'react';
import type { Citation, FusionEvent, SatellitePass, ShipTrack, TimelineEvent, Track } from '../lib/types';
import { VERDICT_COLOR, type AssessedClaim, type Verdict } from '../lib/claimVerify';
import { CopilotPanel } from './CopilotPanel';
import type { TrackFusionAxis, TrackFusionContext } from '../lib/trackFusion';
import type { AircraftIdentity } from '../lib/aircraftIdentity';
import type { AirspaceKind, AirspaceMatch } from '../lib/noticeAirspace';
import { vesselTypeLabel } from '../lib/display';
import { safeExternalUrl } from '../lib/safeLinks';
import { Timeline } from './Timeline';

type LiveTrackTab = 'tracks' | 'fusion' | 'history' | 'verify' | 'copilot';

// Cap tab counts so a growing number never overflows the narrow 5-column tab strip.
const tabCount = (n: number) => (n > 99 ? '99+' : String(n));

type LiveTrackPanelProps = {
  regionName: string;
  tracks: Track[];
  selectedTrackId?: string;
  onSelectTrack: (trackId: string) => void;
  fusionContext: TrackFusionContext | null;
  fusionEvents: FusionEvent[];
  timeline: TimelineEvent[];
  militaryCount: number;
  identity: AircraftIdentity | null;
  activeAirspace: AirspaceMatch[];
  ships: ShipTrack[];
  selectedShipId?: string;
  onSelectShip: (shipId: string) => void;
  satellites: SatellitePass[];
  selectedSatelliteId?: string;
  onSelectSatellite: (satelliteId: string) => void;
  satellitesEnabled: boolean;
  claims: AssessedClaim[];
  copilotContext: unknown;
};

const satelliteRoleLabel: Record<SatellitePass['roleHint'], string> = {
  communications: '통신',
  weather: '기상',
  'earth observation': '지구관측',
  'public orbital awareness': '궤도인식',
};

const airspaceKindLabels: Record<AirspaceKind, string> = {
  MOA: 'MOA(군작전구역)',
  TRA: 'TRA(임시예약공역)',
  DANGER: '위험구역(Danger)',
  RESTRICTED: '제한구역(Restricted)',
  PROHIBITED: '금지구역(Prohibited)',
  TSA: 'TSA(임시분리공역)',
  CTR: '관제권(CTR)',
  GENERIC: '공역 공지',
};

function observationSummary(track: Track): string {
  const points = track.points;
  if (!points.length) return '세션 관측 데이터 없음';
  const firstAt = points[0].observedAt;
  const lastAt = points[points.length - 1].observedAt;
  const spanMin = Math.max(0, Math.round((Date.parse(lastAt) - Date.parse(firstAt)) / 60_000));
  const firstMs = Date.parse(firstAt);
  const firstLabel = Number.isNaN(firstMs)
    ? ''
    : ` · 첫 관측 ${new Date(firstMs).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}`;
  return `세션 관측 ${points.length}점 · ${spanMin}분${firstLabel}`;
}

function IdRow({ label, value }: { label: string; value: string }) {
  return (
    <li className="track-fusion-axis">
      <span className="track-fusion-axis__label">{label}</span>
      <span className="track-fusion-axis__detail">{value}</span>
    </li>
  );
}

function AircraftIdentityCard({ identity, track, activeAirspace }: { identity: AircraftIdentity | null; track?: Track; activeAirspace: AirspaceMatch[] }) {
  if (!identity) return null;
  const icaoLine = [
    identity.icao24 ? `ICAO24 ${identity.icao24}` : null,
    identity.registrationCountry ? `등록국 ${identity.registrationCountry}` : null,
  ].filter(Boolean).join(' · ');
  return (
    <article className="aircraft-identity-card" aria-label={`${identity.callsign} 식별`}>
      <div className="track-fusion-card__head">
        <strong>{identity.callsign} 식별</strong>
        {identity.militaryLikely
          ? <span className="pill pill--military"><ShieldAlert size={12} /> 군용 추정</span>
          : <span className="pill">민간 추정</span>}
      </div>
      <ul className="track-fusion-axes">
        {identity.callsignProgram ? <IdRow label="콜사인" value={identity.callsignProgram} /> : null}
        {icaoLine ? <IdRow label="ICAO24" value={icaoLine} /> : null}
        {identity.operatorCandidates.length > 0 ? <IdRow label="운영자" value={`${identity.operatorCandidates.join(' · ')} (추정)`} /> : null}
        {identity.typeCandidate ? <IdRow label="기종" value={identity.typeCandidate} /> : null}
        {identity.registration ? <IdRow label="등록" value={identity.registration} /> : null}
        {track ? <IdRow label="관측" value={observationSummary(track)} /> : null}
      </ul>
      {activeAirspace.length > 0 ? (
        <div className="aircraft-identity-airspace">
          {activeAirspace.map((match) => {
            const fl = match.airspace.flMin != null || match.airspace.flMax != null
              ? ` · FL${match.airspace.flMin ?? '?'}–${match.airspace.flMax ?? '?'}${match.withinAltBand ? ' · 고도대 걸림' : ''}`
              : '';
            return (
              <p key={match.notice.id} className={match.withinAltBand ? 'is-hot' : ''}>
                활성 공역: {airspaceKindLabels[match.airspace.kind]} · 반경 내{fl} · {match.notice.title}
              </p>
            );
          })}
        </div>
      ) : null}
      {identity.notes.length > 0 ? <small className="track-fusion-safety">{identity.notes.join(' · ')}</small> : null}
    </article>
  );
}

const platformLabels: Record<Track['platformType'], string> = {
  commercial: '민항',
  cargo: '화물',
  unknown: '미식별',
};

const axisLabels: Record<TrackFusionAxis['kind'], string> = {
  weather: '기상',
  satellite: '위성',
  airspace: '공역',
  osint: 'OSINT',
  anomaly: '이상',
};

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function freshnessLabel(observedAt?: string) {
  if (!observedAt) return '시각 미상';
  const observedMs = Date.parse(observedAt);
  if (Number.isNaN(observedMs)) return '시각 미상';
  const minutes = Math.max(0, Math.round((Date.now() - observedMs) / 60_000));
  if (minutes < 90) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

function CitationLink({ citation, showLabel, className, iconSize = 11 }: { citation: Citation; showLabel: boolean; className?: string; iconSize?: number }) {
  const safeUrl = safeExternalUrl(citation.url);
  const text = `${showLabel ? `${citation.label} · ` : ''}${citation.source} · ${freshnessLabel(citation.observedAt)}`;
  return safeUrl
    ? <a className={className} href={safeUrl} target="_blank" rel="noreferrer">{text} <ExternalLink size={iconSize} /></a>
    : <small className={className}>{text}</small>;
}

type SortKey = 'callsign' | 'type' | 'altitude' | 'speed' | 'recency' | 'military';
type SortDir = 'asc' | 'desc';

const sortColumns: Array<{ key: SortKey; label: string }> = [
  { key: 'callsign', label: '호출부호' },
  { key: 'type', label: '유형' },
  { key: 'altitude', label: '고도' },
  { key: 'speed', label: '속도' },
  { key: 'recency', label: '최신성' },
];

function trackSortValue(track: Track, key: SortKey): string | number {
  const last = track.points.at(-1);
  switch (key) {
    case 'callsign':
      return track.callsign;
    case 'type':
      return track.platformType;
    case 'altitude':
      return last ? last.altitudeM : -Infinity;
    case 'speed':
      return last ? last.velocityMs : -Infinity;
    case 'recency': {
      const observedMs = last ? Date.parse(last.observedAt) : NaN;
      return Number.isNaN(observedMs) ? -Infinity : observedMs;
    }
    case 'military':
      return Number(track.isMilitary);
    default:
      return -Infinity;
  }
}

function compareSortValues(a: string | number, b: string | number): number {
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b);
  return (a as number) - (b as number);
}

function SortCaret({ direction }: { direction: SortDir }) {
  return <span className="live-track-sort-caret">{direction === 'asc' ? '▲' : '▼'}</span>;
}

function TrackTable({ tracks, selectedTrackId, onSelectTrack }: Pick<LiveTrackPanelProps, 'tracks' | 'selectedTrackId' | 'onSelectTrack'>) {
  const [sortKey, setSortKey] = useState<SortKey>('recency');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  if (tracks.length === 0) {
    return <p className="live-track-empty">현재 선택 AOI에 노출된 실시간 항적이 없습니다. 합성 항적은 만들지 않습니다.</p>;
  }

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sortedTracks = [...tracks].sort((a, b) => {
    const cmp = compareSortValues(trackSortValue(a, sortKey), trackSortValue(b, sortKey));
    return sortDir === 'asc' ? cmp : -cmp;
  });

  return (
    <div className="live-track-table" role="table" aria-label="실시간 항적 목록">
      <div className="live-track-table__head" role="row">
        {sortColumns.map((column) => {
          const isMilitaryActive = column.key === 'callsign' && sortKey === 'military';
          const isActive = sortKey === column.key || isMilitaryActive;
          const ariaSort = isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';
          return (
            <span key={column.key} role="columnheader" aria-sort={ariaSort}>
              <button
                type="button"
                className={`live-track-th ${sortKey === column.key ? `is-sorted-${sortDir}` : ''}`}
                onClick={() => handleSort(column.key)}
              >
                {column.label}
                {sortKey === column.key ? <SortCaret direction={sortDir} /> : null}
              </button>
              {column.key === 'callsign' ? (
                <button
                  type="button"
                  className={`live-track-th live-track-th--military ${isMilitaryActive ? `is-sorted-${sortDir}` : ''}`}
                  aria-label="군용 우선 정렬"
                  onClick={() => handleSort('military')}
                >
                  <ShieldAlert size={11} />
                  {isMilitaryActive ? <SortCaret direction={sortDir} /> : null}
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
      <div className="live-track-table__body">
        {sortedTracks.map((track) => {
          const last = track.points.at(-1);
          const active = track.id === selectedTrackId;
          return (
            <button
              key={track.id}
              type="button"
              role="row"
              className={`live-track-row ${track.isMilitary ? 'live-track-row--military' : ''} ${active ? 'is-active' : ''}`}
              aria-pressed={active}
              onClick={() => onSelectTrack(track.id)}
            >
              <span className="live-track-row__callsign" role="cell">
                {track.isMilitary ? <ShieldAlert size={13} aria-label="군용 ADS-B" /> : <Plane size={13} />}
                {track.callsign}
              </span>
              <span role="cell">
                {platformLabels[track.platformType]}
                {track.isMilitary ? <em className="live-track-badge">군용</em> : null}
              </span>
              <span role="cell">{last ? `${Math.round(last.altitudeM * 3.28084).toLocaleString('ko-KR')}ft` : '-'}</span>
              <span role="cell">{last ? `${Math.round(last.velocityMs * 1.94384)}kn` : '-'}</span>
              <span role="cell">{freshnessLabel(last?.observedAt)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ShipTable({ ships, selectedShipId, onSelectShip }: { ships: ShipTrack[]; selectedShipId?: string; onSelectShip: (shipId: string) => void }) {
  if (ships.length === 0) {
    return <p className="live-track-empty">현재 뷰포트에 표시된 선박(AIS)이 없습니다. 합성 데이터는 만들지 않습니다.</p>;
  }
  const sorted = [...ships].sort((a, b) => {
    const ta = Date.parse(a.points.at(-1)?.observedAt ?? '') || 0;
    const tb = Date.parse(b.points.at(-1)?.observedAt ?? '') || 0;
    return tb - ta;
  });
  return (
    <div className="live-track-table live-track-table--ships" role="table" aria-label="실시간 선박 목록">
      <div className="live-track-table__head" role="row">
        <span role="columnheader">선박</span>
        <span role="columnheader">유형</span>
        <span role="columnheader">속도</span>
        <span role="columnheader">최신성</span>
      </div>
      <div className="live-track-table__body">
        {sorted.map((ship) => {
          const last = ship.points.at(-1);
          const active = ship.id === selectedShipId;
          return (
            <button
              key={ship.id}
              type="button"
              role="row"
              className={`live-track-row live-track-row--ship ${active ? 'is-active' : ''}`}
              aria-pressed={active}
              onClick={() => onSelectShip(ship.id)}
            >
              <span className="live-track-row__callsign" role="cell">
                <Ship size={13} aria-label="AIS 선박" />
                {ship.name}
              </span>
              <span role="cell">{vesselTypeLabel(ship.vesselType)}</span>
              <span role="cell">{last ? `${last.speedKnots}kn` : '-'}</span>
              <span role="cell">{freshnessLabel(last?.observedAt)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SatelliteTable({ satellites, selectedSatelliteId, onSelectSatellite, enabled }: { satellites: SatellitePass[]; selectedSatelliteId?: string; onSelectSatellite: (id: string) => void; enabled: boolean }) {
  if (!enabled) {
    return <p className="live-track-empty">HUD의 위성 토글을 켜면 실시간 궤도 위성이 표시됩니다.</p>;
  }
  if (satellites.length === 0) {
    return <p className="live-track-empty">현재 화면에 위성이 없습니다. 지도를 확대(줌인)하면 화면 영역을 지나는 위성만 표시됩니다. 공개 TLE로 계산한 위치입니다.</p>;
  }
  // Show the lowest (typically most operationally relevant / fastest-moving) first, capped so a
  // dense overhead pass never floods the DOM. Bulk catalogues can put hundreds in one viewport.
  const sorted = [...satellites].sort((a, b) => a.altitudeKm - b.altitudeKm).slice(0, 200);
  return (
    <div className="live-track-table live-track-table--sats" role="table" aria-label="실시간 위성 목록">
      <div className="live-track-table__head" role="row">
        <span role="columnheader">위성</span>
        <span role="columnheader">분류</span>
        <span role="columnheader">고도</span>
        <span role="columnheader">방향</span>
      </div>
      <div className="live-track-table__body">
        {sorted.map((sat) => {
          const active = sat.id === selectedSatelliteId;
          return (
            <button
              key={sat.id}
              type="button"
              role="row"
              className={`live-track-row live-track-row--sat ${active ? 'is-active' : ''}`}
              aria-pressed={active}
              onClick={() => onSelectSatellite(sat.id)}
            >
              <span className="live-track-row__callsign" role="cell">
                <Satellite size={13} aria-label="위성" />
                {sat.name}
              </span>
              <span role="cell">{satelliteRoleLabel[sat.roleHint]}</span>
              <span role="cell">{sat.altitudeKm.toLocaleString('ko-KR')}km</span>
              <span role="cell">{sat.direction}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TrackFusionCard({ context }: { context: TrackFusionContext | null }) {
  if (!context) {
    return <p className="track-fusion-empty">항적을 선택하면 궤도·기상·공역·OSINT 융합 컨텍스트를 표시합니다.</p>;
  }
  return (
    <article className="track-fusion-card" aria-label={`${context.callsign} 융합 컨텍스트`}>
      <div className="track-fusion-card__head">
        <strong>{context.callsign} 융합 컨텍스트</strong>
        <span className="pill">축 {context.axes.filter((axis) => axis.present).length}/{context.axes.length}</span>
      </div>
      <ul className="track-fusion-axes">
        {context.axes.map((axis) => (
          <li key={axis.kind} className={`track-fusion-axis ${axis.present ? '' : 'is-absent'}`}>
            <span className="track-fusion-axis__label">{axisLabels[axis.kind]}</span>
            <span className="track-fusion-axis__detail">{axis.detail}</span>
            {axis.citation ? <CitationLink citation={axis.citation} showLabel={false} className="track-fusion-axis__cite" iconSize={10} /> : null}
          </li>
        ))}
      </ul>
      {context.gaps.length > 0 ? (
        <p className="track-fusion-gaps">데이터 공백: {context.gaps.join(' · ')}</p>
      ) : null}
      <small className="track-fusion-safety">공개 ADS-B/공개 소스 노출·융합 보조입니다. 식별·표적화·교전 판단이 아닙니다.</small>
    </article>
  );
}

function FusionSummaryList({ fusionEvents }: { fusionEvents: FusionEvent[] }) {
  if (fusionEvents.length === 0) {
    return <p className="fusion-event-empty">현재 선택 지역에 융합할 실제 공개 데이터가 없습니다. 합성 이벤트는 만들지 않습니다.</p>;
  }
  return (
    <div className="fusion-event-list">
      {fusionEvents.map((fusionEvent) => (
        <article key={fusionEvent.id} className={`fusion-event fusion-event--${fusionEvent.severity}`}>
          <div className="fusion-event__topline">
            <strong>{fusionEvent.title}</strong>
            <span>신뢰도 {percent(fusionEvent.confidence)}</span>
          </div>
          <p>{fusionEvent.summary}</p>
          <div className="fusion-event__citations">
            {fusionEvent.citations.slice(0, 4).map((citation) => (
              <CitationLink key={citation.id} citation={citation} showLabel />
            ))}
          </div>
          <small className="fusion-event__safety">{fusionEvent.safetyNote}</small>
        </article>
      ))}
    </div>
  );
}

const VERDICT_ORDER: Verdict[] = ['TRUE', 'LIKELY', 'NOT LIKELY', 'FALSE'];
const VERDICT_LABEL: Record<Verdict, string> = { TRUE: '확인', LIKELY: '가능성', 'NOT LIKELY': '미확인', FALSE: '허위' };

function ClaimVerifyList({ claims }: { claims: AssessedClaim[] }) {
  if (claims.length === 0) {
    return <p className="live-track-empty">지오로케이트 가능한 텔레그램 주장이 아직 없습니다. 공개 채널 피드가 수집되면 표시됩니다. 합성 데이터는 만들지 않습니다.</p>;
  }
  const counts = VERDICT_ORDER.reduce((acc, v) => { acc[v] = claims.filter((c) => c.verdict === v).length; return acc; }, {} as Record<Verdict, number>);
  return (
    <div className="claim-verify">
      <div className="claim-verdict-summary">
        {VERDICT_ORDER.map((v) => (
          <div key={v} className="claim-verdict-cell" style={{ color: VERDICT_COLOR[v], borderColor: `${VERDICT_COLOR[v]}55`, background: `${VERDICT_COLOR[v]}18` }}>
            <strong>{counts[v]}</strong>
            <span>{VERDICT_LABEL[v]}</span>
          </div>
        ))}
      </div>
      <div className="claim-list">
        {claims.map((c) => {
          const safeUrl = c.url ? safeExternalUrl(c.url) : null;
          const openSource = safeUrl ? () => window.open(safeUrl, '_blank', 'noopener,noreferrer') : undefined;
          return (
            <article
              key={c.key}
              className={`claim-row${safeUrl ? ' claim-row--clickable' : ''}`}
              onClick={openSource}
              role={safeUrl ? 'button' : undefined}
              tabIndex={safeUrl ? 0 : undefined}
              onKeyDown={openSource ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSource(); } } : undefined}
              title={safeUrl ? '원본 소스 열기 (새 창)' : undefined}
            >
              <div className="claim-row__head">
                <span className="claim-badge" style={{ color: VERDICT_COLOR[c.verdict], borderColor: VERDICT_COLOR[c.verdict], background: `${VERDICT_COLOR[c.verdict]}22` }}>{VERDICT_LABEL[c.verdict]}</span>
                <span className="claim-place" style={{ color: c.color }}>{c.place}</span>
                <span className="claim-channel">{c.channel}</span>
              </div>
              <p className="claim-text">{c.text.slice(0, 180)}</p>
              <div className="claim-conf">
                <span className="claim-conf__bar"><i style={{ width: `${c.confidence}%`, background: VERDICT_COLOR[c.verdict] }} /></span>
                <span className="claim-conf__pct" style={{ color: VERDICT_COLOR[c.verdict] }}>{c.confidence}%</span>
              </div>
              <div className="claim-ledger">
                {c.ledger.map((l, i) => (
                  <span key={i} className="claim-chip" style={{ color: l.points > 0 ? VERDICT_COLOR[c.verdict] : 'var(--muted)' }}>{l.label}{l.points > 0 ? ` +${l.points}` : ''}</span>
                ))}
              </div>
              {safeUrl ? <span className="claim-link">원문 열기 <ExternalLink size={10} /></span> : null}
            </article>
          );
        })}
      </div>
      <small className="claim-verify__note">가중 증거 점수(0–100). 확인 = ≥2개 독립 근거(열적·교차출처) · 가능성 = 단일/부분 · 미확인 = 미교차(취재 공백일 수 있음) · 허위 = 강한 주장인데 예상 신호 부재. 공개 텔레그램 × NASA FIRMS 열적 × 교차출처. 비표적화.</small>
    </div>
  );
}

export function LiveTrackPanel({
  regionName,
  tracks,
  selectedTrackId,
  onSelectTrack,
  fusionContext,
  fusionEvents,
  timeline,
  militaryCount,
  identity,
  activeAirspace,
  ships,
  selectedShipId,
  onSelectShip,
  satellites,
  selectedSatelliteId,
  onSelectSatellite,
  satellitesEnabled,
  claims,
  copilotContext,
}: LiveTrackPanelProps) {
  const [tab, setTab] = useState<LiveTrackTab>('tracks');
  const selectedTrack = tracks.find((track) => track.id === selectedTrackId);
  return (
    <section className="panel live-track-panel" aria-label="실시간 항적, 지역 융합 요약, 이벤트 이력">
      <div className="live-track-tabs" role="tablist" aria-label="항적 분석 패널">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'tracks'}
          className={tab === 'tracks' ? 'is-active' : ''}
          onClick={() => setTab('tracks')}
        >
          <Radio size={14} /><span className="live-track-tab__label">항적{tracks.length > 0 ? <em>{tabCount(tracks.length)}</em> : null}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'fusion'}
          className={tab === 'fusion' ? 'is-active' : ''}
          onClick={() => setTab('fusion')}
        >
          <Layers size={14} /><span className="live-track-tab__label">융합{fusionEvents.length > 0 ? <em>{tabCount(fusionEvents.length)}</em> : null}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'history'}
          className={tab === 'history' ? 'is-active' : ''}
          onClick={() => setTab('history')}
        >
          <Clock size={14} /><span className="live-track-tab__label">이력{timeline.length > 0 ? <em>{tabCount(timeline.length)}</em> : null}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'verify'}
          className={tab === 'verify' ? 'is-active' : ''}
          onClick={() => setTab('verify')}
        >
          <ShieldCheck size={14} /><span className="live-track-tab__label">검증{claims.length > 0 ? <em>{tabCount(claims.length)}</em> : null}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'copilot'}
          className={tab === 'copilot' ? 'is-active' : ''}
          onClick={() => setTab('copilot')}
        >
          <Bot size={14} /><span className="live-track-tab__label">AI</span>
        </button>
      </div>

      <div className="live-track-panel__body">
        {tab === 'tracks' ? (
          <div className="live-track-pane live-track-pane--live">
            <div className="live-track-lists">
              <section className="live-track-group">
                <div className="live-track-pane__head">
                  <p className="eyebrow"><Radio size={12} /> Live Tracks · {regionName}</p>
                  {militaryCount > 0 ? <span className="pill pill--military"><ShieldAlert size={12} /> 군용 {militaryCount}기</span> : tracks.length > 0 ? <span className="pill">{tracks.length}기</span> : null}
                </div>
                <TrackTable tracks={tracks} selectedTrackId={selectedTrackId} onSelectTrack={onSelectTrack} />
              </section>
              <section className="live-track-group">
                <div className="live-track-pane__head">
                  <p className="eyebrow"><Ship size={12} /> Live Vessels · AIS</p>
                  {ships.length > 0 ? <span className="pill">{ships.length}척</span> : null}
                </div>
                <ShipTable ships={ships} selectedShipId={selectedShipId} onSelectShip={onSelectShip} />
              </section>
              <section className="live-track-group">
                <div className="live-track-pane__head">
                  <p className="eyebrow"><Satellite size={12} /> Live Satellites · TLE</p>
                  {satellitesEnabled && satellites.length > 0 ? <span className="pill">{satellites.length}기</span> : null}
                </div>
                <SatelliteTable satellites={satellites} selectedSatelliteId={selectedSatelliteId} onSelectSatellite={onSelectSatellite} enabled={satellitesEnabled} />
              </section>
            </div>
            {selectedTrack ? (
              <div className="live-track-detail">
                <AircraftIdentityCard identity={identity} track={selectedTrack} activeAirspace={activeAirspace} />
                <TrackFusionCard context={fusionContext} />
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'fusion' ? (
          <div className="live-track-pane">
            <div className="live-track-pane__head">
              <p className="eyebrow">Fusion Summary · {regionName}</p>
              <span className="pill">읽기전용</span>
            </div>
            <FusionSummaryList fusionEvents={fusionEvents} />
          </div>
        ) : null}

        {tab === 'history' ? (
          <div className="live-track-pane live-track-pane--history">
            <Timeline
              events={timeline}
              eyebrow="Event Timeline"
              title="융합 이벤트 이력"
              emptyMessage="현재 표시할 이벤트가 없습니다."
            />
          </div>
        ) : null}

        {tab === 'verify' ? (
          <div className="live-track-pane">
            <div className="live-track-pane__head">
              <p className="eyebrow"><ShieldCheck size={12} /> Claim Verification · 텔레그램 OSINT</p>
              <span className="pill">신뢰성</span>
            </div>
            <ClaimVerifyList claims={claims} />
          </div>
        ) : null}

        {tab === 'copilot' ? (
          <div className="live-track-pane">
            <div className="live-track-pane__head">
              <p className="eyebrow"><Bot size={12} /> AI 코파일럿 · OpenAI</p>
              <span className="pill">요약·이상탐지</span>
            </div>
            <CopilotPanel context={copilotContext} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
