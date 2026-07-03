import * as turf from '@turf/turf';
import type { Anomaly, Citation, Scenario, Track, TrackPoint, WatchZone } from './types';

function pointFeature(point: TrackPoint) {
  return turf.point([point.lon, point.lat]);
}

function zonePolygon(zone: WatchZone) {
  const ring = zone.polygon.map(([lat, lon]) => [lon, lat]);
  const closed = [...ring, ring[0]];
  return turf.polygon([closed]);
}

function latestPoint(track: Track): TrackPoint {
  return track.points[track.points.length - 1];
}

function tracksWithPoints(scenario: Scenario): Scenario {
  return {
    ...scenario,
    tracks: scenario.tracks.filter((track) => track.points.length > 0),
  };
}

function citation(id: string, label: string, source: string, confidence: number, url?: string, observedAt?: string): Citation {
  return { id, label, source, confidence, url, observedAt };
}

function maxHeadingDelta(track: Track): number {
  let max = 0;
  for (let i = 1; i < track.points.length; i += 1) {
    const prev = track.points[i - 1].headingDeg;
    const curr = track.points[i].headingDeg;
    const raw = Math.abs(curr - prev);
    const delta = Math.min(raw, 360 - raw);
    max = Math.max(max, delta);
  }
  return max;
}

function altitudeDelta(track: Track): number {
  if (track.points.length < 2) return 0;
  return Math.abs(latestPoint(track).altitudeM - track.points[0].altitudeM);
}

function detectZoneApproach(scenario: Scenario): Anomaly[] {
  const anomalies: Anomaly[] = [];
  for (const track of scenario.tracks) {
    const last = latestPoint(track);
    const pt = pointFeature(last);
    for (const zone of scenario.watchZones) {
      const poly = zonePolygon(zone);
      const inside = turf.booleanPointInPolygon(pt, poly);
      const centroid = turf.centroid(poly);
      const distanceKm = turf.distance(pt, centroid, { units: 'kilometers' });
      if (inside || distanceKm < 70) {
        const confidence = inside ? 0.82 : Math.max(0.52, 0.76 - distanceKm / 200);
        anomalies.push({
          id: `an-zone-${track.id}-${zone.id}`,
          type: 'zone_approach',
          severity: inside || zone.severity === 'warning' ? 'warning' : 'watch',
          title: `${track.callsign} · ${zone.name} ${inside ? '진입' : '근접'}`,
          description: `${track.callsign} 최신 위치가 ${zone.name} ${inside ? '경계 안쪽' : `중심 약 ${distanceKm.toFixed(0)}km`}으로 계산되었습니다.`,
          confidence,
          relatedTrackIds: [track.id],
          relatedOsintIds: [],
          citations: [
            citation(`track-${track.id}`, `${track.callsign} 최신 상태`, track.source, 0.78, undefined, last.observedAt),
            citation(`zone-${zone.id}`, zone.name, '공개/운영 참고 구역', 0.55),
          ],
        });
      }
    }
  }
  return anomalies;
}

function detectRouteDeviation(scenario: Scenario): Anomaly[] {
  return scenario.tracks.flatMap((track) => {
    const headingDelta = maxHeadingDelta(track);
    const climbDelta = altitudeDelta(track);
    if (headingDelta < 45 && climbDelta < 1300 && track.platformType !== 'unknown') return [];
    const last = latestPoint(track);
    const confidence = Math.min(0.86, 0.45 + headingDelta / 140 + climbDelta / 12000);
    return [{
      id: `an-route-${track.id}`,
      type: 'route_deviation' as const,
      severity: headingDelta > 70 || track.platformType === 'unknown' ? 'watch' as const : 'info' as const,
      title: `${track.callsign} 항로 이탈 검토 신호`,
      description: `확보된 항적 이력에서 방위가 최대 ${headingDelta.toFixed(0)}° 변했고 고도는 ${climbDelta.toLocaleString()}m 차이가 납니다. 기준 항로 폭은 ${track.baselineCorridorKm}km로 계산했습니다.`,
      confidence,
      relatedTrackIds: [track.id],
      relatedOsintIds: [],
      citations: [citation(`track-${track.id}`, `${track.callsign} 항적 이력`, track.source, 0.74, undefined, last.observedAt)],
    }];
  });
}

