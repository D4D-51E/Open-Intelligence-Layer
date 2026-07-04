import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SituationRealGlobe } from './components/SituationRealGlobe';
import { LiveTrackPanel } from './components/LiveTrackPanel';
import { TimelineControls } from './components/TimelineControls';
import { detectAnomalies } from './lib/anomaly';
import { getScenario } from './lib/baselineData';
import { buildFusionEvents } from './lib/fusion';
import { buildTrackFusionContext, type TrackFusionContext } from './lib/trackFusion';
import { buildAircraftIdentity, type AircraftIdentity } from './lib/aircraftIdentity';
import { parseOperatorDb, type OperatorDb } from './lib/callsignDb';
import { matchActiveAirspace } from './lib/noticeAirspace';
import { mergeLiveScenario, buildTimelineFromScenario, type LiveScenarioCache } from './lib/liveData';
import { defaultRegionId, regions } from './lib/regions';
import { fetchAdsbLolGlobalMilitary, fetchAdsbLolViewportTracks } from './lib/adsbLolApi';
import { fetchStrategyForZoom, viewportRadiusNm, type Viewport } from './lib/viewport';
import { fetchHistoryTracks } from './lib/historyApi';
import { fetchOsint, type OsintRow } from './lib/osintApi';
import { fetchNotam, type NotamRow } from './lib/notamApi';
import type { AirspaceNotice, OsintItem, OsintMapEvent, RegionId, Track } from './lib/types';

type AircraftTypeFilter = 'all' | 'military' | Track['platformType'];

const trackPollIntervalMs = 30_000;
const timelineWindowMs = 30 * 60 * 1000; // history playback window per frame
const timelineSpanMs = 6 * 60 * 60 * 1000; // slider covers the last 6h

const aircraftTypeOptions: Array<{ value: AircraftTypeFilter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'military', label: '군용' },
  { value: 'commercial', label: '민항' },
  { value: 'cargo', label: '화물' },
  { value: 'unknown', label: '미식별' },
];

// Airspace classification legend — colours MUST stay in sync with the OpenAIP
// `airspaceColor` expression in SituationRealGlobe.tsx (ensureAirspaceLayers).
const AIRSPACE_LEGEND: Array<{ color: string; label: string }> = [
  { color: '#ff2d55', label: '금지 (P)' },
  { color: '#ff8a3d', label: '제한·위험 (R/D)' },
  { color: '#ffb238', label: '군사 예약 (TSA/TRA)' },
  { color: '#e15dff', label: 'ADIZ 방공식별' },
  { color: '#ffe14a', label: '경보·경계' },
  { color: '#7dd3fc', label: '관제권 CTR/TMA' },
  { color: '#6b8fb5', label: '정보구역·등급 A–G' },
];

function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Nearest AOI preset to the viewport centre, used to attach weather/FIR/OSINT context.
function nearestRegionId(center: [number, number]): RegionId {
  let best: RegionId = defaultRegionId;
  let bestKm = Infinity;
  for (const region of regions) {
    if (region.id === 'global') continue;
    const km = haversineKm(center[0], center[1], region.center[0], region.center[1]);
    if (km < bestKm) { bestKm = km; best = region.id; }
  }
  return bestKm < 900 ? best : defaultRegionId;
}

// Aggregate history rows into one multi-point track per aircraft so the timeline renders
// actual trails (항적). Each row is a single observation; grouping by icao24/callsign and
// sorting by time turns the scattered points into a continuous track across the window.
function buildHistoryTracks(rows: Awaited<ReturnType<typeof fetchHistoryTracks>>): Track[] {
  const byAircraft = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = row.icao24 ?? row.callsign ?? `${row.lat},${row.lon}`;
    const existing = byAircraft.get(key);
    if (existing) existing.push(row);
    else byAircraft.set(key, [row]);
  }
  return [...byAircraft].map(([key, group]) => {
    const sorted = [...group].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
    const latest = sorted[sorted.length - 1];
    return {
      id: `hist-${key}`,
      source: 'adsb-cache',
      callsign: latest.callsign ?? latest.icao24 ?? 'Aircraft',
      originCountry: 'Unknown',
      platformType: 'unknown',
      baselineCorridorKm: 25,
      isMilitary: latest.is_military,
      icao24: latest.icao24 ?? undefined,
      typeCode: latest.type_code ?? undefined,
      points: sorted.map((row) => ({
        lat: row.lat,
        lon: row.lon,
        altitudeM: row.altitude_m ?? 0,
        velocityMs: row.velocity_ms ?? 0,
        headingDeg: row.heading_deg ?? 0,
        observedAt: row.observed_at,
      })),
    };
  });
}

