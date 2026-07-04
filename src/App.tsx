import 'leaflet/dist/leaflet.css';
import { Activity, Database, FileSearch, RadioTower, Satellite } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SituationMap } from './components/SituationMap';
import { MetricCard } from './components/MetricCard';
import { Timeline } from './components/Timeline';
import { ClaimQueuePanel } from './components/ClaimQueuePanel';
import { VerificationPanel } from './components/VerificationPanel';
import { IngestLogPanel, type IngestLogEntry } from './components/IngestLogPanel';
import { detectAnomalies } from './lib/anomaly';
import { getScenario } from './lib/baselineData';
import { buildTimelineFromScenario, mergeLiveScenario, type LiveScenarioCache } from './lib/liveData';
import { liveTrackHistoryForRegion, mergeLiveTrackHistory, type LiveTrackHistory } from './lib/liveTrackHistory';
import { defaultRegionId, isRegionId, regions } from './lib/regions';
import { safeExternalUrl } from './lib/safeLinks';
import { sourceStatusIsOperational, sourceStatusLabel } from './lib/display';
import { buildClaimMapEvents, buildVerificationCases, buildVerificationTimeline } from './lib/verify';
import { implementedSourceCount, osintSourceCatalog, sourceStatusForCatalogEntry } from './lib/osintSources';
import type { RegionId, Track, VerificationCase, VerificationVerdictLabel } from './lib/types';

type BasemapMode = 'globe' | 'hud-globe' | 'offline' | 'live';
type ViewMode = 'ops' | 'narrative';
type OpsReviewTab = 'claims' | 'briefing' | 'history';
type AircraftTypeFilter = 'all' | Track['platformType'];
const livePollIntervalMs = 30_000;
const maxIngestLogEntries = 60;
const aircraftTypeOptions: Array<{ value: AircraftTypeFilter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'commercial', label: '민항' },
  { value: 'cargo', label: '화물' },
  { value: 'unknown', label: '미식별' },
];
const altitudeFilterOptions = [
  { value: 0, label: '전체 고도' },
  { value: 3000, label: '3,000m+' },
  { value: 6000, label: '6,000m+' },
  { value: 9000, label: '9,000m+' },
];
const speedFilterOptions = [
  { value: 0, label: '전체 속도' },
  { value: 80, label: '80m/s+' },
  { value: 150, label: '150m/s+' },
  { value: 220, label: '220m/s+' },
];

function initialBasemapMode(): BasemapMode {
  if (typeof window === 'undefined') return 'globe';
  const value = new URLSearchParams(window.location.search).get('basemap');
  if (value === 'offline' || value === 'live' || value === 'globe' || value === 'hud-globe') return value;
  return 'globe';
}

function initialViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'ops';
  return new URLSearchParams(window.location.search).get('view') === 'narrative' ? 'narrative' : 'ops';
}

function initialRegionId(): RegionId {
  if (typeof window === 'undefined') return defaultRegionId;
  const value = new URLSearchParams(window.location.search).get('region');
  return value && isRegionId(value) ? value : defaultRegionId;
}

function summarizeRegionCache(cache: LiveScenarioCache, regionId: RegionId): string {
  const region = cache.regions?.[regionId];
  if (!region) return `${regionId}: 지역 데이터 없이 캐시만 로드됨`;
  const status = Object.entries(region.sourceStatus ?? {})
    .map(([source, value]) => `${source}=${sourceStatusLabel(value)}`)
    .join(' ');
  const reasons = Object.entries(region.sourceReasons ?? {})
    .filter(([source]) => region.sourceStatus?.[source] !== 'live')
    .map(([source, reason]) => `${source}:${reason}`)
    .join(' · ');
  return `${regionId}: 항적=${region.tracks?.length ?? 0} 선박=${region.ships?.length ?? 0} FIR=${region.airspaceContexts?.length ?? 0} 공항=${region.airports?.length ?? 0} OSINT=${region.osint?.length ?? 0} 이벤트=${region.osintEvents?.length ?? 0} 기상=${region.weather ? '1' : '0'} 위성=${region.satellites?.length ?? 0} ${status}${reasons ? ` | ${reasons}` : ''}`;
}

