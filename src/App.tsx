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
import { fetchVesselTracks } from './lib/vesselsApi';
import { vesselTypeLabel } from './lib/display';
import { fetchOsint, type OsintRow } from './lib/osintApi';
import { fetchTelegramPosts, type TelegramPost } from './lib/telegramApi';
import { assessClaims, geolocate, type AssessedClaim } from './lib/claimVerify';
import { fetchNotam, type NotamRow } from './lib/notamApi';
import { fetchSeismic, type SeismicEvent } from './lib/seismicApi';
import { fetchSatelliteModels, propagateSatellites, type SatelliteModel } from './lib/satelliteApi';
import { fetchAirAlerts, type AirAlert } from './lib/airAlertApi';
import type { AirspaceNotice, OsintItem, OsintMapEvent, RegionId, SatellitePass, ShipTrack, ThermalAnomaly, Track } from './lib/types';

type AircraftTypeFilter = 'all' | 'military' | Track['platformType'];

const trackPollIntervalMs = 30_000;
const vesselPollIntervalMs = 90_000; // AIS store updates ~every 15 min; a slow poll suffices
const timelineSpanMs = 6 * 60 * 60 * 1000; // slider covers the last 6h
const timelineTrailMs = 45 * 60 * 1000;    // trailing window rendered at the cursor (trails)
const timelineStepMs = 3 * 60 * 1000;      // cursor advance per playback tick (small = smooth)

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
  if (last) rows.push(`<div><b>고도/속도</b> ${Math.round(last.altitudeM * 3.28084).toLocaleString()}ft · ${Math.round(last.velocityMs * 1.94384)}kn</div>`);
  // Exclude the airspace axis: with a single ROK FIR context it labels every track "INCHEON(RKRR)
  // 관할" regardless of location (misleading on a global globe), so drop it from the popup.
  const presentAxes = (fusion?.axes ?? []).filter((axis) => axis.present && axis.kind !== 'airspace').slice(0, 3);
  for (const axis of presentAxes) rows.push(`<div><b>${escapeHtml(axis.label)}</b> ${escapeHtml(axis.detail)}</div>`);
  return `<div class="globe-track-popup__body">
    <div class="globe-track-popup__head">${escapeHtml(track.callsign)}${mil ? '<span class="globe-track-popup__mil">군용</span>' : ''}</div>
    ${rows.join('')}
    <div class="globe-track-popup__safe">공개 ADS-B/공개 소스 · 비표적화</div>
  </div>`;
}

function buildShipPopupHtml(ship: ShipTrack): string {
  const last = ship.points.at(-1);
  const rows: string[] = [];
  rows.push(`<div><b>유형</b> ${escapeHtml(vesselTypeLabel(ship.vesselType))}</div>`);
  if (ship.mmsi) rows.push(`<div><b>MMSI</b> ${escapeHtml(ship.mmsi)}</div>`);
  if (last) rows.push(`<div><b>속도/침로</b> ${last.speedKnots}kn · ${Math.round(last.courseDeg)}°</div>`);
  return `<div class="globe-track-popup__body">
    <div class="globe-track-popup__head">${escapeHtml(ship.name)}<span class="globe-track-popup__mil globe-track-popup__ais">AIS</span></div>
    ${rows.join('')}
    <div class="globe-track-popup__safe">공개 AIS · 비표적화</div>
  </div>`;
}

// Satellites are only rendered/listed once zoomed into a detail view (like airspace) — the full
// catalogue is far too dense to read at a global zoom. Below this zoom the layer stays empty.
const SATELLITE_MIN_ZOOM = 4;

// Keep only satellites within the current viewport, and only past the detail zoom. Shared by the
// live and timeline satellite views so markers, the panel list, and popups always agree.
function passesInViewport(passes: SatellitePass[], viewport: Viewport | null): SatellitePass[] {
  if (!viewport || viewport.zoom < SATELLITE_MIN_ZOOM) return [];
  const [minLon, minLat, maxLon, maxLat] = viewport.bbox;
  return passes.filter((s) => s.lon >= minLon && s.lon <= maxLon && s.lat >= minLat && s.lat <= maxLat);
}