function osintRowToEvent(row: OsintRow, index: number): OsintMapEvent | null {
  if (row.lat == null || row.lon == null) return null;
  return {
    id: `osint-live-${index}-${row.observed_at}`,
    regionId: (row.region_id || 'global') as RegionId,
    source: 'gdelt-cache',
    title: row.title,
    lat: row.lat,
    lon: row.lon,
    observedAt: row.observed_at,
    confidence: row.tier === 'authoritative' ? 0.82 : 0.6,
    relatedOsintId: '',
    url: row.url ?? undefined,
    tags: [row.source, row.tier],
  };
}

function notamRowToNotice(row: NotamRow, index: number): AirspaceNotice {
  const fl = row.fl_min != null || row.fl_max != null ? ` FL${row.fl_min ?? '?'}–${row.fl_max ?? '?'}` : '';
  return {
    id: `notam-live-${row.notam_number ?? index}-${index}`,
    regionId: 'global' as RegionId,
    source: 'icao-notam-cache',
    title: `${row.icao ?? ''} ${row.feature ?? 'NOTAM'} ${row.notam_number ?? ''}`.trim(),
    description: `${row.feature ?? 'NOTAM'}${fl}`,
    publishedAt: row.observed_at,
    effectiveFrom: row.start_at ?? undefined,
    effectiveTo: row.end_at ?? undefined,
    lat: row.lat,
    lon: row.lon,
    radiusKm: row.radius_km ?? 5,
    severity: 'watch',
  };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}

// Popup HTML shown on the aircraft when a track is selected on the globe.
function buildTrackPopupHtml(track: Track, identity: AircraftIdentity | null, fusion: TrackFusionContext | null): string {
  const last = track.points.at(-1);
  const mil = Boolean(track.isMilitary || identity?.militaryLikely);
  const rows: string[] = [];
  if (identity?.callsignProgram) rows.push(`<div><b>운영자</b> ${escapeHtml(identity.callsignProgram)}</div>`);
  else if (identity?.operatorCandidates.length) rows.push(`<div><b>운영자</b> ${escapeHtml(identity.operatorCandidates[0])} (추정)</div>`);
  if (identity?.typeCandidate) rows.push(`<div><b>기종</b> ${escapeHtml(identity.typeCandidate)}</div>`);
  if (identity?.icao24 || identity?.registrationCountry) {
    rows.push(`<div><b>ICAO24</b> ${escapeHtml(identity.icao24 ?? '-')}${identity.registrationCountry ? ` · ${escapeHtml(identity.registrationCountry)}` : ''}</div>`);
  }
  if (last) rows.push(`<div><b>고도/속도</b> ${last.altitudeM.toLocaleString()}m · ${last.velocityMs}m/s</div>`);
  const presentAxes = (fusion?.axes ?? []).filter((axis) => axis.present).slice(0, 3);
  for (const axis of presentAxes) rows.push(`<div><b>${escapeHtml(axis.label)}</b> ${escapeHtml(axis.detail)}</div>`);
  return `<div class="globe-track-popup__body">
    <div class="globe-track-popup__head">${escapeHtml(track.callsign)}${mil ? '<span class="globe-track-popup__mil">군용</span>' : ''}</div>
    ${rows.join('')}
    <div class="globe-track-popup__safe">공개 ADS-B/공개 소스 · 비표적화</div>
  </div>`;
}

