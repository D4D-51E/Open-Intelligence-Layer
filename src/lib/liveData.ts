import type {
  AirportContext,
  AirspaceContext,
  AirRoute,
  FusionEvent,
  AirspaceNotice,
  LiveSourceStatus,
  OsintItem,
  OsintMapEvent,
  RegionId,
  SatellitePass,
  SatelliteScene,
  Scenario,
  ShipTrack,
  ThermalAnomaly,
  TimelineEvent,
  Track,
  WeatherSnapshot,
} from './types';
import { platformTypeLabel, roleHintLabel, vesselTypeLabel } from './display';

export type LiveRegionPayload = {
  tracks?: Track[];
  ships?: ShipTrack[];
  weather?: WeatherSnapshot | null;
  osint?: OsintItem[];
  osintEvents?: OsintMapEvent[];
  satellites?: SatellitePass[];
  satelliteScenes?: SatelliteScene[];
  thermalAnomalies?: ThermalAnomaly[];
  airports?: AirportContext[];
  airRoutes?: AirRoute[];
  notices?: AirspaceNotice[];
  airspaceContexts?: AirspaceContext[];
  fusionEvents?: FusionEvent[];
  sourceStatus?: Record<string, LiveSourceStatus>;
  sourceReasons?: Record<string, string>;
  sourceUpdatedAt?: Record<string, string>;
};

export type LiveScenarioCache = {
  schemaVersion: 1;
  generatedAt: string;
  mode: 'public-live-cache';
  refreshPolicy?: {
    browserPollMs?: number;
    recommendedFetchLoopMs?: number;
    openSkyMinFetchIntervalMs?: number;
    openSkyMaxTracksPerRegion?: number;
    copernicusStacMinFetchIntervalMs?: number;
    copernicusStacMaxScenesPerRegion?: number;
    copernicusStacLookbackHours?: number;
    nasaFirmsCacheTtlMs?: number;
    nasaFirmsDayRange?: number;
    nasaFirmsMaxRecordsPerRegion?: number;
    aisStreamFetchMs?: number;
    aisStreamMaxShipsPerRegion?: number;
    aisStreamCacheTtlMs?: number;
    gdeltBackoffMs?: number;
    icaoFirMinFetchIntervalMs?: number;
  };
  note: string;
  regions: Partial<Record<RegionId, LiveRegionPayload>>;
  rateLimitState?: Record<string, { retryAfterUntil?: string }>;
  errors?: string[];
};

export function mergeLiveScenario(base: Scenario, live: LiveRegionPayload | undefined): Scenario {
  if (!live) return {
    ...base,
    timeline: buildTimelineFromScenario(base),
  };
  const merged: Scenario = {
    ...base,
    tracks: live.tracks ?? [],
    ships: live.ships ?? [],
    weather: live.weather ?? null,
    osint: live.osint ?? [],
    osintEvents: live.osintEvents ?? [],
    satellites: live.satellites ?? [],
    satelliteScenes: live.satelliteScenes ?? [],
    thermalAnomalies: live.thermalAnomalies ?? [],
    airports: live.airports ?? [],
    airRoutes: live.airRoutes ?? [],
    notices: live.notices ?? [],
    airspaceContexts: live.airspaceContexts ?? [],
    fusionEvents: live.fusionEvents ?? [],
    sourceStatus: live.sourceStatus,
    sourceReasons: live.sourceReasons,
    sourceUpdatedAt: live.sourceUpdatedAt,
  };
  return {
    ...merged,
    timeline: buildTimelineFromScenario(merged),
  };
}