const SATELLITE_ROLE_LABEL: Record<SatellitePass['roleHint'], string> = {
  communications: '통신',
  weather: '기상',
  'earth observation': '지구관측',
  'public orbital awareness': '궤도인식',
};

function buildSatellitePopupHtml(sat: SatellitePass): string {
  const rows: string[] = [];
  rows.push(`<div><b>분류</b> ${escapeHtml(SATELLITE_ROLE_LABEL[sat.roleHint])} (이름 기반 추정)</div>`);
  if (sat.noradId) rows.push(`<div><b>NORAD</b> ${escapeHtml(sat.noradId)}</div>`);
  rows.push(`<div><b>고도</b> ${sat.altitudeKm.toLocaleString()}km · ${escapeHtml(sat.direction)}</div>`);
  return `<div class="globe-track-popup__body">
    <div class="globe-track-popup__head">${escapeHtml(sat.name)}<span class="globe-track-popup__mil globe-track-popup__sat">위성</span></div>
    ${rows.join('')}
    <div class="globe-track-popup__safe">공개 TLE·SGP4 계산 위치 · 비표적화</div>
  </div>`;
}

function App() {
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [viewportTracks, setViewportTracks] = useState<Track[]>([]);
  const [liveVessels, setLiveVessels] = useState<ShipTrack[]>([]);
  const [viewportCountry, setViewportCountry] = useState<string | null>(null);
  const [trackLoadState, setTrackLoadState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [trackLastErrorAt, setTrackLastErrorAt] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | undefined>();
  const [selectedShipId, setSelectedShipId] = useState<string | undefined>();
  const [selectedSatelliteId, setSelectedSatelliteId] = useState<string | undefined>();
  const [operatorDb, setOperatorDb] = useState<OperatorDb | null>(null);
  const [liveCache, setLiveCache] = useState<LiveScenarioCache | null>(null);
  const [aircraftTypeFilter, setAircraftTypeFilter] = useState<AircraftTypeFilter>('all');
  const [minimumAltitudeM, setMinimumAltitudeM] = useState(0);
  const [showAirspace, setShowAirspace] = useState(true);
  const [showAirways, setShowAirways] = useState(false);
  const [showOsint, setShowOsint] = useState(true);
  const [showNotam, setShowNotam] = useState(true);
  const [showSeismic, setShowSeismic] = useState(false);
  const [seismicEvents, setSeismicEvents] = useState<SeismicEvent[]>([]);
  const [showAlerts, setShowAlerts] = useState(false);
  const [airAlerts, setAirAlerts] = useState<AirAlert[]>([]);
  const [showSatellites, setShowSatellites] = useState(false);
  const [satellitePasses, setSatellitePasses] = useState<SatellitePass[]>([]);
  const satelliteModelsRef = useRef<SatelliteModel[]>([]);
  const [satModelsLoaded, setSatModelsLoaded] = useState(0);
  const [liveOsint, setLiveOsint] = useState<OsintMapEvent[]>([]);
  const [liveNotam, setLiveNotam] = useState<AirspaceNotice[]>([]);
  const [telegramPosts, setTelegramPosts] = useState<TelegramPost[]>([]);
  const [liveFirms, setLiveFirms] = useState<ThermalAnomaly[]>([]);
  const [timelineMode, setTimelineMode] = useState(false);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [timelineValue, setTimelineValue] = useState(() => Date.now());
  const [timelineNow, setTimelineNow] = useState(() => Date.now());
  const [historyTracks, setHistoryTracks] = useState<Track[]>([]);
  const [historyVessels, setHistoryVessels] = useState<ShipTrack[]>([]);
  const viewportRef = useRef<Viewport | null>(null);

  const regionId = useMemo<RegionId>(() => (viewport ? nearestRegionId(viewport.center) : defaultRegionId), [viewport]);
  const baseScenario = useMemo(() => getScenario(regionId), [regionId]);

  // Timeline playback: the full 6h history is fetched once; each cursor position renders only
  // the trailing window of points up to the cursor, so aircraft/ships glide instead of the old
  // 30-min windows that jumped (making tracks flash in and out).
  const displayedHistoryTracks = useMemo(() => {
    if (!timelineMode) return [];
    const from = timelineValue - timelineTrailMs;
    const bbox = viewport?.bbox;
    const inBox = (lon: number, lat: number) => !bbox || (lon >= bbox[0] && lon <= bbox[2] && lat >= bbox[1] && lat <= bbox[3]);
    return historyTracks
      .map((t) => ({ ...t, points: t.points.filter((p) => { const ms = Date.parse(p.observedAt); return ms >= from && ms <= timelineValue && inBox(p.lon, p.lat); }) }))
      .filter((t) => t.points.length > 0);
  }, [historyTracks, timelineMode, timelineValue, viewport]);
  const displayedHistoryVessels = useMemo(() => {
    if (!timelineMode) return [];
    const from = timelineValue - timelineTrailMs;
    return historyVessels
      .map((s) => ({ ...s, points: s.points.filter((p) => { const ms = Date.parse(p.observedAt); return ms >= from && ms <= timelineValue; }) }))
      .filter((s) => s.points.length > 0);
  }, [historyVessels, timelineMode, timelineValue]);

  const sourceTracks = timelineMode ? displayedHistoryTracks : viewportTracks;
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
    // Live AIS vessels (viewport-polled from Neon) replace the baseline snapshot ships.
    const ships = timelineMode ? displayedHistoryVessels : (liveVessels.length ? liveVessels : withLive.ships);
    const withFusion = { ...withLive, fusionEvents, ships };
    return { ...withFusion, timeline: buildTimelineFromScenario(withFusion) };
  }, [anomalies, displayedHistoryVessels, liveNotam, liveOsint, liveVessels, mergedScenario, showNotam, showOsint, timelineMode]);

  // Live NASA FIRMS around the actual geolocated claim regions (Middle East / Ukraine), which the
  // static AOI thermal cache doesn't cover. Fetched server-side (/api/firms) and merged below so
  // genuine strikes get thermal corroboration and can legitimately score higher than cross-source.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function' || telegramPosts.length === 0) return undefined;
    const seen = new Set<string>();
    const places: string[] = [];
    for (const post of telegramPosts) {
      const g = geolocate(post.text);
      if (!g) continue;
      const key = `${g.lat.toFixed(1)},${g.lon.toFixed(1)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      places.push(key);
      if (places.length >= 12) break;
    }
    if (places.length === 0) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/firms?places=${encodeURIComponent(places.join(';'))}&days=3`, { signal: controller.signal });
        if (!res.ok) return;
        const payload = await res.json() as { ok: boolean; thermals?: Array<{ id: string; lat: number; lon: number; observedAt: string; frpMw?: number; brightnessKelvin?: number; confidence?: number }> };
        if (cancelled || !payload.ok || !payload.thermals) return;
        setLiveFirms(payload.thermals.map((t) => ({
          id: t.id, regionId: 'global' as RegionId, source: 'nasa-firms-live', provider: 'NASA FIRMS',
          lat: t.lat, lon: t.lon, observedAt: t.observedAt, frpMw: t.frpMw, brightnessKelvin: t.brightnessKelvin, confidence: t.confidence,
        })));
      } catch { /* best-effort: reliability falls back to cross-source only */ }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [telegramPosts]);

  // Reliability scoring: assess Telegram claims against thermal (FIRMS live + cached) + cross-source.
  const assessedClaims = useMemo<AssessedClaim[]>(
    () => assessClaims(telegramPosts, [...(scenario.thermalAnomalies ?? []), ...liveFirms], Date.now()),
    [telegramPosts, scenario.thermalAnomalies, liveFirms],
  );

  // Region view: show only the verification claims inside the current viewport (pan to a
  // theatre → its claims). Zoomed out globally, the bbox covers everything so all show.
  const regionalClaims = useMemo(() => {
    if (!viewport) return assessedClaims;
    const [minLon, minLat, maxLon, maxLat] = viewport.bbox;
    return assessedClaims.filter((c) => c.lon >= minLon && c.lon <= maxLon && c.lat >= minLat && c.lat <= maxLat);
  }, [assessedClaims, viewport]);

  // Explosion-like filter: shallow (≤2 km) near-surface seismic events only.
  const explosionEvents = useMemo(() => seismicEvents.filter((e) => e.explosionLike), [seismicEvents]);

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

  const selectedShip = useMemo(() => scenario.ships.find((s) => s.id === selectedShipId), [scenario.ships, selectedShipId]);

  // Satellites shown/listed = viewport-filtered (bbox) and only past the detail zoom, mirroring
  // airspace. The panel list and globe markers share this subset so they always agree.
  const viewportSatellites = useMemo(
    () => (showSatellites ? passesInViewport(satellitePasses, viewport) : []),
    [showSatellites, satellitePasses, viewport],
  );

  // Timeline satellites: SGP4 needs no stored history — propagate the loaded element sets to the
  // scrubber's cursor time, then viewport-filter like the live view. Gated on zoom (the memo
  // returns early before propagating when zoomed out). satModelsLoaded re-runs it once the
  // catalogue has finished loading even while the cursor is paused.
  const timelineSatellites = useMemo(() => {
    if (!timelineMode || !showSatellites || !viewport || viewport.zoom < SATELLITE_MIN_ZOOM) return [];
    return passesInViewport(propagateSatellites(satelliteModelsRef.current, new Date(timelineValue)), viewport);
  }, [timelineMode, showSatellites, timelineValue, viewport, satModelsLoaded]);

  const activeSatellites = timelineMode ? timelineSatellites : viewportSatellites;

  const selectedSatellite = useMemo(() => activeSatellites.find((s) => s.id === selectedSatelliteId), [activeSatellites, selectedSatelliteId]);

  const focusTrack = useMemo(() => {
    const shipLast = selectedShip?.points.at(-1);
    if (selectedShip && shipLast) {
      return { id: selectedShip.id, lat: shipLast.lat, lon: shipLast.lon, html: buildShipPopupHtml(selectedShip) };
    }
    if (selectedSatellite) {
      return { id: selectedSatellite.id, lat: selectedSatellite.lat, lon: selectedSatellite.lon, html: buildSatellitePopupHtml(selectedSatellite) };
    }
    const last = selectedTrack?.points.at(-1);
    if (!selectedTrack || !last) return null;
    return { id: selectedTrack.id, lat: last.lat, lon: last.lon, html: buildTrackPopupHtml(selectedTrack, aircraftIdentity, fusionContext) };
  }, [aircraftIdentity, fusionContext, selectedShip, selectedSatellite, selectedTrack]);

  const militaryCount = useMemo(() => scenario.tracks.filter((t) => t.isMilitary).length, [scenario.tracks]);

  // Compact fused-situation snapshot handed to the OpenAI copilot (summary + anomaly analysis).
  const copilotContext = useMemo(() => ({
    region: viewportCountry ?? scenario.region.shortName,
    tracks: {
      total: scenario.tracks.length,
      military: militaryCount,
      sample: scenario.tracks.slice(0, 20).map((t) => {
        const p = t.points.at(-1);
        return { callsign: t.callsign, type: t.platformType, military: t.isMilitary, altM: p?.altitudeM, spdMs: p?.velocityMs, hdg: p?.headingDeg, lat: p ? Number(p.lat.toFixed(2)) : undefined, lon: p ? Number(p.lon.toFixed(2)) : undefined };
      }),
    },
    ships: {
      total: scenario.ships.length,
      sample: scenario.ships.slice(0, 15).map((s) => {
        const p = s.points.at(-1);
        return { name: s.name, type: s.vesselType, lat: p ? Number(p.lat.toFixed(2)) : undefined, lon: p ? Number(p.lon.toFixed(2)) : undefined };
      }),
    },
    osint: scenario.osintEvents.slice(0, 15).map((e) => e.title),
    telegramClaims: regionalClaims.slice(0, 15).map((c) => ({ place: c.place, verdict: c.verdict, confidence: c.confidence, channel: c.channel })),
    anomalies: anomalies.map((a) => ({ type: a.type, severity: a.severity, title: a.title, description: a.description, tracks: a.relatedTrackIds })),
    notamCount: scenario.notices.length,
  }), [anomalies, regionalClaims, militaryCount, scenario, viewportCountry]);

  const handleSelectTrack = useCallback((trackId: string) => {
    setSelectedShipId(undefined);
    setSelectedSatelliteId(undefined);
    setSelectedTrackId((current) => (current === trackId ? undefined : trackId));
  }, []);
  const handleSelectShip = useCallback((shipId: string) => {
    setSelectedTrackId(undefined);
    setSelectedSatelliteId(undefined);
    setSelectedShipId((current) => (current === shipId ? undefined : shipId));
  }, []);
  const handleSelectSatellite = useCallback((satId: string) => {
    setSelectedTrackId(undefined);
    setSelectedShipId(undefined);
    setSelectedSatelliteId((current) => (current === satId ? undefined : satId));
  }, []);
  const handleFocusClose = useCallback(() => {
    setSelectedTrackId(undefined);
    setSelectedShipId(undefined);
    setSelectedSatelliteId(undefined);
  }, []);
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

  // Viewport-driven AIS vessel poll (Neon /api/history?kind=vessels). Vessels update only
  // ~every 15 min in the store, so a slow poll suffices; each fetch pulls a trailing window
  // aggregated into per-MMSI trails (항적). Frozen while scrubbing the timeline.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function' || timelineMode) return undefined;
    let cancelled = false;
    let controller = new AbortController();
    const load = async () => {
      controller = new AbortController();
      const v = viewportRef.current;
      const now = Date.now();
      const vessels = await fetchVesselTracks({
        bbox: v?.bbox,
        from: new Date(now - timelineSpanMs).toISOString(),
        to: new Date(now).toISOString(),
        limit: 4000,
        signal: controller.signal,
      });
      if (!cancelled) setLiveVessels(vessels);
    };
    void load();
    const timer = window.setInterval(() => void load(), vesselPollIntervalMs);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); };
  }, [timelineMode, viewport]);

  // Reverse-geocode the viewport centre to a country name (BigDataCloud keyless client API),
  // debounced, so the panel reads "<현재 보고 있는 나라> 상공" instead of a fixed AOI label.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function' || !viewport) return undefined;
    const [lat, lon] = viewport.center;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&localityLanguage=ko`,
            { signal: controller.signal },
          );
          if (!res.ok) return;
          const data = await res.json() as { countryName?: string; locality?: string };
          // countryName over land; locality carries the sea/body-of-water name over open
          // water (e.g. "황해", "남중국해", "대한해협"). Only overwrite when a place actually
          // resolved, so panning over a blank patch never regresses the label.
          const place = data.countryName?.trim() || data.locality?.trim();
          if (place) setViewportCountry(place);
        } catch {
          // keep the previous value on failure / open ocean
        }
      })();
    }, 700);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [viewport]);

  // Timeline: fetch the FULL span of history (tracks + vessels) ONCE on entering timeline mode
  // (or region change). The cursor then animates over this cache client-side — no per-frame
  // refetch, so nothing flashes in and out.
  useEffect(() => {
    if (!timelineMode || typeof window === 'undefined') return undefined;
    let cancelled = false;
    const controller = new AbortController();
    const now = Date.now();
    const from = new Date(now - timelineSpanMs).toISOString();
    const to = new Date(now).toISOString();
    void (async () => {
      // Fetch all regions (stored rows are tagged with specific sub-regions like 'seoul-airspace')
      // and viewport-filter client-side — matching how vessels are scoped, so both agree with the
      // current view instead of a single derived regionId that usually excludes the stored tracks.
      const [rows, vessels] = await Promise.all([
        fetchHistoryTracks({ from, to, limit: 6000, signal: controller.signal }),
        fetchVesselTracks({ bbox: viewportRef.current?.bbox, from, to, limit: 6000, signal: controller.signal }),
      ]);
      if (cancelled) return;
      setHistoryTracks(buildHistoryTracks(rows));
      setHistoryVessels(vessels);
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [timelineMode]);

  // Timeline auto-play — advance the cursor in small steps for smooth motion; loop at the end.
  useEffect(() => {
    if (!timelineMode || !timelinePlaying) return undefined;
    const timer = window.setInterval(() => {
      setTimelineValue((v) => {
        const next = v + timelineStepMs;
        return next > timelineNow ? timelineNow - timelineSpanMs + timelineTrailMs : next;
      });
    }, 400);
    return () => window.clearInterval(timer);
  }, [timelineMode, timelinePlaying, timelineNow]);

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

  // Telegram OSINT feed (public t.me channels via /api/telegram), refreshed periodically.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function') return undefined;
    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      const posts = await fetchTelegramPosts(controller.signal);
      if (!cancelled) setTelegramPosts(posts);
    };
    void load();
    const timer = window.setInterval(() => void load(), 3 * 60 * 1000);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); };
  }, []);

  // EMSC seismic (viewport bbox), only while the 지진 layer is on. Explosion-like = shallow.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function' || !showSeismic) return undefined;
    let cancelled = false;
    let controller = new AbortController();
    const load = async () => {
      controller = new AbortController();
      const events = await fetchSeismic(viewportRef.current?.bbox, 24, controller.signal);
      if (!cancelled) setSeismicEvents(events);
    };
    void load();
    const timer = window.setInterval(() => void load(), 5 * 60 * 1000);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); };
  }, [showSeismic, viewport]);

  // Ukrainian air-raid alerts (@air_alert_ua) — active-alert oblasts, refreshed while the layer is
  // on. Global (not viewport-scoped) since alerts are oblast-level and flip quickly.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function' || !showAlerts) return undefined;
    let cancelled = false;
    let controller = new AbortController();
    const load = async () => {
      controller = new AbortController();
      const alerts = await fetchAirAlerts(controller.signal);
      if (!cancelled) setAirAlerts(alerts);
    };
    void load();
    const timer = window.setInterval(() => void load(), 2 * 60 * 1000);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); };
  }, [showAlerts]);

  // Live satellites: fetch the public Celestrak catalogue (TLEs) once, then re-propagate every
  // few seconds with SGP4 on the client. Bulk view (~11k active objects incl. Starlink) — markers
  // only (no per-satellite ground tracks/labels) to stay renderable. Gated on the 위성 toggle.
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.fetch !== 'function' || !showSatellites) return undefined;
    let cancelled = false;
    const controller = new AbortController();
    let timer = 0;
    const tick = () => {
      if (!cancelled) setSatellitePasses(propagateSatellites(satelliteModelsRef.current, new Date()));
    };
    const start = async () => {
      if (satelliteModelsRef.current.length === 0) {
        const models = await fetchSatelliteModels('active', controller.signal);
        if (cancelled) return;
        satelliteModelsRef.current = models;
        setSatModelsLoaded((n) => n + 1);
      }
      tick();
      timer = window.setInterval(tick, 3000);
    };
    void start();
    return () => { cancelled = true; controller.abort(); if (timer) window.clearInterval(timer); };
  }, [showSatellites]);

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
          satellites={activeSatellites}
          airports={[]}
          airRoutes={[]}
          notices={scenario.notices}
          airspaceContexts={[]}
          osintEvents={scenario.osintEvents}
          claims={showOsint ? regionalClaims : []}
          seismic={showSeismic ? explosionEvents : []}
          airAlerts={showAlerts ? airAlerts : []}
          anomalies={anomalies}
          onViewportChange={handleViewportChange}
          focusTrack={focusTrack}
          onFocusClose={handleFocusClose}
          onSelectTrack={handleSelectTrack}
          onSelectShip={handleSelectShip}
          showAirspace={showAirspace}
          showAirways={showAirways}
        />
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
        <button type="button" className={showAirways ? 'is-active' : ''} onClick={() => setShowAirways((s) => !s)} title="ROK 항공로 (국토교통부 항공교통본부, data.go.kr) · 줌인 시 표시">
          항로 {showAirways ? 'ON' : 'OFF'}
        </button>
        <button type="button" className={showOsint ? 'is-active' : ''} onClick={() => setShowOsint((s) => !s)}>
          OSINT {showOsint ? 'ON' : 'OFF'}
        </button>
        <button type="button" className={showSeismic ? 'is-active' : ''} onClick={() => setShowSeismic((s) => !s)} title="EMSC 얕은 진원(≤2km) 지진 = 폭발/타격 가능">
          폭발형 {showSeismic ? 'ON' : 'OFF'}
        </button>
        <button type="button" className={showAlerts ? 'is-active' : ''} onClick={() => setShowAlerts((s) => !s)} title="우크라이나 공습경보 (@air_alert_ua) · 오블라스트 단위 활성 경보">
          경보 {showAlerts ? `ON · ${airAlerts.length}` : 'OFF'}
        </button>
        <button type="button" className={showSatellites ? 'is-active' : ''} onClick={() => setShowSatellites((s) => !s)} title="Celestrak TLE + SGP4 실시간 궤도 위치 (활성 위성 전체, Starlink 포함) · 줌인 시 화면 영역만 표시">
          위성 {showSatellites ? (satellitePasses.length ? `ON · 화면 ${activeSatellites.length}` : 'ON · 로딩') : 'OFF'}
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
          <span className="globe-hud--legend__note">남한 KADIZ·P-73: ROK AIP · 그 외: OpenAIP</span>
        </div>
      ) : null}

      <aside className="globe-hud globe-hud--panel">
        <LiveTrackPanel
          regionName={viewportCountry ? `${viewportCountry} 상공` : '글로벌'}
          tracks={scenario.tracks}
          selectedTrackId={selectedTrackId}
          onSelectTrack={handleSelectTrack}
          fusionContext={fusionContext}
          fusionEvents={scenario.fusionEvents}
          timeline={scenario.timeline}
          militaryCount={militaryCount}
          identity={aircraftIdentity}
          activeAirspace={activeAirspace}
          ships={scenario.ships}
          selectedShipId={selectedShipId}
          onSelectShip={handleSelectShip}
          satellites={activeSatellites}
          selectedSatelliteId={selectedSatelliteId}
          onSelectSatellite={handleSelectSatellite}
          satellitesEnabled={showSatellites}
          claims={regionalClaims}
          copilotContext={copilotContext}
        />
      </aside>

      {timelineMode ? (
        <div className="globe-hud globe-hud--timeline">
          <TimelineControls
            min={timelineNow - timelineSpanMs}
            max={timelineNow}
            value={timelineValue}
            playing={timelinePlaying}
            label={`${new Date(timelineValue).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · 항적 ${displayedHistoryTracks.length} · 선박 ${displayedHistoryVessels.length} · 위성 ${activeSatellites.length}`}
            onChange={(v) => setTimelineValue(v)}
            onTogglePlay={() => setTimelinePlaying((p) => !p)}
          />
        </div>
      ) : null}
    </main>
  );
}

export default App;
