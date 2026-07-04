import 'leaflet/dist/leaflet.css';
import { Activity, Database, RadioTower, Satellite } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SituationMap } from './components/SituationMap';
import { MetricCard } from './components/MetricCard';
import { LiveTrackPanel } from './components/LiveTrackPanel';
import { IngestLogPanel, type IngestLogEntry } from './components/IngestLogPanel';
import { detectAnomalies } from './lib/anomaly';
import { getScenario } from './lib/baselineData';
import { buildFusionEvents } from './lib/fusion';
import { buildTrackFusionContext } from './lib/trackFusion';
import { buildAircraftIdentity } from './lib/aircraftIdentity';
import { parseOperatorDb, type OperatorDb } from './lib/callsignDb';
import { matchActiveAirspace } from './lib/noticeAirspace';
import { buildTimelineFromScenario, mergeLiveScenario, type LiveScenarioCache } from './lib/liveData';
import { liveTrackHistoryForRegion, mergeLiveTrackHistory, type LiveTrackHistory } from './lib/liveTrackHistory';
import { defaultRegionId, isRegionId, regions } from './lib/regions';
import { safeExternalUrl } from './lib/safeLinks';
import { sourceStatusIsOperational, sourceStatusLabel } from './lib/display';
import { implementedSourceCount, osintSourceCatalog, sourceStatusForCatalogEntry } from './lib/osintSources';
import { estimateAirplanesRadiusNm, fetchAirplanesLiveTracks } from './lib/airplanesLiveApi';
import { estimateAdsbLolRadiusNm, fetchAdsbLolTracks } from './lib/adsbLolApi';
import type { RegionId, Track } from './lib/types';

type BasemapMode = 'globe' | 'hud-globe' | 'offline' | 'live';
type ViewMode = 'ops' | 'narrative';
type AircraftTypeFilter = 'all' | 'military' | Track['platformType'];
const livePollIntervalMs = 30_000;
const airplanesLivePollIntervalMs = 30_000;
const maxIngestLogEntries = 60;
const aircraftTypeOptions: Array<{ value: AircraftTypeFilter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'military', label: '군용' },
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

function mergeTracksById(existing: Track[], incoming: Track[]) {
  const map = new Map<string, Track>();
  for (const track of [...existing, ...incoming]) {
    // Dedupe the same physical aircraft across ADS-B sources (OpenSky / Airplanes.live / adsb.lol)
    // by ICAO24 hex when available, keeping the richest history and preserving the military flag.
    const key = track.icao24 || track.id;
    const current = map.get(key);
    if (!current) {
      map.set(key, track);
      continue;
    }
    const richer = track.points.length > current.points.length ? track : current;
    const isMilitary = Boolean(current.isMilitary || track.isMilitary);
    map.set(key, isMilitary === Boolean(richer.isMilitary) ? richer : { ...richer, isMilitary });
  }
  return [...map.values()];
}

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

function sourceCatalogStatusLabel(value: ReturnType<typeof sourceStatusForCatalogEntry>) {
  if (value === 'manual') return '수동 등록';
  if (value === 'commercial-ready') return '유료/파트너십';
  return sourceStatusLabel(value);
}