function App() {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [viewportTracks, setViewportTracks] = useState<Track[]>([]);
  const [trackLoadState, setTrackLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [trackLastErrorAt, setTrackLastErrorAt] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | undefined>();
  const [operatorDb, setOperatorDb] = useState<OperatorDb | null>(null);
  const [liveCache, setLiveCache] = useState<LiveScenarioCache | null>(null);
  const [aircraftTypeFilter, setAircraftTypeFilter] = useState<AircraftTypeFilter>('all');
  const [minimumAltitudeM, setMinimumAltitudeM] = useState(0);
  const [showAirspace, setShowAirspace] = useState(true);
  const [showOsint, setShowOsint] = useState(true);
  const [showNotam, setShowNotam] = useState(true);
  const [liveOsint, setLiveOsint] = useState<OsintMapEvent[]>([]);
  const [liveNotam, setLiveNotam] = useState<AirspaceNotice[]>([]);
  const [timelineMode, setTimelineMode] = useState(false);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [timelineValue, setTimelineValue] = useState(() => Date.now());
  const [timelineNow, setTimelineNow] = useState(() => Date.now());
  const [historyTracks, setHistoryTracks] = useState<Track[]>([]);
  const viewportRef = useRef<Viewport | null>(null);

  const regionId = useMemo<RegionId>(() => (viewport ? nearestRegionId(viewport.center) : defaultRegionId), [viewport]);
  const strategy = viewport ? fetchStrategyForZoom(viewport.zoom) : 'global-mil';
  const baseScenario = useMemo(() => getScenario(regionId), [regionId]);

  const sourceTracks = timelineMode ? historyTracks : viewportTracks;
  const filteredTracks = useMemo(
    () => sourceTracks.filter((track) => {
      if (aircraftTypeFilter === 'military') { if (!track.isMilitary) return false; }
      else if (aircraftTypeFilter !== 'all' && track.platformType !== aircraftTypeFilter) return false;
      const last = track.points.at(-1);
      if (!last) return false;
      return last.altitudeM >= minimumAltitudeM;
    }),
    [aircraftTypeFilter, minimumAltitudeM, sourceTracks],
  );

  const mergedScenario = useMemo(() => {
    const region = liveCache?.regions?.[regionId];
    return mergeLiveScenario(baseScenario, region ? { ...region, tracks: filteredTracks } : { tracks: filteredTracks });
  }, [baseScenario, filteredTracks, liveCache, regionId]);
  const anomalies = useMemo(() => detectAnomalies(mergedScenario), [mergedScenario]);
  const scenario = useMemo(() => {
    // Replace the initial-MVP snapshot OSINT (both the map events and the fusion items)
    // with the live Neon OSINT feed so no seeded/legacy OSINT remains.
    const liveOsintItems: OsintItem[] = liveOsint.map((event) => ({
      id: event.id,
      source: 'gdelt-cache',
      regionId: event.regionId,
      title: event.title,
      url: event.url,
      publishedAt: event.observedAt,
      summary: event.title,
      tags: event.tags,
      confidence: event.confidence,
    }));
    const withLive = {
      ...mergedScenario,
      osint: showOsint ? liveOsintItems : [],
      osintEvents: showOsint ? liveOsint : [],
      notices: showNotam ? liveNotam : [],
    };
    const fusionEvents = buildFusionEvents(withLive, anomalies);
    const withFusion = { ...withLive, fusionEvents };
    return { ...withFusion, timeline: buildTimelineFromScenario(withFusion) };
  }, [anomalies, liveNotam, liveOsint, mergedScenario, showNotam, showOsint]);

  const selectedTrack = useMemo(() => scenario.tracks.find((t) => t.id === selectedTrackId), [scenario.tracks, selectedTrackId]);
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
    return matchActiveAirspace({ lat: last.lat, lon: last.lon, altitudeM: last.altitudeM, observedAt: last.observedAt }, scenario.notices, new Date());
  }, [scenario.notices, selectedTrack]);

  const focusTrack = useMemo(() => {
    const last = selectedTrack?.points.at(-1);
    if (!selectedTrack || !last) return null;
    return { lat: last.lat, lon: last.lon, html: buildTrackPopupHtml(selectedTrack, aircraftIdentity, fusionContext) };
  }, [aircraftIdentity, fusionContext, selectedTrack]);

  const militaryCount = useMemo(() => scenario.tracks.filter((t) => t.isMilitary).length, [scenario.tracks]);

  const handleSelectTrack = useCallback((trackId: string) => {
    setSelectedTrackId((current) => (current === trackId ? undefined : trackId));
  }, []);
  const handleFocusClose = useCallback(() => setSelectedTrackId(undefined), []);
  const handleViewportChange = useCallback((v: Viewport) => {
    viewportRef.current = v;
    setViewport(v);
  }, []);

  // Operator dataset (one-shot).
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.fetch('/data/aircraft-operators.json', { cache: 'force-cache' });
        if (!res.ok) return;
        const json = await res.json();
        if (!cancelled) setOperatorDb(parseOperatorDb(json));
      } catch { /* offline: identity uses the built-in fallback */ }
    })();
    return () => { cancelled = true; };
  }, []);

  // Live cache for weather/FIR/OSINT context (one-shot + slow refresh).
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return undefined;
    let cancelled = false;
    const load = async () => {
      for (const endpoint of [`/api/live-scenarios?t=${Date.now()}`, `/data/live-scenarios.json?t=${Date.now()}`]) {
        try {
          const res = await window.fetch(endpoint, { cache: 'no-store' });
          if (!res.ok) continue;
          const json = await res.json() as LiveScenarioCache;
          if (json?.regions && !cancelled) { setLiveCache(json); return; }
        } catch { /* try next */ }
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);

  // Viewport/zoom-driven live track fetch.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function' || timelineMode) return undefined;
    let cancelled = false;
    const inFlight = new Set<AbortController>();
    const load = async () => {
      const v = viewportRef.current;
      const controller = new AbortController();
      inFlight.add(controller);
      try {
        let tracks: Track[];
        if (!v || fetchStrategyForZoom(v.zoom) === 'global-mil') {
          tracks = await fetchAdsbLolGlobalMilitary({ signal: controller.signal });
        } else {
          tracks = await fetchAdsbLolViewportTracks({
            center: v.center,
            bbox: v.bbox,
            radiusNm: viewportRadiusNm(v.bbox, v.center),
            signal: controller.signal,
          });
        }
        if (cancelled) return;
        setViewportTracks(tracks);
        setTrackLoadState('ready');
        setTrackLastErrorAt(null);
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return;
        setTrackLoadState('unavailable');
        setTrackLastErrorAt(new Date().toISOString());
      } finally {
        inFlight.delete(controller);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), trackPollIntervalMs);
    return () => { cancelled = true; for (const c of inFlight) c.abort(); window.clearInterval(timer); };
  }, [timelineMode, viewport]);

  // Timeline history fetch (Neon /api/history) when scrubbing.
  useEffect(() => {
    if (!timelineMode || typeof window === 'undefined') return undefined;
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      const rows = await fetchHistoryTracks({
        region: regionId === 'global' ? undefined : regionId,
        from: new Date(timelineValue - timelineWindowMs).toISOString(),
        to: new Date(timelineValue).toISOString(),
        limit: 3000,
        signal: controller.signal,
      });
      if (!cancelled) setHistoryTracks(buildHistoryTracks(rows));
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [regionId, timelineMode, timelineValue]);

  // Timeline auto-play.
  useEffect(() => {
    if (!timelineMode || !timelinePlaying) return undefined;
    const timer = window.setInterval(() => {
      setTimelineValue((v) => {
        const next = v + timelineWindowMs;
        return next > Date.now() ? Date.now() - timelineSpanMs : next;
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [timelineMode, timelinePlaying]);

  // Live OSINT feed (Neon /api/osint), refreshed periodically.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return undefined;
    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      const rows = await fetchOsint({ limit: 400, signal: controller.signal });
      if (!cancelled) setLiveOsint(rows.map(osintRowToEvent).filter((event): event is OsintMapEvent => event !== null));
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); };
  }, []);

  // Live NOTAM circles (Neon /api/notam), by the current viewport bbox.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return undefined;
    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      const rows = await fetchNotam({ bbox: viewportRef.current?.bbox, limit: 500, signal: controller.signal });
      if (!cancelled) setLiveNotam(rows.map(notamRowToNotice));
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); };
  }, [viewport]);

  const zoomModeLabel = strategy === 'global-mil' ? '전세계 군용' : '뷰포트 상세';
  const trackStatusLabel = trackLoadState === 'ready' ? '수신' : trackLoadState === 'unavailable' ? '사용 불가' : '수집 중';

  return (
    <main className="globe-shell" aria-label="AirMaven 실시간 항적 글로브">
      <div className="globe-shell__map">
        <SituationRealGlobe
          region={scenario.region}
          selectableRegions={regions}
          tracks={scenario.tracks}
          ships={scenario.ships}
          zones={[]}
          referenceLines={[]}
          satellites={[]}
          airports={[]}
          airRoutes={[]}
          notices={scenario.notices}
          airspaceContexts={[]}
          osintEvents={scenario.osintEvents}
          anomalies={anomalies}
          onViewportChange={handleViewportChange}
          focusTrack={focusTrack}
          onFocusClose={handleFocusClose}
          showAirspace={showAirspace}
        />
      </div>

      <div className="globe-hud globe-hud--topleft">
        <strong>AirMaven</strong>
        <span>{zoomModeLabel} · 항적 {scenario.tracks.length}{militaryCount > 0 ? ` · 군용 ${militaryCount}` : ''}</span>
        <span className={`globe-hud__status globe-hud__status--${trackLoadState}`}>
          adsb.lol {trackStatusLabel}{trackLastErrorAt ? ' · 오류' : ''}
        </span>
      </div>

      <div className="globe-hud globe-hud--topright" aria-label="필터">
        <label>
          유형
          <select value={aircraftTypeFilter} onChange={(e) => setAircraftTypeFilter(e.target.value as AircraftTypeFilter)}>
            {aircraftTypeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label>
          최소 고도
          <select value={minimumAltitudeM} onChange={(e) => setMinimumAltitudeM(Number(e.target.value))}>
            <option value={0}>전체</option>
            <option value={3000}>3,000m+</option>
            <option value={6000}>6,000m+</option>
            <option value={9000}>9,000m+</option>
          </select>
        </label>
        <button type="button" className={showAirspace ? 'is-active' : ''} onClick={() => setShowAirspace((s) => !s)}>
          공역 {showAirspace ? 'ON' : 'OFF'}
        </button>
        <button type="button" className={showOsint ? 'is-active' : ''} onClick={() => setShowOsint((s) => !s)}>
          OSINT {showOsint ? 'ON' : 'OFF'}
        </button>
        <button type="button" className={showNotam ? 'is-active' : ''} onClick={() => setShowNotam((s) => !s)}>
          NOTAM {showNotam ? 'ON' : 'OFF'}
        </button>
        <button
          type="button"
          className={timelineMode ? 'is-active' : ''}
          onClick={() => setTimelineMode((m) => {
            const next = !m;
            if (next) {
              const now = Date.now();
              setTimelineNow(now);
              setTimelineValue(now);
            }
            return next;
          })}
        >
          타임라인 {timelineMode ? 'ON' : 'OFF'}
        </button>
      </div>

      {showAirspace ? (
        <div className={`globe-hud globe-hud--legend${timelineMode ? ' globe-hud--legend--raised' : ''}`} aria-label="공역 분류 범례">
          <span className="globe-hud--legend__title">공역 분류</span>
          {AIRSPACE_LEGEND.map((row) => (
            <span key={row.label} className="globe-hud--legend__row">
              <i style={{ background: row.color }} aria-hidden="true" />
              {row.label}
            </span>
          ))}
        </div>
      ) : null}

      <aside className="globe-hud globe-hud--panel">
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
      </aside>

      {timelineMode ? (
        <div className="globe-hud globe-hud--timeline">
          <TimelineControls
            min={timelineNow - timelineSpanMs}
            max={timelineNow}
            value={timelineValue}
            playing={timelinePlaying}
            label={`${new Date(timelineValue).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · 과거 ${historyTracks.length}건`}
            onChange={(v) => setTimelineValue(v)}
            onTogglePlay={() => setTimelinePlaying((p) => !p)}
          />
        </div>
      ) : null}
    </main>
  );
}

export default App;
