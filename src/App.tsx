import 'leaflet/dist/leaflet.css';
import { Activity, CloudSun, Database, RadioTower, Satellite } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SituationMap } from './components/SituationMap';
import { MetricCard } from './components/MetricCard';
import { Timeline } from './components/Timeline';
import { AnomalyPanel } from './components/AnomalyPanel';
import { BriefingPanel } from './components/BriefingPanel';
import { FusionCopilotPanel, type QueryPreset } from './components/FusionCopilotPanel';
import { IngestLogPanel, type IngestLogEntry } from './components/IngestLogPanel';
import { detectAnomalies } from './lib/anomaly';
import { generateBriefing } from './lib/briefing';
import { buildFusionEvents } from './lib/fusion';
import { dataSources, getScenario } from './lib/baselineData';
import { buildTimelineFromScenario, mergeLiveScenario, type LiveScenarioCache } from './lib/liveData';
import { liveTrackHistoryForRegion, mergeLiveTrackHistory, type LiveTrackHistory } from './lib/liveTrackHistory';
import { demoQueries, parseAnalystQuery } from './lib/query';
import { defaultRegionId, isRegionId, regions } from './lib/regions';
import { safeExternalUrl } from './lib/safeLinks';
import { sourceStatusIsOperational, sourceStatusLabel } from './lib/display';
import type { Anomaly, FusionReviewStatus, RegionId, TimelineEvent, Track } from './lib/types';

type BasemapMode = 'globe' | 'hud-globe' | 'offline' | 'live';
type ViewMode = 'ops' | 'narrative';
type OpsReviewTab = 'queue' | 'briefing' | 'history';
type AircraftTypeFilter = 'all' | Track['platformType'];
const livePollIntervalMs = 30_000;
const maxIngestLogEntries = 60;
const defaultAnalystQuery = demoQueries[2];
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

const queryPresets: QueryPreset[] = demoQueries.map((query, index) => ({
  id: `preset-${index + 1}`,
  label: ['Global', '대만해협', '수도권', '남중국해', '서해 NLL'][index] ?? `질의 ${index + 1}`,
  query,
}));

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

function anomalyObservedAt(anomaly: Anomaly, fallbackTime: string) {
  const timestamps = anomaly.citations
    .map((cite) => cite.observedAt)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .filter(Number.isFinite);
  if (!timestamps.length) return fallbackTime;
  return new Date(Math.max(...timestamps)).toISOString();
}

function buildAnomalyTimeline(anomalies: Anomaly[], regionId: RegionId, fallbackTime: string): TimelineEvent[] {
  return anomalies
    .map((anomaly) => ({
      id: `review-${anomaly.id}`,
      regionId,
      time: anomalyObservedAt(anomaly, fallbackTime),
      type: 'anomaly' as const,
      title: anomaly.title,
      description: `신뢰도 ${Math.round(anomaly.confidence * 100)}% · 근거 ${anomaly.citations.length}개 · 관련 항적 ${anomaly.relatedTrackIds.length}개`,
      severity: anomaly.severity,
      relatedIds: [...anomaly.relatedTrackIds, ...anomaly.relatedOsintIds],
    }))
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
}

function scenarioReferenceTime(scenario: { weather: { observedAt: string } | null; timeline: TimelineEvent[] }) {
  return scenario.weather?.observedAt ?? scenario.timeline.at(-1)?.time ?? new Date().toISOString();
}