function formatRelativeAge(value: string | null | undefined): string {
  if (!value) return '확인 전';
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '시간 알 수 없음';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}초 전`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

function liveLoadStateLabel(value: 'loading' | 'ready' | 'unavailable') {
  if (value === 'ready') return '준비됨';
  if (value === 'unavailable') return '사용 불가';
  return '불러오는 중';
}

function formatShortDateTime(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function primarySentence(value: string) {
  const match = value.match(/^.*?(?:입니다\.|습니다\.|[.!?。])(?:\s|$)/);
  return match?.[0].trim() || value;
}

const verdictShortLabels: Record<VerificationVerdictLabel, string> = {
  confirmed: '확인',
  likely_true: '사실↑',
  plausible_unverified: '가능',
  inconclusive: '보류',
  likely_false: '허위↑',
  false: '허위',
};

function verdictLabel(value: VerificationVerdictLabel | undefined) {
  return value ? verdictShortLabels[value] : '-';
}

function evidenceCountsFor(verificationCase: VerificationCase | undefined) {
  const evidence = verificationCase?.evidence ?? [];
  return {
    supports: evidence.filter((item) => item.stance === 'supports').length,
    contradicts: evidence.filter((item) => item.stance === 'contradicts').length,
    gaps: evidence.filter((item) => item.stance === 'gap').length,
    total: evidence.length,
  };
}

function verificationBriefingLists(verificationCase: VerificationCase | undefined) {
  if (!verificationCase) return {
    findings: ['선택된 검증 주장이 없습니다.'],
    nextChecks: ['Claim Queue에서 주장을 선택하세요.'],
  };
  const findings = [
    ...verificationCase.evidence.filter((item) => item.stance === 'contradicts').slice(0, 2).map((item) => `반박: ${item.title}`),
    ...verificationCase.evidence.filter((item) => item.stance === 'supports').slice(0, 2).map((item) => `지지: ${item.title}`),
    ...verificationCase.evidence.filter((item) => item.stance === 'gap').slice(0, 2).map((item) => `공백: ${item.title}`),
  ];
  return {
    findings: findings.length ? findings : [verificationCase.verdict.summary],
    nextChecks: verificationCase.verdict.nextChecks,
  };
}

function sourceCatalogStatusLabel(value: ReturnType<typeof sourceStatusForCatalogEntry>) {
  if (value === 'manual') return '수동 등록';
  if (value === 'commercial-ready') return '유료/파트너십';
  return sourceStatusLabel(value);
}

function App() {
  const [regionId, setRegionId] = useState<RegionId>(initialRegionId);
  const [basemapMode, setBasemapMode] = useState<BasemapMode>(initialBasemapMode);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [opsReviewTab, setOpsReviewTab] = useState<OpsReviewTab>('claims');
  const [liveCache, setLiveCache] = useState<LiveScenarioCache | null>(null);
  const [liveLoadState, setLiveLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [liveLastCheckedAt, setLiveLastCheckedAt] = useState<string | null>(null);
  const [liveLastErrorAt, setLiveLastErrorAt] = useState<string | null>(null);
  const [ingestLogs, setIngestLogs] = useState<IngestLogEntry[]>([]);
  const [liveTrackHistory, setLiveTrackHistory] = useState<LiveTrackHistory>({});
  const [aircraftTypeFilter, setAircraftTypeFilter] = useState<AircraftTypeFilter>('all');
  const [minimumAltitudeM, setMinimumAltitudeM] = useState(0);
  const [minimumSpeedMs, setMinimumSpeedMs] = useState(0);
  const [activeClaimId, setActiveClaimId] = useState<string | undefined>();
  const liveCacheRef = useRef<LiveScenarioCache | null>(null);
  const baseScenario = useMemo(() => getScenario(regionId), [regionId]);
  const mergedScenario = useMemo(() => {
    const liveRegion = liveCache?.regions?.[regionId];
    const historyTracks = liveTrackHistoryForRegion(liveTrackHistory, regionId);
    return mergeLiveScenario(baseScenario, historyTracks.length ? { ...liveRegion, tracks: historyTracks } : liveRegion);
  }, [baseScenario, liveCache, liveTrackHistory, regionId]);
  const filteredTracks = useMemo(
    () => mergedScenario.tracks.filter((track) => {
      if (aircraftTypeFilter !== 'all' && track.platformType !== aircraftTypeFilter) return false;
      const last = track.points.at(-1);
      if (!last) return false;
      return last.altitudeM >= minimumAltitudeM && last.velocityMs >= minimumSpeedMs;
    }),
    [aircraftTypeFilter, mergedScenario.tracks, minimumAltitudeM, minimumSpeedMs],
  );
  const scenario = useMemo(() => {
    const nextScenario = { ...mergedScenario, tracks: filteredTracks, fusionEvents: [] };
    return {
      ...nextScenario,
      timeline: buildTimelineFromScenario(nextScenario),
    };
  }, [filteredTracks, mergedScenario]);
  const anomalies = useMemo(() => detectAnomalies(scenario), [scenario]);
  const verificationCases = useMemo(() => buildVerificationCases(scenario), [scenario]);
  const activeVerificationCase = useMemo(
    () => verificationCases.find((item) => item.claim.id === activeClaimId) ?? verificationCases[0],
    [activeClaimId, verificationCases],
  );
  const claimMapEvents = useMemo(() => buildClaimMapEvents(verificationCases), [verificationCases]);
  const verificationTimeline = useMemo(() => buildVerificationTimeline(verificationCases), [verificationCases]);

  const isGlobalRegion = regionId === 'global';
  const rawTrackCount = mergedScenario.tracks.length;
  const filteredTrackCount = scenario.tracks.length;
  const handleRegionSelect = useCallback((value: RegionId) => {
    setRegionId(value);
  }, []);
  const handleRegionChange = (value: string) => {
    if (isRegionId(value)) handleRegionSelect(value);
  };
  const liveRegionStatus = liveCache?.regions?.[regionId]?.sourceStatus;
  const liveSourceReasons = liveCache?.regions?.[regionId]?.sourceReasons;
  const liveSourceUpdatedAt = liveCache?.regions?.[regionId]?.sourceUpdatedAt;
  const liveGeneratedAt = formatShortDateTime(liveCache?.generatedAt);
  const liveCacheAge = formatRelativeAge(liveCache?.generatedAt);
  const liveCheckedAge = formatRelativeAge(liveLastCheckedAt);
  const livePollSeconds = Math.round((liveCache?.refreshPolicy?.browserPollMs ?? livePollIntervalMs) / 1000);
  const liveSourceTotal = Object.keys(liveRegionStatus ?? {}).length;
  const liveSourceOk = Object.values(liveRegionStatus ?? {}).filter(sourceStatusIsOperational).length;
  const sourceReasonItems = Object.entries(liveRegionStatus ?? {})
    .filter(([, status]) => status !== 'live' && status !== 'cached' && status !== 'standby')
    .map(([source, status]) => ({
      source,
      status,
      reason: liveSourceReasons?.[source],
    }));
  const liveTrackCount = liveCache?.regions?.[regionId]?.tracks?.length ?? 0;
  const trackDetail = isGlobalRegion
    ? '상세 항적은 AOI 선택 시 조회'
    : liveRegionStatus?.opensky === 'live' && liveTrackCount > 0
      ? `OpenSky live ${liveTrackCount}`
      : liveRegionStatus?.opensky === 'cached' && scenario.tracks.length > 0
        ? 'OpenSky 캐시 재사용'
        : liveRegionStatus?.opensky === 'unavailable'
          ? 'OpenSky 사용 불가'
          : 'OpenSky 수집 대기';
  const weatherDetail = isGlobalRegion
    ? '전세계 모드는 지역별 기상 상세 비활성'
    : scenario.weather
      ? `운량 ${scenario.weather.cloudCoverPct}%, 돌풍 ${scenario.weather.windGustKmh}km/h`
      : 'Open-Meteo 수집 대기';
  const activeEvidenceCounts = evidenceCountsFor(activeVerificationCase);
  const verificationBrief = verificationBriefingLists(activeVerificationCase);
  const sourceCoverageCount = implementedSourceCount(scenario);
  const verdictTone = activeVerificationCase?.verdict.label === 'false' || activeVerificationCase?.verdict.label === 'likely_false'
    ? 'warning'
    : activeVerificationCase?.verdict.label === 'confirmed' || activeVerificationCase?.verdict.label === 'likely_true'
      ? 'good'
      : activeVerificationCase ? 'watch' : 'neutral';
  const appendIngestLog = useCallback((level: IngestLogEntry['level'], message: string, at = new Date().toISOString()) => {
    setIngestLogs((current) => [
      { id: `${at}-${level}-${current.length}`, at, level, message },
      ...current,
    ].slice(0, maxIngestLogEntries));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return;
    let cancelled = false;

    const loadLiveCache = async () => {
      const checkedAt = new Date().toISOString();
      try {
        const endpoints = [
          `/api/live-scenarios?t=${Date.now()}`,
          `/data/live-scenarios.json?t=${Date.now()}`,
        ];
        let cache: LiveScenarioCache | null = null;
        let lastError: unknown = null;
        for (const endpoint of endpoints) {
          try {
            const response = await window.fetch(endpoint, { cache: 'no-store' });
            if (!response.ok) throw new Error(`${endpoint} HTTP ${response.status}`);
            const contentType = response.headers.get('content-type') ?? '';
            if (!contentType.includes('json')) throw new Error(`${endpoint} returned ${contentType || 'unknown content-type'}`);
            const candidate = await response.json() as LiveScenarioCache;
            if (!candidate?.regions) throw new Error(`${endpoint} did not include regions`);
            cache = candidate;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (!cache) throw lastError instanceof Error ? lastError : new Error('No live cache endpoint configured');
        if (cancelled) return;
        liveCacheRef.current = cache;
        setLiveCache(cache);
        if (cache.regions?.[regionId]?.tracks?.length) {
          setLiveTrackHistory((current) => mergeLiveTrackHistory(current, regionId, cache.regions[regionId]?.tracks ?? [], cache.generatedAt));
        }
        setLiveLoadState('ready');
        setLiveLastCheckedAt(checkedAt);
        setLiveLastErrorAt(null);
        appendIngestLog('info', summarizeRegionCache(cache, regionId), checkedAt);
      } catch {
        if (cancelled) return;
        setLiveLastCheckedAt(checkedAt);
        setLiveLastErrorAt(checkedAt);
        appendIngestLog(liveCacheRef.current ? 'warn' : 'error', '캐시 확인 실패; 사용 가능한 마지막 공개 스냅샷을 유지합니다', checkedAt);
        if (!liveCacheRef.current) {
          setLiveCache(null);
          setLiveLoadState('unavailable');
        }
      }
    };

    void loadLiveCache();
    const timer = window.setInterval(() => {
      void loadLiveCache();
    }, livePollIntervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [appendIngestLog, regionId]);

  const metrics = (
    <section className="metrics-grid">
      <MetricCard
        label="검증주장"
        value={verificationCases.length}
        detail={activeVerificationCase ? activeVerificationCase.claim.shortTitle : 'Claim Queue 대기'}
        tone={verificationCases.some((item) => item.claim.priority === 'warning') ? 'watch' : 'neutral'}
        icon={<Activity size={18} />}
      />
      <MetricCard
        label="현재판정"
        value={verdictLabel(activeVerificationCase?.verdict.label)}
        detail={activeVerificationCase ? `신뢰도 ${Math.round(activeVerificationCase.verdict.confidence * 100)}%` : '선택 없음'}
        tone={verdictTone}
        icon={<FileSearch size={18} />}
      />
      <MetricCard
        label="관측레이어"
        value={`${filteredTrackCount}/${scenario.satellites.length}`}
        detail={`항적/위성 · ${rawTrackCount === filteredTrackCount ? trackDetail : `필터 ${filteredTrackCount}/${rawTrackCount}`} · ${weatherDetail}`}
        tone="neutral"
        icon={<RadioTower size={18} />}
      />
      <MetricCard
        label="OSINT소스"
        value={`${sourceCoverageCount}/${osintSourceCatalog.length}`}
        detail={`근거 ${activeEvidenceCounts.total} · 지지 ${activeEvidenceCounts.supports} / 반박 ${activeEvidenceCounts.contradicts} / 공백 ${activeEvidenceCounts.gaps}`}
        tone={activeEvidenceCounts.gaps > activeEvidenceCounts.supports + activeEvidenceCounts.contradicts ? 'watch' : 'neutral'}
        icon={<Satellite size={18} />}
      />
    </section>
  );

  const mapPanel = (
    <div className="map-card">
      <div className="map-card__header">
        <div>
          <p className="eyebrow">상황도</p>
          <h2>{scenario.region.shortName}</h2>
        </div>
        <span className="pill pill--dispatch">
          VERIFY · 주장 {verificationCases.length} · 항적 {filteredTrackCount}/{rawTrackCount} · OSINT {scenario.osintEvents.length + claimMapEvents.length} · 위성장면 {scenario.satelliteScenes?.length ?? 0}
        </span>
      </div>
      <SituationMap
        region={scenario.region}
        selectableRegions={regions}
        onRegionSelect={handleRegionSelect}
        tracks={scenario.tracks}
        ships={scenario.ships}
        zones={scenario.watchZones}
        referenceLines={scenario.referenceLines}
        satellites={scenario.satellites}
        airports={scenario.airports}
        airRoutes={scenario.airRoutes}
        notices={scenario.notices}
        airspaceContexts={scenario.airspaceContexts}
        osintEvents={[...scenario.osintEvents, ...claimMapEvents]}
        anomalies={anomalies}
        basemapMode={basemapMode}
      />
    </div>
  );

  const opsBriefingPanel = (
    <section className="panel ops-briefing-panel">
      <div className="panel__header panel__header--row">
        <div>
          <p className="eyebrow">Verification Brief</p>
          <h2>{activeVerificationCase?.claim.shortTitle ?? '검증 브리핑'}</h2>
        </div>
        <span className="pill">{verdictLabel(activeVerificationCase?.verdict.label)} · 검토용</span>
      </div>
      <p className="ops-briefing-summary">{primarySentence(activeVerificationCase?.verdict.summary ?? '선택된 검증 주장이 없습니다.')}</p>
      <div className="ops-briefing-grid">
        <div>
          <h3>핵심 근거</h3>
          <ul>
            {verificationBrief.findings.slice(0, 4).map((finding) => <li key={finding}>{finding}</li>)}
          </ul>
        </div>
        <div>
          <h3>다음 확인</h3>
          <ul>
            {verificationBrief.nextChecks.slice(0, 4).map((check) => <li key={check}>{check}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );

  const opsTrackSummary = isGlobalRegion
    ? `주장 ${verificationCases.length} · OSINT ${scenario.osintEvents.length} · 위성 ${scenario.satellites.length} · AOI 선택 시 상세`
    : `주장 ${verificationCases.length} · 항적 ${filteredTrackCount}/${rawTrackCount} · 위성 ${scenario.satellites.length} · OSINT ${scenario.osintEvents.length}`;
  const opsSnapshotSummary = liveGeneratedAt
    ? `${liveCacheAge} · 출처 ${liveSourceOk}/${liveSourceTotal || '-'}`
    : '스냅샷 대기';

  const opsCommandBar = (
    <section className="ops-command-bar" aria-label="상황판 주요 설정">
      <div className="ops-command-bar__field ops-command-bar__field--region">
        <label htmlFor="region">관심지역</label>
        <select id="region" value={regionId} onChange={(event) => handleRegionChange(event.target.value)}>
          {regions.map((region) => <option key={region.id} value={region.id}>{region.shortName}</option>)}
        </select>
      </div>
      <div className="ops-command-bar__field">
        <label htmlFor="basemap">지도</label>
        <select id="basemap" value={basemapMode} onChange={(event) => setBasemapMode(event.target.value as BasemapMode)}>
          <option value="globe">실제 3D 지도</option>
          <option value="hud-globe">HUD Globe</option>
          <option value="live">블랙 OSM</option>
          <option value="offline">오프라인 HUD</option>
        </select>
      </div>
      <div className="ops-command-bar__field ops-command-bar__field--compact">
        <label htmlFor="data-mode">데이터</label>
        <select id="data-mode" value="live" disabled>
          <option value="live">API 스냅샷</option>
        </select>
      </div>
      <div className="ops-command-bar__field ops-command-bar__field--compact">
        <label htmlFor="view-mode">화면</label>
        <select id="view-mode" value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)}>
          <option value="ops">상황판</option>
          <option value="narrative">리포트</option>
        </select>
      </div>
      <div className="ops-command-bar__field ops-command-bar__field--compact">
        <label htmlFor="aircraft-type-filter">항공기 유형</label>
        <select id="aircraft-type-filter" value={aircraftTypeFilter} onChange={(event) => setAircraftTypeFilter(event.target.value as AircraftTypeFilter)}>
          {aircraftTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className="ops-command-bar__field ops-command-bar__field--compact">
        <label htmlFor="altitude-filter">최소 고도</label>
        <select id="altitude-filter" value={minimumAltitudeM} onChange={(event) => setMinimumAltitudeM(Number(event.target.value))}>
          {altitudeFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className="ops-command-bar__field ops-command-bar__field--compact">
        <label htmlFor="speed-filter">최소 속도</label>
        <select id="speed-filter" value={minimumSpeedMs} onChange={(event) => setMinimumSpeedMs(Number(event.target.value))}>
          {speedFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      <div className="ops-command-bar__status" aria-live="polite">
        <strong>스냅샷 {liveLoadStateLabel(liveLoadState)}</strong>
        <span>{opsSnapshotSummary}</span>
        <span>{opsTrackSummary}</span>
        {sourceReasonItems.length > 0 ? <em>주의 {sourceReasonItems.length}</em> : null}
        {liveLastErrorAt ? <em>폴링 오류</em> : null}
      </div>
    </section>
  );

  const opsReviewPanel = (
    <section className="panel ops-review-panel" aria-label="주장 검증, 검증 브리핑, 근거 이력">
      <div className="ops-review-tabs" role="tablist" aria-label="오른쪽 분석 패널">
        <button
          id="ops-review-tab-claims"
          type="button"
          role="tab"
          aria-selected={opsReviewTab === 'claims'}
          aria-controls="ops-review-panel-claims"
          className={opsReviewTab === 'claims' ? 'is-active' : ''}
          onClick={() => setOpsReviewTab('claims')}
        >
          주장
          <span>{verificationCases.length}</span>
        </button>
        <button
          id="ops-review-tab-briefing"
          type="button"
          role="tab"
          aria-selected={opsReviewTab === 'briefing'}
          aria-controls="ops-review-panel-briefing"
          className={opsReviewTab === 'briefing' ? 'is-active' : ''}
          onClick={() => setOpsReviewTab('briefing')}
        >
          검증 브리핑
          <span>{verificationBrief.findings.length}</span>
        </button>
        <button
          id="ops-review-tab-history"
          type="button"
          role="tab"
          aria-selected={opsReviewTab === 'history'}
          aria-controls="ops-review-panel-history"
          className={opsReviewTab === 'history' ? 'is-active' : ''}
          onClick={() => setOpsReviewTab('history')}
        >
          근거 이력
          <span>{verificationTimeline.length}</span>
        </button>
      </div>
      <div className="ops-review-panel__body">
        <div
          id="ops-review-panel-claims"
          role="tabpanel"
          aria-labelledby="ops-review-tab-claims"
          className="ops-review-pane ops-review-pane--queue"
          hidden={opsReviewTab !== 'claims'}
        >
          <ClaimQueuePanel
            cases={verificationCases}
            activeClaimId={activeVerificationCase?.claim.id}
            compact
            onSelect={setActiveClaimId}
          />
          <VerificationPanel verificationCase={activeVerificationCase} compact />
        </div>
        <div
          id="ops-review-panel-briefing"
          role="tabpanel"
          aria-labelledby="ops-review-tab-briefing"
          className="ops-review-pane ops-review-pane--briefing"
          hidden={opsReviewTab !== 'briefing'}
        >
          {opsBriefingPanel}
        </div>
        <div
          id="ops-review-panel-history"
          role="tabpanel"
          aria-labelledby="ops-review-tab-history"
          className="ops-review-pane ops-review-pane--history"
          hidden={opsReviewTab !== 'history'}
        >
          <Timeline
            events={verificationTimeline}
            eyebrow="Evidence Timeline"
            title="근거 확인 이력"
            emptyMessage="현재 표시할 검증 근거가 없습니다."
          />
        </div>
      </div>
    </section>
  );

  return (
    <main aria-label="AirMaven Verify OSINT 검증 상황판" className={`app-shell ${viewMode === 'ops' ? 'app-shell--ops' : ''}`}>
      {viewMode === 'ops' ? opsCommandBar : (
        <>
          <section className="control-strip">
            <div className="control-field control-field--region">
              <label htmlFor="region">관심지역</label>
              <select id="region" value={regionId} onChange={(event) => handleRegionChange(event.target.value)}>
                {regions.map((region) => <option key={region.id} value={region.id}>{region.shortName}</option>)}
              </select>
            </div>
            <p className="region-description">{scenario.region.description}</p>
            <div className="control-field control-field--basemap">
              <label htmlFor="basemap">지도</label>
              <select id="basemap" value={basemapMode} onChange={(event) => setBasemapMode(event.target.value as BasemapMode)}>
                <option value="globe">실제 3D 지도</option>
                <option value="hud-globe">HUD Globe</option>
                <option value="live">블랙 OSM</option>
                <option value="offline">오프라인 HUD</option>
              </select>
            </div>
            <div className="control-field control-field--data">
              <label htmlFor="data-mode">데이터</label>
              <select id="data-mode" value="live" disabled>
                <option value="live">API 스냅샷</option>
              </select>
            </div>
            <div className="control-field control-field--view">
              <label htmlFor="view-mode">화면</label>
              <select id="view-mode" value={viewMode} onChange={(event) => setViewMode(event.target.value as ViewMode)}>
                <option value="ops">상황판</option>
                <option value="narrative">리포트</option>
              </select>
            </div>
            <div className="live-status" aria-live="polite">
              <strong>스냅샷 {liveLoadStateLabel(liveLoadState)}</strong>
              <span>
                {liveGeneratedAt
                  ? `생성 ${liveGeneratedAt} · 캐시 ${liveCacheAge} · 출처 ${liveSourceOk}/${liveSourceTotal || '-'} · 확인 ${liveCheckedAge} · ${livePollSeconds}초`
                  : '실제 공개 API 스냅샷 대기'}
                {liveLastErrorAt ? ` · 마지막 폴링 오류 ${formatRelativeAge(liveLastErrorAt)}` : ''}
              </span>
            </div>
          </section>

          <section className="filter-strip" aria-label="항적 표시 필터">
            <div className="filter-field">
              <label htmlFor="aircraft-type-filter">항공기 유형</label>
              <select id="aircraft-type-filter" value={aircraftTypeFilter} onChange={(event) => setAircraftTypeFilter(event.target.value as AircraftTypeFilter)}>
                {aircraftTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label htmlFor="altitude-filter">최소 고도</label>
              <select id="altitude-filter" value={minimumAltitudeM} onChange={(event) => setMinimumAltitudeM(Number(event.target.value))}>
                {altitudeFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <div className="filter-field">
              <label htmlFor="speed-filter">최소 속도</label>
              <select id="speed-filter" value={minimumSpeedMs} onChange={(event) => setMinimumSpeedMs(Number(event.target.value))}>
                {speedFilterOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            <p className="filter-strip__summary">
              {isGlobalRegion
                ? `검증 주장 ${verificationCases.length} · 전세계 OSINT 포인트 ${scenario.osintEvents.length + claimMapEvents.length} · 위성 ${scenario.satellites.length}`
                : `검증 주장 ${verificationCases.length} · 표시 항적 ${filteredTrackCount}/${rawTrackCount} · 위성 ${scenario.satellites.length} · OSINT 포인트 ${scenario.osintEvents.length + claimMapEvents.length}`}
            </p>
          </section>
        </>
      )}

      {viewMode !== 'ops' && liveRegionStatus && (
        <section className="source-status-strip" aria-label="라이브 출처 상태">
          {Object.entries(liveRegionStatus).map(([source, status]) => {
            const sourceAge = liveSourceUpdatedAt?.[source] ? formatRelativeAge(liveSourceUpdatedAt[source]) : '신규 수집 없음';
            const sourceReason = liveSourceReasons?.[source];
            return (
              <span key={source} className={`source-status source-status--${status}`}>
                {source}: {sourceStatusLabel(status)} · {sourceAge}{sourceReason ? ` · ${sourceReason}` : ''}
              </span>
            );
          })}
        </section>
      )}

      {viewMode === 'ops' ? (
        <section className="ops-dashboard" aria-label="운용 상황판">
          <div className="ops-cell ops-cell--metrics">{metrics}</div>
          <div className="ops-cell ops-cell--map">{mapPanel}</div>
          <div className="ops-cell ops-cell--alerts">
            {opsReviewPanel}
          </div>
          <div className="ops-cell ops-cell--stream">
            <IngestLogPanel logs={ingestLogs} />
          </div>
        </section>
      ) : (
        <>
          {metrics}
          <section className="map-grid">
            {mapPanel}
            <ClaimQueuePanel
              cases={verificationCases}
              activeClaimId={activeVerificationCase?.claim.id}
              onSelect={setActiveClaimId}
            />
          </section>

          <section className="content-grid">
            <VerificationPanel verificationCase={activeVerificationCase} />
            <Timeline
              events={verificationTimeline}
              eyebrow="Evidence Timeline"
              title="근거 확인 이력"
              emptyMessage="현재 표시할 검증 근거가 없습니다."
            />
          </section>

          <section className="panel source-matrix">
            <div className="panel__header">
              <p className="eyebrow">OSINT Integrations</p>
              <h2>검증 소스 연계 매트릭스</h2>
            </div>
            <div className="source-matrix__grid">
              {osintSourceCatalog.map((source) => {
                const safeUrl = safeExternalUrl(source.url);
                const status = sourceStatusForCatalogEntry(source, scenario);
                return (
                  <article key={source.name}>
                    <Database size={18} />
                    <strong>{source.name}</strong>
                    <p>{source.role}</p>
                    <small>{sourceCatalogStatusLabel(status)} · {source.tier} · {source.mode}</small>
                    <small>{source.verdictUse}</small>
                    {safeUrl && <a href={safeUrl} target="_blank" rel="noreferrer">문서</a>}
                  </article>
                );
              })}
            </div>
          </section>

          <footer>
            <strong>안전 기준:</strong> AirMaven Verify는 공개 OSINT 근거의 지지·반박·공백을 표시하는 검증 보조 시스템입니다. 데이터가 없으면 합성 값으로 채우지 않으며, 표적 식별, 타격 권고, 자동 교전 판단은 수행하지 않습니다.
          </footer>
        </>
      )}
    </main>
  );
}

export default App;
