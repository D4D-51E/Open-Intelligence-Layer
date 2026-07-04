import { describe, expect, it } from 'vitest';
import { buildFusionEvents } from './fusion';
import { getScenario } from './baselineData';
import type { Scenario, Track, WeatherSnapshot } from './types';

function track(): Track {
  return {
    id: 'opensky-real-cache-1',
    source: 'opensky-cache',
    callsign: 'REAL01',
    originCountry: 'KR',
    platformType: 'commercial',
    baselineCorridorKm: 25,
    points: [{
      lat: 24.1,
      lon: 119.1,
      altitudeM: 9100,
      velocityMs: 230,
      headingDeg: 82,
      observedAt: '2026-07-01T00:00:00.000Z',
    }],
  };
}

function weather(): WeatherSnapshot {
  return {
    id: 'open-meteo-real-cache-1',
    source: 'open-meteo-cache',
    regionId: 'taiwan-strait',
    observedAt: '2026-07-01T00:05:00.000Z',
    temperatureC: 25,
    windSpeedKmh: 20,
    windGustKmh: 28,
    visibilityM: 12000,
    cloudCoverPct: 20,
    precipitationMm: 0,
    weatherCode: 1,
  };
}

function scenarioWithRealSignals(): Scenario {
  return {
    ...getScenario('taiwan-strait'),
    tracks: [track()],
    weather: weather(),
    sourceStatus: { opensky: 'cached', weather: 'live', osintEvents: 'disabled', notices: 'unsupported' },
    sourceReasons: { osintEvents: '좌표 정확도 정책상 지도 이벤트 비활성', notices: 'NOTAM endpoint 미지원' },
    timeline: [],
  };
}

describe('buildFusionEvents', () => {
  it('creates citation-backed fusion and data-quality events from real cached sources', () => {
    const events = buildFusionEvents(scenarioWithRealSignals(), []);

    const overview = events.find((event) => event.id.endsWith('overview'));
    expect(overview?.title).toContain('융합 상황 요약');
    expect(overview?.modules).toEqual(expect.arrayContaining(['fusion', 'tracks', 'weather']));
    expect(overview?.citations.map((citation) => citation.source)).toEqual(expect.arrayContaining(['opensky-cache', 'open-meteo-cache']));
    expect(overview?.safetyNote).toMatch(/표적 지정|공개 출처/);
    expect(events.some((event) => event.id.endsWith('data-quality'))).toBe(true);
  });

  it('does not synthesize fusion events for an empty real-data scenario', () => {
    const events = buildFusionEvents({ ...getScenario('west-sea-nll'), timeline: [] }, []);

    expect(events).toHaveLength(0);
  });

  it('turns explicit source gaps into citation-backed data-quality events only', () => {
    const events = buildFusionEvents({
      ...getScenario('west-sea-nll'),
      sourceStatus: { opensky: 'empty' },
      sourceReasons: { opensky: 'AOI 내 공개 ADS-B 상태 벡터 0건' },
      sourceUpdatedAt: { opensky: '2026-07-01T00:00:00.000Z' },
      timeline: [],
    }, []);

    expect(events.map((event) => event.id)).toEqual(['fusion-west-sea-nll-data-quality']);
    expect(events[0].severity).toBe('info');
    expect(events[0].summary).toContain('opensky');
    expect(events[0].citations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'source-status-opensky', source: 'source-status' }),
    ]));
  });
});
