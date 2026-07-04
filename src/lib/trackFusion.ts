import type { Anomaly, Citation, Scenario, Track, TrackPoint } from './types';

export type TrackFusionAxis =
  | { kind: 'weather'; present: boolean; label: string; detail: string; citation?: Citation }
  | { kind: 'satellite'; present: boolean; label: string; detail: string; citation?: Citation }
  | { kind: 'airspace'; present: boolean; label: string; detail: string; citation?: Citation }
  | { kind: 'osint'; present: boolean; label: string; detail: string; citation?: Citation }
  | { kind: 'anomaly'; present: boolean; label: string; detail: string; citation?: Citation };

export type TrackFusionContext = {
  trackId: string;
  callsign: string;
  axes: TrackFusionAxis[];
  citations: Citation[];
  gaps: string[];
};

const SAT_NEAR_NM = 400;
const FUSION_WINDOW_MIN = 90;
const OSINT_NEAR_NM = 120;
const WEATHER_VISIBILITY_LOW_M = 6000;
const WEATHER_CLOUD_HIGH_PCT = 75;
const EARTH_RADIUS_NM = 3440.065;
const NM_PER_KM = 0.539957;

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}

function haversineNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = degToRad(bLat - aLat);
  const dLon = degToRad(bLon - aLon);
  const lat1 = degToRad(aLat);
  const lat2 = degToRad(bLat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_NM * c;
}

function minutesBetween(aIso: string, bIso: string): number {
  return Math.abs(new Date(aIso).getTime() - new Date(bIso).getTime()) / 60_000;
}

function pointInBbox(lat: number, lon: number, bbox: [number, number, number, number]): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

function citation(id: string, label: string, source: string, confidence: number, url?: string, observedAt?: string): Citation {
  return { id, label, source, confidence, url, observedAt };
}

function latestPoint(track: Track): TrackPoint | undefined {
  return track.points[track.points.length - 1];
}

function buildWeatherAxis(scenario: Scenario): TrackFusionAxis {
  const weather = scenario.weather;
  if (!weather) {
    return { kind: 'weather', present: false, label: '기상', detail: '해당 지역 기상 스냅샷 없음' };
  }
  const visibilityLow = weather.visibilityM < WEATHER_VISIBILITY_LOW_M;
  const cloudHigh = weather.cloudCoverPct > WEATHER_CLOUD_HIGH_PCT;
  const observability = visibilityLow || cloudHigh ? '관측 제약 가능' : '관측 양호';
  const detail = `운량 ${weather.cloudCoverPct}%, 가시거리 ${weather.visibilityM.toLocaleString()}m, 돌풍 ${weather.windGustKmh}km/h — ${observability}`;
  return {
    kind: 'weather',
    present: true,
    label: '기상',
    detail,
    citation: citation(`wx-${weather.id}`, '지역 기상 스냅샷', weather.source, 0.8, undefined, weather.observedAt),
  };
}

function buildSatelliteAxis(point: TrackPoint | undefined, scenario: Scenario): TrackFusionAxis {
  if (!point) {
    return { kind: 'satellite', present: false, label: '위성', detail: '항적 위치 없음' };
  }
  const nearPass = scenario.satellites
    .map((pass) => ({
      pass,
      distanceNm: haversineNm(point.lat, point.lon, pass.lat, pass.lon),
      minutes: minutesBetween(point.observedAt, pass.observedAt),
    }))
    .filter((entry) => entry.distanceNm <= SAT_NEAR_NM && entry.minutes <= FUSION_WINDOW_MIN)
    .sort((a, b) => a.distanceNm - b.distanceNm)[0];

  const matchedScene = (scenario.satelliteScenes ?? []).find((scene) => scene.bbox && pointInBbox(point.lat, point.lon, scene.bbox));

  if (!nearPass && !matchedScene) {
    return {
      kind: 'satellite',
      present: false,
      label: '위성',
      detail: `${SAT_NEAR_NM}nm/${FUSION_WINDOW_MIN}분 이내 위성 패스·영상 커버리지 없음`,
    };
  }

  const passText = nearPass
    ? `${nearPass.pass.name} 패스 (거리 ${nearPass.distanceNm.toFixed(0)}nm, Δt ${nearPass.minutes.toFixed(0)}분)`
    : null;
  const sceneText = matchedScene ? `${matchedScene.provider} 영상 커버리지 포함` : null;
  const detail = [passText, sceneText].filter((text): text is string => Boolean(text)).join(' · ');

  const chosenCitation = nearPass
    ? citation(`sat-${nearPass.pass.id}`, nearPass.pass.name, nearPass.pass.source, 0.7, undefined, nearPass.pass.observedAt)
    : citation(`scene-${matchedScene!.id}`, matchedScene!.provider, matchedScene!.source, 0.7, matchedScene!.url, matchedScene!.observedAt);

  return { kind: 'satellite', present: true, label: '위성', detail, citation: chosenCitation };
}