export function buildTimelineFromScenario(scenario: Scenario): TimelineEvent[] {
  const contextTime = scenario.weather?.observedAt ?? new Date().toISOString();
  return [
    ...scenario.osint.map((item) => ({
      id: `tl-${item.id}`,
      regionId: scenario.region.id,
      time: item.publishedAt,
      type: 'osint' as const,
      title: item.title,
      description: item.summary,
      severity: item.confidence > 0.75 ? 'watch' as const : 'info' as const,
      relatedIds: [item.id],
    })),
    ...scenario.osintEvents.map((event) => ({
      id: `tl-${event.id}`,
      regionId: scenario.region.id,
      time: event.observedAt,
      type: 'osint-event' as const,
      title: event.title,
      description: `${event.domain ?? event.source} · 지도 이벤트 · 신뢰도 ${Math.round(event.confidence * 100)}%`,
      severity: event.confidence > 0.75 ? 'watch' as const : 'info' as const,
      relatedIds: [event.relatedOsintId],
    })),
    ...(scenario.weather ? [{
      id: `tl-${scenario.weather.id}`,
      regionId: scenario.region.id,
      time: scenario.weather.observedAt,
      type: 'weather' as const,
      title: '기상 위험 스냅샷 업데이트',
      description: `운량 ${scenario.weather.cloudCoverPct}%, 가시거리 ${scenario.weather.visibilityM.toLocaleString()}m, 돌풍 ${scenario.weather.windGustKmh}km/h.`,
      severity: scenario.weather.visibilityM < 6000 || scenario.weather.precipitationMm > 0 ? 'watch' as const : 'info' as const,
      relatedIds: [scenario.weather.id],
    }] : []),
    ...scenario.satellites.map((sat) => ({
      id: `tl-${sat.id}`,
      regionId: scenario.region.id,
      time: sat.observedAt,
      type: 'satellite' as const,
      title: `${sat.name} 공개 궤도 레이어`,
      description: `${roleHintLabel(sat.roleHint)} · 방향 ${sat.direction} · 표적화에는 사용하지 않음.`,
      severity: 'info' as const,
      relatedIds: [sat.id],
    })),
    ...(scenario.satelliteScenes ?? []).map((scene) => ({
      id: `tl-${scene.id}`,
      regionId: scenario.region.id,
      time: scene.observedAt,
      type: 'satellite-scene' as const,
      title: `${scene.provider} 장면 메타데이터`,
      description: `${scene.platform}${scene.cloudCoverPct == null ? '' : ` · 운량 ${scene.cloudCoverPct}%`} · ${scene.summary}`,
      severity: scene.cloudCoverPct != null && scene.cloudCoverPct > 65 ? 'watch' as const : 'info' as const,
      relatedIds: [scene.id],
    })),
    ...(scenario.thermalAnomalies ?? []).map((item) => ({
      id: `tl-${item.id}`,
      regionId: scenario.region.id,
      time: item.observedAt,
      type: 'thermal' as const,
      title: 'NASA FIRMS 열 이상 후보',
      description: `${item.satellite ?? 'VIIRS/MODIS'} · FRP ${item.frpMw ?? '-'}MW · 공개 열 이상은 폭발/화재의 보조 신호일 뿐 단독 확증이 아닙니다.`,
      severity: item.frpMw != null && item.frpMw > 80 ? 'watch' as const : 'info' as const,
      relatedIds: [item.id],
    })),
    ...scenario.airports.map((airport) => ({
      id: `tl-${airport.id}`,
      regionId: scenario.region.id,
      time: contextTime,
      type: 'airport' as const,
      title: `${airport.ident} ${airport.name}`,
      description: `${airport.type} · ${airport.municipality ?? airport.isoCountry ?? '위치 맥락'} · 공항 참고 레이어`,
      severity: 'info' as const,
      relatedIds: [airport.id],
    })),
    ...scenario.airRoutes.map((route) => ({
      id: `tl-${route.id}`,
      regionId: scenario.region.id,
      time: contextTime,
      type: 'route' as const,
      title: route.name,
      description: route.description,
      severity: 'info' as const,
      relatedIds: [route.id],
    })),
    ...scenario.notices.map((notice) => ({
      id: `tl-${notice.id}`,
      regionId: scenario.region.id,
      time: notice.publishedAt,
      type: 'notice' as const,
      title: notice.title,
      description: notice.description,
      severity: notice.severity,
      relatedIds: [notice.id],
    })),
    ...scenario.airspaceContexts.map((context) => ({
      id: `tl-${context.id}`,
      regionId: scenario.region.id,
      time: context.observedAt,
      type: 'airspace' as const,
      title: `${context.icaoCode} ${context.firName} FIR`,
      description: `${context.state ?? 'State unknown'} · ${context.icaoRegion ?? 'ICAO region unknown'} · ${context.type ?? 'FIR'} · AOI 중심점 기준`,
      severity: 'info' as const,
      relatedIds: [context.id],
    })),
    ...scenario.fusionEvents.map((event) => ({
      id: `tl-${event.id}`,
      regionId: scenario.region.id,
      time: event.createdAt,
      type: 'fusion' as const,
      title: event.title,
      description: `${event.summary} · 신뢰도 ${Math.round(event.confidence * 100)}%`,
      severity: event.severity,
      relatedIds: event.relatedIds,
    })),
    ...scenario.ships.filter((ship) => ship.points.length > 0).map((ship) => {
      const last = ship.points[ship.points.length - 1];
      return {
        id: `tl-${ship.id}`,
        regionId: scenario.region.id,
        time: last.observedAt,
        type: 'ship' as const,
        title: `${ship.name} AIS 위치`,
        description: `${vesselTypeLabel(ship.vesselType)} · 속도 ${last.speedKnots}kt · 침로 ${last.courseDeg}°`,
        severity: ship.vesselType === 'unknown' ? 'watch' as const : 'info' as const,
        relatedIds: [ship.id],
      };
    }),
    ...scenario.tracks.filter((track) => track.points.length > 0).map((track) => {
      const last = track.points[track.points.length - 1];
      return {
        id: `tl-${track.id}`,
        regionId: scenario.region.id,
        time: last.observedAt,
        type: 'track' as const,
        title: `${track.callsign} 최신 공개 상태`,
        description: `${platformTypeLabel(track.platformType)} 항적 · 고도 ${last.altitudeM.toLocaleString()}m · 방위 ${last.headingDeg}°`,
        severity: track.platformType === 'unknown' ? 'watch' as const : 'info' as const,
        relatedIds: [track.id],
      };
    }),
  ].sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
}