function detectWeatherRisk(scenario: Scenario): Anomaly[] {
  const wx = scenario.weather;
  if (!wx) return [];
  const riskyWeather = wx.visibilityM < 6000 || wx.cloudCoverPct > 75 || wx.precipitationMm > 0.5 || wx.windGustKmh > 45;
  if (!riskyWeather) return [];
  const related = scenario.tracks.filter((track) => track.platformType !== 'commercial' || maxHeadingDelta(track) > 40);
  if (related.length === 0) return [];
  return [{
    id: `an-weather-${scenario.region.id}`,
    type: 'weather_risk',
    severity: wx.visibilityM < 5500 || wx.windGustKmh > 50 ? 'watch' : 'info',
    title: '기상이 공개 ISR 해석 신뢰도를 낮출 수 있음',
    description: `운량 ${wx.cloudCoverPct}%, 가시거리 ${wx.visibilityM.toLocaleString()}m, 강수량 ${wx.precipitationMm}mm, 돌풍 ${wx.windGustKmh}km/h 조건으로 항적 해석의 불확실성이 커질 수 있습니다.`,
    confidence: 0.73,
    relatedTrackIds: related.map((track) => track.id),
    relatedOsintIds: [],
    citations: [citation(`wx-${wx.id}`, 'Open-Meteo 형식 기상 스냅샷', wx.source, 0.86, 'https://open-meteo.com/en/docs', wx.observedAt)],
  }];
}

function detectOsintCorrelation(scenario: Scenario): Anomaly[] {
  const relevant = scenario.osint.filter((item) => item.tags.some((tag) => ['air activity', 'regional security', 'gray-zone', 'exercise', 'news volume', 'ISR risk'].includes(tag)));
  const reviewTracks = scenario.tracks.filter((track) => track.platformType !== 'commercial' || maxHeadingDelta(track) > 45);
  if (relevant.length === 0 || reviewTracks.length === 0) return [];
  return [{
    id: `an-osint-${scenario.region.id}`,
    type: 'osint_correlation',
    severity: 'watch',
    title: 'OSINT 신호와 공중 활동 검토 신호가 같은 시간대에 겹침',
    description: `캐시/수동 OSINT 신호 ${relevant.length}건이 감시 구역, 항로, 기상 검토 대상으로 표시된 항적 ${reviewTracks.length}개와 같은 시간대에 겹칩니다. 이는 확인이 아니라 상관관계 단서입니다.`,
    confidence: Math.min(0.8, 0.48 + relevant.reduce((sum, item) => sum + item.confidence, 0) / (relevant.length * 4)),
    relatedTrackIds: reviewTracks.map((track) => track.id),
    relatedOsintIds: relevant.map((item) => item.id),
    citations: relevant.map((item) => citation(`osint-${item.id}`, item.title, item.source, item.confidence, item.url, item.publishedAt)),
  }];
}

export function detectAnomalies(scenario: Scenario): Anomaly[] {
  const normalizedScenario = tracksWithPoints(scenario);
  const anomalies = [
    ...detectZoneApproach(normalizedScenario),
    ...detectRouteDeviation(normalizedScenario),
    ...detectWeatherRisk(normalizedScenario),
    ...detectOsintCorrelation(normalizedScenario),
  ];
  return anomalies.sort((a, b) => {
    const severityRank = { warning: 3, watch: 2, info: 1 };
    return severityRank[b.severity] - severityRank[a.severity] || b.confidence - a.confidence;
  });
}

export function severityScore(severity: Anomaly['severity']): number {
  return severity === 'warning' ? 3 : severity === 'watch' ? 2 : 1;
}