function buildAirspaceAxis(point: TrackPoint | undefined, scenario: Scenario): TrackFusionAxis {
  if (!point) {
    return { kind: 'airspace', present: false, label: '공역', detail: '항적 위치 없음' };
  }
  const nearestFir = scenario.airspaceContexts
    .map((fir) => ({ fir, distanceNm: haversineNm(point.lat, point.lon, fir.lat, fir.lon) }))
    .sort((a, b) => a.distanceNm - b.distanceNm)[0];

  if (!nearestFir) {
    return { kind: 'airspace', present: false, label: '공역', detail: '관할 FIR 데이터 없음' };
  }

  const nearbyNotices = scenario.notices.filter(
    (notice) => haversineNm(point.lat, point.lon, notice.lat, notice.lon) / NM_PER_KM <= notice.radiusKm,
  );
  const noticeText = nearbyNotices.length > 0 ? `, 반경 내 NOTAM ${nearbyNotices.length}건: ${nearbyNotices[0].title}` : '';
  const detail = `${nearestFir.fir.firName}(${nearestFir.fir.icaoCode}) 관할${noticeText}`;

  return {
    kind: 'airspace',
    present: true,
    label: '공역',
    detail,
    citation: citation(`fir-${nearestFir.fir.id}`, nearestFir.fir.firName, nearestFir.fir.source, 0.72, undefined, nearestFir.fir.observedAt),
  };
}

function buildOsintAxis(point: TrackPoint | undefined, scenario: Scenario): TrackFusionAxis {
  if (!point) {
    return { kind: 'osint', present: false, label: 'OSINT', detail: '항적 위치 없음' };
  }
  const nearbyEvents = scenario.osintEvents
    .map((event) => ({ event, distanceNm: haversineNm(point.lat, point.lon, event.lat, event.lon) }))
    .filter((entry) => entry.distanceNm <= OSINT_NEAR_NM)
    .sort((a, b) => a.distanceNm - b.distanceNm);
  const nearbyItems = scenario.osint.filter((item) => minutesBetween(point.observedAt, item.publishedAt) <= FUSION_WINDOW_MIN);

  if (nearbyEvents.length === 0 && nearbyItems.length === 0) {
    return {
      kind: 'osint',
      present: false,
      label: 'OSINT',
      detail: `${OSINT_NEAR_NM}nm/${FUSION_WINDOW_MIN}분 이내 OSINT 신호 없음`,
    };
  }

  const total = nearbyEvents.length + nearbyItems.length;
  const topTitle = nearbyEvents[0]?.event.title ?? nearbyItems[0]?.title ?? '';
  const detail = `근접/동시간대 OSINT ${total}건 — ${topTitle}`;

  const chosenCitation = nearbyEvents[0]
    ? citation(
        `osint-event-${nearbyEvents[0].event.id}`,
        nearbyEvents[0].event.title,
        nearbyEvents[0].event.source,
        0.65,
        nearbyEvents[0].event.url,
        nearbyEvents[0].event.observedAt,
      )
    : citation(
        `osint-item-${nearbyItems[0].id}`,
        nearbyItems[0].title,
        nearbyItems[0].source,
        nearbyItems[0].confidence,
        nearbyItems[0].url,
        nearbyItems[0].publishedAt,
      );

  return { kind: 'osint', present: true, label: 'OSINT', detail, citation: chosenCitation };
}

function buildAnomalyAxis(track: Track, anomalies: Anomaly[]): TrackFusionAxis {
  const related = anomalies.filter((anomaly) => anomaly.relatedTrackIds.includes(track.id));
  if (related.length === 0) {
    return { kind: 'anomaly', present: false, label: '이상 신호', detail: '연계된 이상 신호 없음' };
  }
  const detail = related.map((anomaly) => anomaly.title).join(' · ');
  const firstCitation = related.find((anomaly) => anomaly.citations.length > 0)?.citations[0];
  return { kind: 'anomaly', present: true, label: '이상 신호', detail, citation: firstCitation };
}

export function buildTrackFusionContext(track: Track, scenario: Scenario, anomalies: Anomaly[]): TrackFusionContext {
  const point = latestPoint(track);
  const axes: TrackFusionAxis[] = [
    buildWeatherAxis(scenario),
    buildSatelliteAxis(point, scenario),
    buildAirspaceAxis(point, scenario),
    buildOsintAxis(point, scenario),
    buildAnomalyAxis(track, anomalies),
  ];

  const citations = axes.reduce<Citation[]>((acc, axis) => {
    if (!axis.citation) return acc;
    if (acc.some((existing) => existing.id === axis.citation!.id)) return acc;
    return [...acc, axis.citation];
  }, []);

  const gaps = axes.filter((axis) => !axis.present).map((axis) => `${axis.label}: ${axis.detail}`);

  return {
    trackId: track.id,
    callsign: track.callsign,
    axes,
    citations,
    gaps,
  };
}