function App() {
  const [regionId, setRegionId] = useState<RegionId>(initialRegionId);
  const [basemapMode, setBasemapMode] = useState<BasemapMode>(initialBasemapMode);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [opsReviewTab, setOpsReviewTab] = useState<OpsReviewTab>('queue');
  const [liveCache, setLiveCache] = useState<LiveScenarioCache | null>(null);
  const [liveLoadState, setLiveLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [liveLastCheckedAt, setLiveLastCheckedAt] = useState<string | null>(null);
  const [liveLastErrorAt, setLiveLastErrorAt] = useState<string | null>(null);
  const [ingestLogs, setIngestLogs] = useState<IngestLogEntry[]>([]);
  const [liveTrackHistory, setLiveTrackHistory] = useState<LiveTrackHistory>({});
  const [aircraftTypeFilter, setAircraftTypeFilter] = useState<AircraftTypeFilter>('all');
  const [minimumAltitudeM, setMinimumAltitudeM] = useState(0);
  const [minimumSpeedMs, setMinimumSpeedMs] = useState(0);
  const [queryText, setQueryText] = useState(defaultAnalystQuery);
  const [activeQuery, setActiveQuery] = useState(defaultAnalystQuery);
  const [fusionReviewStates, setFusionReviewStates] = useState<Record<string, FusionReviewStatus>>({});
  const liveCacheRef = useRef<LiveScenarioCache | null>(null);
  const queryIntent = useMemo(() => parseAnalystQuery(activeQuery, regionId), [activeQuery, regionId]);
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
  const scenarioBeforeFusion = useMemo(() => {
    const nextScenario = { ...mergedScenario, tracks: filteredTracks, fusionEvents: [] };
    return {
      ...nextScenario,
      timeline: buildTimelineFromScenario(nextScenario),
    };
  }, [filteredTracks, mergedScenario]);
  const anomalies = useMemo(() => detectAnomalies(scenarioBeforeFusion), [scenarioBeforeFusion]);
  const fusionEvents = useMemo(
    () => buildFusionEvents(scenarioBeforeFusion, anomalies, queryIntent),
    [scenarioBeforeFusion, anomalies, queryIntent],
  );
  const scenario = useMemo(() => {
    const nextScenario = { ...scenarioBeforeFusion, fusionEvents };
    return {
      ...nextScenario,
      timeline: buildTimelineFromScenario(nextScenario),
    };
  }, [fusionEvents, scenarioBeforeFusion]);
  const briefing = useMemo(() => generateBriefing(scenario, anomalies), [scenario, anomalies]);
  const timeline = useMemo<TimelineEvent[]>(() => [
    ...scenario.timeline,
    ...anomalies.map((anomaly) => ({
      id: `tl-${anomaly.id}`,
      regionId,
      time: scenarioReferenceTime(scenario),
      type: 'anomaly' as const,
      title: anomaly.title,
      description: anomaly.description,
      severity: anomaly.severity,
      relatedIds: [...anomaly.relatedTrackIds, ...anomaly.relatedOsintIds],
    })),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()), [scenario, anomalies, regionId]);
  const referenceTime = useMemo(() => scenarioReferenceTime(scenario), [scenario]);
  const anomalyTimeline = useMemo(
    () => buildAnomalyTimeline(anomalies, regionId, referenceTime),
    [anomalies, regionId, referenceTime],
  );

  const isGlobalRegion = regionId === 'global';
  const warningCount = anomalies.filter((item) => item.severity === 'warning').length;
  const watchCount = anomalies.filter((item) => item.severity === 'watch').length;
  const rawTrackCount = mergedScenario.tracks.length;
  const filteredTrackCount = scenario.tracks.length;
  const handleRegionSelect = useCallback((value: RegionId) => {
    setRegionId(value);
  }, []);
  const handleRegionChange = (value: string) => {
    if (isRegionId(value)) handleRegionSelect(value);
  };
  const applyAnalystQuery = useCallback((value: string) => {
    const nextQuery = value.trim() || demoQueries[0];
    const nextIntent = parseAnalystQuery(nextQuery, regionId);
    if (nextIntent.regionId && nextIntent.regionId !== regionId) setRegionId(nextIntent.regionId);
    setActiveQuery(nextQuery);
    setQueryText(nextQuery);
  }, [regionId]);
  const handleQueryPreset = useCallback((preset: QueryPreset) => {
    applyAnalystQuery(preset.query);
  }, [applyAnalystQuery]);
  const handleFusionReviewChange = useCallback((eventId: string, status: FusionReviewStatus) => {
    setFusionReviewStates((current) => ({ ...current, [eventId]: status }));
  }, []);
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
        label="항적"
        value={filteredTrackCount}
        detail={rawTrackCount === filteredTrackCount ? trackDetail : `${trackDetail} · 필터 ${filteredTrackCount}/${rawTrackCount}`}
        tone="neutral"
        icon={<RadioTower size={18} />}
      />
      <MetricCard label="확인신호" value={`${warningCount}/${watchCount}`} detail="경고 / 관찰" tone={warningCount ? 'warning' : watchCount ? 'watch' : 'good'} icon={<Activity size={18} />} />
      <MetricCard
        label="기상"
        value={scenario.weather ? `${scenario.weather.visibilityM.toLocaleString()}m` : '0'}
        detail={weatherDetail}
        tone={scenario.weather && scenario.weather.visibilityM < 6000 ? 'watch' : scenario.weather ? 'good' : 'neutral'}
        icon={<CloudSun size={18} />}
      />
      <MetricCard
        label="궤도/해상"
        value={`${scenario.satellites.length}/${scenario.ships.length}`}
        detail={`위성/선박 · FIR ${scenario.airspaceContexts[0]?.icaoCode ?? '-'}`}
        tone="neutral"
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
          READY · 항적 {filteredTrackCount}/{rawTrackCount} · OSINT {scenario.osintEvents.length} · 선박 {scenario.ships.length} · 공항 {scenario.airports.length}
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
        osintEvents={scenario.osintEvents}
        anomalies={anomalies}
        basemapMode={basemapMode}
      />
    </div>
  );

  const opsBriefingPanel = (
    <section className="panel ops-briefing-panel">
      <div className="panel__header panel__header--row">
        <div>
          <p className="eyebrow">AI 브리핑</p>
          <h2>{briefing.headline}</h2>
        </div>
        <span className="pill">검토용</span>
      </div>
      <p className="ops-briefing-summary">{primarySentence(briefing.situationSummary)}</p>
      <div className="ops-briefing-grid">
        <div>
          <h3>핵심</h3>
          <ul>
            {briefing.keyFindings.slice(0, 3).map((finding) => <li key={finding}>{finding}</li>)}
          </ul>
        </div>
        <div>
          <h3>다음</h3>
          <ul>
            {briefing.recommendedNextChecks.slice(0, 3).map((check) => <li key={check}>{check}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );

  const fusionPanel = (
    <FusionCopilotPanel
      query={queryText}
      presets={queryPresets}
      fusionEvents={scenario.fusionEvents}
      reviewStates={fusionReviewStates}
      intent={queryIntent}
      onQueryChange={setQueryText}
      onRunQuery={() => applyAnalystQuery(queryText)}
      onPreset={handleQueryPreset}
      onReviewChange={handleFusionReviewChange}
    />
  );

  const opsTrackSummary = isGlobalRegion
    ? `OSINT ${scenario.osintEvents.length} · 위성 ${scenario.satellites.length} · AOI 선택 시 상세`
    : `표시 항적 ${filteredTrackCount}/${rawTrackCount} · 위성 ${scenario.satellites.length} · 선박 ${scenario.ships.length} · OSINT ${scenario.osintEvents.length}`;
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
    <section className="panel ops-review-panel" aria-label="확인 대기, AI 브리핑, 신호 확인 이력">
      <div className="ops-review-tabs" role="tablist" aria-label="오른쪽 분석 패널">
        <button
          id="ops-review-tab-queue"
          type="button"
          role="tab"
          aria-selected={opsReviewTab === 'queue'}
          aria-controls="ops-review-panel-queue"
          className={opsReviewTab === 'queue' ? 'is-active' : ''}
          onClick={() => setOpsReviewTab('queue')}
        >
          확인 대기
          <span>{anomalies.length + scenario.fusionEvents.length}</span>
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
          AI 브리핑
          <span>{briefing.keyFindings.length}</span>
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
          신호 이력
          <span>{anomalyTimeline.length}</span>
        </button>
      </div>
      <div className="ops-review-panel__body">
        <div
          id="ops-review-panel-queue"
          role="tabpanel"
          aria-labelledby="ops-review-tab-queue"
          className="ops-review-pane ops-review-pane--queue"
          hidden={opsReviewTab !== 'queue'}
        >
          <AnomalyPanel anomalies={anomalies} compact />
          <FusionCopilotPanel
            query={queryText}
            presets={queryPresets}
            fusionEvents={scenario.fusionEvents}
            reviewStates={fusionReviewStates}
            intent={queryIntent}
            compact
            title="확인 대기"
            ariaLabel="자연어 질의와 확인 대기"
            onQueryChange={setQueryText}
            onRunQuery={() => applyAnalystQuery(queryText)}
            onPreset={handleQueryPreset}
            onReviewChange={handleFusionReviewChange}
          />
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
            events={anomalyTimeline}
            eyebrow="확인 타임라인"
            title="신호 확인 이력"
            emptyMessage="현재 확인 신호가 없습니다."
          />
        </div>
      </div>
    </section>
  );

  return (
    <main aria-label="공중 ISR 융합 상황판" className={`app-shell ${viewMode === 'ops' ? 'app-shell--ops' : ''}`}>
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
                ? `전세계 OSINT 포인트 ${scenario.osintEvents.length} · 위성 ${scenario.satellites.length} · 상세 항적/선박은 AOI에서 조회`
                : `표시 항적 ${filteredTrackCount}/${rawTrackCount} · 위성 ${scenario.satellites.length} · 선박 ${scenario.ships.length} · OSINT 포인트 ${scenario.osintEvents.length}`}
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
          {fusionPanel}
          <section className="map-grid">
            {mapPanel}
            <AnomalyPanel anomalies={anomalies} />
          </section>

          <section className="content-grid">
            <BriefingPanel briefing={briefing} />
            <Timeline events={timeline} />
          </section>

          <section className="panel source-matrix">
            <div className="panel__header">
              <p className="eyebrow">데이터 출처</p>
              <h2>무료/공개 API 계획</h2>
            </div>
            <div className="source-matrix__grid">
              {dataSources.map((source) => {
                const safeUrl = safeExternalUrl(source.url);
                return (
                  <article key={source.name}>
                    <Database size={18} />
                    <strong>{source.name}</strong>
                    <p>{source.role}</p>
                    <small>{source.mode}</small>
                    {safeUrl && <a href={safeUrl} target="_blank" rel="noreferrer">문서</a>}
                  </article>
                );
              })}
            </div>
          </section>

          <footer>
            <strong>안전 기준:</strong> 이 프로토타입은 공개 API와 해당 캐시만 사용합니다. 데이터가 없으면 합성 값으로 채우지 않습니다. 표적 식별, 타격 권고, 자동 교전 판단은 수행하지 않습니다.
          </footer>
        </>
      )}
    </main>
  );
}

export default App;