function App() {
  const [regionId, setRegionId] = useState<RegionId>(initialRegionId);
  const [basemapMode, setBasemapMode] = useState<BasemapMode>(initialBasemapMode);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [liveCache, setLiveCache] = useState<LiveScenarioCache | null>(null);
  const [liveLoadState, setLiveLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [liveLastCheckedAt, setLiveLastCheckedAt] = useState<string | null>(null);
  const [liveLastErrorAt, setLiveLastErrorAt] = useState<string | null>(null);
  const [ingestLogs, setIngestLogs] = useState<IngestLogEntry[]>([]);
  const [liveTrackHistory, setLiveTrackHistory] = useState<LiveTrackHistory>({});
  const [aircraftTypeFilter, setAircraftTypeFilter] = useState<AircraftTypeFilter>('all');
  const [minimumAltitudeM, setMinimumAltitudeM] = useState(0);
  const [minimumSpeedMs, setMinimumSpeedMs] = useState(0);
  const [selectedTrackId, setSelectedTrackId] = useState<string | undefined>();
  const [airplanesTrackHistory, setAirplanesTrackHistory] = useState<LiveTrackHistory>({});
  const [airplanesLoadState, setAirplanesLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [airplanesLastCheckedAt, setAirplanesLastCheckedAt] = useState<string | null>(null);
  const [airplanesLastErrorAt, setAirplanesLastErrorAt] = useState<string | null>(null);
  const [adsbLolTrackHistory, setAdsbLolTrackHistory] = useState<LiveTrackHistory>({});
  const [adsbLolLoadState, setAdsbLolLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [adsbLolLastErrorAt, setAdsbLolLastErrorAt] = useState<string | null>(null);
  const [operatorDb, setOperatorDb] = useState<OperatorDb | null>(null);
  const liveCacheRef = useRef<LiveScenarioCache | null>(null);
  const baseScenario = useMemo(() => getScenario(regionId), [regionId]);
  const airplanesHistoryTracks = liveTrackHistoryForRegion(airplanesTrackHistory, regionId);
  const adsbLolHistoryTracks = liveTrackHistoryForRegion(adsbLolTrackHistory, regionId);
  const liveHistoryTracks = liveTrackHistoryForRegion(liveTrackHistory, regionId);
  const mergedHistoryTracks = useMemo(
    () => mergeTracksById(mergeTracksById(liveHistoryTracks, airplanesHistoryTracks), adsbLolHistoryTracks),
    [adsbLolHistoryTracks, airplanesHistoryTracks, liveHistoryTracks],
  );
  const mergedScenario = useMemo(() => {
    const liveRegion = liveCache?.regions?.[regionId];
    const regionTracks = mergedHistoryTracks.length ? { ...liveRegion, tracks: mergedHistoryTracks } : liveRegion;
    return mergeLiveScenario(baseScenario, regionTracks);
  }, [baseScenario, liveCache, mergedHistoryTracks, regionId]);
  const filteredTracks = useMemo(
    () => mergedScenario.tracks.filter((track) => {
      if (aircraftTypeFilter === 'military') {
        if (!track.isMilitary) return false;
      } else if (aircraftTypeFilter !== 'all' && track.platformType !== aircraftTypeFilter) {
        return false;
      }
      const last = track.points.at(-1);
      if (!last) return false;
      return last.altitudeM >= minimumAltitudeM && last.velocityMs >= minimumSpeedMs;
    }),
    [aircraftTypeFilter, mergedScenario.tracks, minimumAltitudeM, minimumSpeedMs],
  );
  const anomalies = useMemo(
    () => detectAnomalies({ ...mergedScenario, tracks: filteredTracks }),
    [mergedScenario, filteredTracks],
  );
  const scenario = useMemo(() => {
    const core = { ...mergedScenario, tracks: filteredTracks };
    const fusionEvents = buildFusionEvents(core, anomalies);
    const withFusion = { ...core, fusionEvents };
    return { ...withFusion, timeline: buildTimelineFromScenario(withFusion) };
  }, [anomalies, filteredTracks, mergedScenario]);
  const selectedTrack = useMemo(
    () => scenario.tracks.find((track) => track.id === selectedTrackId),
    [scenario.tracks, selectedTrackId],
  );
  const fusionContext = useMemo(
    () => (selectedTrack ? buildTrackFusionContext(selectedTrack, scenario, anomalies) : null),
    [anomalies, scenario, selectedTrack],
  );
  const aircraftIdentity = useMemo(
    () => (selectedTrack ? buildAircraftIdentity(selectedTrack, operatorDb ?? undefined) : null),
    [operatorDb, selectedTrack],
  );
  const activeAirspace = useMemo(() => {
    const last = selectedTrack?.points.at(-1);
    if (!selectedTrack || !last) return [];
    return matchActiveAirspace(
      { lat: last.lat, lon: last.lon, altitudeM: last.altitudeM, observedAt: last.observedAt },
      scenario.notices,
      new Date(),
    );
  }, [scenario.notices, selectedTrack]);

  const isGlobalRegion = regionId === 'global';
  const rawTrackCount = mergedScenario.tracks.length;
  const filteredTrackCount = scenario.tracks.length;
  const militaryCount = useMemo(() => scenario.tracks.filter((track) => track.isMilitary).length, [scenario.tracks]);
  const overviewFusion = scenario.fusionEvents[0];
  const handleRegionSelect = useCallback((value: RegionId) => {
    setRegionId(value);
    setSelectedTrackId(undefined);
  }, []);
  const handleRegionChange = (value: string) => {
    if (isRegionId(value)) handleRegionSelect(value);
  };
  const handleSelectTrack = useCallback((trackId: string) => {
    setSelectedTrackId((current) => (current === trackId ? undefined : trackId));
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
  const airplanesTrackCount = airplanesHistoryTracks.length;
  const trackDetail = isGlobalRegion
    ? '상세 항적은 AOI 선택 시 조회'
    : liveRegionStatus?.opensky === 'live' && liveTrackCount > 0
      ? `OpenSky live ${liveTrackCount}`
      : liveRegionStatus?.opensky === 'cached' && mergedScenario.tracks.length > 0
        ? 'OpenSky 캐시 재사용'
        : liveRegionStatus?.opensky === 'unavailable'
          ? 'OpenSky 사용 불가'
          : 'OpenSky 수집 대기';
  const airplanesTrackSummary = airplanesTrackCount > 0 ? `Airplanes live ${airplanesTrackCount}기` : 'Airplanes live 없음';
  const airplanesLoadStateEffective = isGlobalRegion ? 'unavailable' : airplanesLoadState;
  const airplanesLoadSummary = `${liveLoadStateLabel(airplanesLoadStateEffective)} · ${airplanesTrackCount > 0 ? `${airplanesTrackCount}기` : '0기'}`;
  const adsbLolTrackCount = adsbLolHistoryTracks.length;
  const adsbLolLoadStateEffective = isGlobalRegion ? 'unavailable' : adsbLolLoadState;
  const adsbLolLoadSummary = `${liveLoadStateLabel(adsbLolLoadStateEffective)} · ${adsbLolTrackCount}기`;
  const weatherDetail = isGlobalRegion
    ? '전세계 모드는 지역별 기상 상세 비활성'
    : scenario.weather
      ? `운량 ${scenario.weather.cloudCoverPct}%, 돌풍 ${scenario.weather.windGustKmh}km/h`
      : 'Open-Meteo 수집 대기';
  const sourceCoverageCount = implementedSourceCount(scenario);
  const fusionConfidencePct = overviewFusion ? Math.round(overviewFusion.confidence * 100) : null;
  const fusionFactorDetail = overviewFusion
    ? `출처 ${Math.round(overviewFusion.confidenceFactors.sourceReliability * 100)}% · 최신 ${Math.round(overviewFusion.confidenceFactors.freshness * 100)}% · 교차 ${Math.round(overviewFusion.confidenceFactors.crossSourceAgreement * 100)}%`
    : '융합할 실데이터 대기';
  const appendIngestLog = useCallback((level: IngestLogEntry['level'], message: string, at = new Date().toISOString()) => {
    setIngestLogs((current) => [
      { id: `${at}-${level}-${current.length}`, at, level, message },
      ...current,
    ].slice(0, maxIngestLogEntries));
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const response = await window.fetch('/data/aircraft-operators.json', { cache: 'force-cache' });
        if (!response.ok) return;
        const json = await response.json();
        if (cancelled) return;
        setOperatorDb(parseOperatorDb(json));
      } catch {
        // Offline: aircraft identity falls back to the built-in prefix table.
      }
    })();
    return () => {
      cancelled = true;
    };
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

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function' || regionId === 'global') {
      return;
    }

    let cancelled = false;
    const inFlight = new Set<AbortController>();

    const loadAirplanesLive = async () => {
      const checkedAt = new Date().toISOString();
      const controller = new AbortController();
      inFlight.add(controller);
      try {
        const tracks = await fetchAirplanesLiveTracks({
          region: baseScenario.region,
          radiusNm: estimateAirplanesRadiusNm(baseScenario.region),
          signal: controller.signal,
          rateLimitMs: 1_000,
        });
        if (cancelled) return;
        setAirplanesTrackHistory((current) => mergeLiveTrackHistory(current, regionId, tracks, checkedAt));
        setAirplanesLoadState('ready');
        setAirplanesLastCheckedAt(checkedAt);
        setAirplanesLastErrorAt(null);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setAirplanesLoadState('unavailable');
        setAirplanesLastCheckedAt(checkedAt);
        setAirplanesLastErrorAt(checkedAt);
        appendIngestLog('warn', `Airplanes.live 폴링 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}` , checkedAt);
      } finally {
        inFlight.delete(controller);
      }
    };

    void loadAirplanesLive();
    const timer = window.setInterval(() => {
      void loadAirplanesLive();
    }, airplanesLivePollIntervalMs);

    return () => {
      cancelled = true;
      for (const controller of inFlight) controller.abort();
      window.clearInterval(timer);
    };
  }, [appendIngestLog, baseScenario.region, regionId]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function' || regionId === 'global') {
      return;
    }

    let cancelled = false;
    const inFlight = new Set<AbortController>();

    const loadAdsbLol = async () => {
      const checkedAt = new Date().toISOString();
      const controller = new AbortController();
      inFlight.add(controller);
      try {
        const tracks = await fetchAdsbLolTracks({
          region: baseScenario.region,
          radiusNm: estimateAdsbLolRadiusNm(baseScenario.region),
          signal: controller.signal,
          rateLimitMs: 1_000,
        });
        if (cancelled) return;
        setAdsbLolTrackHistory((current) => mergeLiveTrackHistory(current, regionId, tracks, checkedAt));
        setAdsbLolLoadState('ready');
        setAdsbLolLastErrorAt(null);
      } catch (error) {
        if (cancelled) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setAdsbLolLoadState('unavailable');
        setAdsbLolLastErrorAt(checkedAt);
        appendIngestLog('warn', `adsb.lol 폴링 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`, checkedAt);
      } finally {
        inFlight.delete(controller);
      }
    };

    void loadAdsbLol();
    const timer = window.setInterval(() => {
      void loadAdsbLol();
    }, airplanesLivePollIntervalMs);

    return () => {
      cancelled = true;
      for (const controller of inFlight) controller.abort();
      window.clearInterval(timer);
    };
  }, [appendIngestLog, baseScenario.region, regionId]);

  const metrics = (
    <section className="metrics-grid">
      <MetricCard
        label="실시간 항적"
        value={filteredTrackCount}
        detail={`${isGlobalRegion ? trackDetail : `${trackDetail} · ${airplanesTrackSummary}`}${militaryCount > 0 ? ` · 군용 ${militaryCount}기` : ''}`}
        tone={militaryCount > 0 ? 'watch' : 'neutral'}
        icon={<RadioTower size={18} />}
      />
      <MetricCard
        label="융합 신뢰도"
        value={fusionConfidencePct != null ? `${fusionConfidencePct}%` : '-'}
        detail={fusionFactorDetail}
        tone={fusionConfidencePct != null && fusionConfidencePct >= 60 ? 'good' : overviewFusion ? 'watch' : 'neutral'}
        icon={<Activity size={18} />}
      />
      <MetricCard
        label="관측 레이어"
        value={`${filteredTrackCount}/${scenario.satellites.length}`}
        detail={`항적/위성 · ${rawTrackCount === filteredTrackCount ? trackDetail : `필터 ${filteredTrackCount}/${rawTrackCount}`} · ${weatherDetail}`}
        tone="neutral"
        icon={<Satellite size={18} />}
      />
      <MetricCard
        label="소스 커버리지"
        value={`${sourceCoverageCount}/${osintSourceCatalog.length}`}
        detail={`OSINT ${scenario.osint.length}·이벤트 ${scenario.osintEvents.length} · 공역 ${scenario.airspaceContexts.length} · 선박 ${scenario.ships.length}${sourceReasonItems.length ? ` · 공백 ${sourceReasonItems.length}` : ''}`}
        tone={sourceReasonItems.length > sourceCoverageCount ? 'watch' : 'neutral'}
        icon={<Database size={18} />}
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
          LIVE · 항적 {filteredTrackCount}/{rawTrackCount}{militaryCount > 0 ? ` · 군용 ${militaryCount}` : ''} · 위성 {scenario.satellites.length} · OSINT {scenario.osintEvents.length} · 융합 {scenario.fusionEvents.length}
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

  const liveTrackPanel = (
    <LiveTrackPanel
      regionName={scenario.region.shortName}
      tracks={scenario.tracks}
      selectedTrackId={selectedTrackId}
      onSelectTrack={handleSelectTrack}
      fusionContext={fusionContext}
      fusionEvents={scenario.fusionEvents}
      timeline={scenario.timeline}
      militaryCount={militaryCount}
      identity={aircraftIdentity}
      activeAirspace={activeAirspace}
    />
  );

  const opsTrackSummary = isGlobalRegion
    ? `융합 ${scenario.fusionEvents.length} · OSINT ${scenario.osintEvents.length} · 위성 ${scenario.satellites.length} · AOI 선택 시 상세`
    : `항적 ${filteredTrackCount}/${rawTrackCount}${militaryCount > 0 ? `(군용 ${militaryCount})` : ''} · 위성 ${scenario.satellites.length} · OSINT ${scenario.osintEvents.length}`;
  const opsSnapshotSummary = liveGeneratedAt
    ? `${liveCacheAge} · 출처 ${liveSourceOk}/${liveSourceTotal || '-'} · Airplanes ${airplanesTrackSummary}`
    : `스냅샷 대기 · Airplanes ${airplanesLoadSummary}`;

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
        <span>Airplanes {airplanesLoadSummary}</span>
        <span>adsb.lol {adsbLolLoadSummary}</span>
        {sourceReasonItems.length > 0 ? <em>주의 {sourceReasonItems.length}</em> : null}
        {liveLastErrorAt ? <em>폴링 오류</em> : null}
        {airplanesLastErrorAt ? <em>Airplanes 폴링 오류</em> : null}
        {adsbLolLastErrorAt ? <em>adsb.lol 폴링 오류</em> : null}
      </div>
    </section>
  );

  return (
    <main aria-label="AirMaven 실시간 항적·다중소스 융합 상황판" className={`app-shell ${viewMode === 'ops' ? 'app-shell--ops' : ''}`}>
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
                {` · Airplanes ${airplanesLoadSummary} · 마지막 확인 ${formatRelativeAge(airplanesLastCheckedAt)}`}
                {airplanesLastErrorAt ? ` · Airplanes 오류 ${formatRelativeAge(airplanesLastErrorAt)}` : ''}
                {` · adsb.lol ${adsbLolLoadSummary}`}
                {adsbLolLastErrorAt ? ` · adsb.lol 오류 ${formatRelativeAge(adsbLolLastErrorAt)}` : ''}
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
                ? `융합 ${scenario.fusionEvents.length} · 전세계 OSINT 포인트 ${scenario.osintEvents.length} · 위성 ${scenario.satellites.length}`
                : `표시 항적 ${filteredTrackCount}/${rawTrackCount}${militaryCount > 0 ? ` · 군용 ${militaryCount}` : ''} · 위성 ${scenario.satellites.length} · OSINT 포인트 ${scenario.osintEvents.length}`}
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
            {liveTrackPanel}
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
            {liveTrackPanel}
          </section>

          <section className="panel source-matrix">
            <div className="panel__header">
              <p className="eyebrow">OSINT Integrations</p>
              <h2>다중소스 연계 매트릭스</h2>
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
            <strong>안전 기준:</strong> AirMaven는 공개 ADS-B 항적과 궤도·기상·OSINT 공개 소스를 같은 AOI로 노출·융합하는 분석관 보조 시스템입니다. 데이터가 없으면 합성 값으로 채우지 않으며, 군용 표시는 공개 ADS-B 플래그 노출일 뿐 식별·표적 지정·타격 권고·자동 교전 판단을 수행하지 않습니다.
          </footer>
        </>
      )}
    </main>
  );
}

export default App;
