import { describe, expect, it } from 'vitest';
import { buildTrackFusionContext } from './trackFusion';
import { getScenario } from './baselineData';
import type { Anomaly, OsintItem, OsintMapEvent, SatellitePass, Scenario, Track, WeatherSnapshot } from './types';

const OBSERVED_AT = '2026-07-01T00:00:00.000Z';

function track(): Track {
  return {
    id: 'track-a',
    source: 'opensky-cache',
    callsign: 'REAL01',
    originCountry: 'KR',
    platformType: 'commercial',
    baselineCorridorKm: 25,
    points: [{ lat: 24.1, lon: 119.1, altitudeM: 9100, velocityMs: 230, headingDeg: 82, observedAt: OBSERVED_AT }],
  };
}

function weather(): WeatherSnapshot {
  return {
    id: 'wx-1',
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

function nearSatellite(): SatellitePass {
  return {
    id: 'sat-1',
    source: 'celestrak-cache',
    name: 'SAT-A',
    observedAt: '2026-07-01T00:20:00.000Z',
    lat: 24.15,
    lon: 119.35,
    altitudeKm: 500,
    direction: 'N',
    roleHint: 'earth observation',
  };
}

function nearOsintEvent(): OsintMapEvent {
  return {
    id: 'oe-1',
    regionId: 'taiwan-strait',
    source: 'gdelt-cache',
    title: 'Event A',
    lat: 24.12,
    lon: 119.12,
    observedAt: '2026-07-01T00:15:00.000Z',
    confidence: 0.6,
    relatedOsintId: 'osint-1',
    tags: ['air activity'],
  };
}

function nearOsintItem(): OsintItem {
  return {
    id: 'osint-1',
    source: 'gdelt-cache',
    regionId: 'taiwan-strait',
    title: 'News A',
    publishedAt: '2026-07-01T00:10:00.000Z',
    summary: 'summary',
    tags: ['air activity'],
    confidence: 0.6,
  };
}

function relatedAnomaly(): Anomaly {
  return {
    id: 'an-1',
    type: 'zone_approach',
    severity: 'watch',
    title: '경계 근접 검토 신호',
    description: 'test',
    confidence: 0.7,
    relatedTrackIds: ['track-a'],
    relatedOsintIds: [],
    citations: [{ id: 'cit-1', label: 'label', source: 'source', confidence: 0.7 }],
  };
}

function scenarioWithNearSignals(): Scenario {
  return {
    ...getScenario('taiwan-strait'),
    weather: weather(),
    satellites: [nearSatellite()],
    airspaceContexts: [{
      id: 'fir-1',
      regionId: 'taiwan-strait',
      source: 'icao-fir-cache',
      icaoCode: 'RCTP',
      firName: 'Taipei FIR',
      lat: 24.0,
      lon: 119.0,
      observedAt: OBSERVED_AT,
    }],
    notices: [{
      id: 'notice-1',
      regionId: 'taiwan-strait',
      source: 'icao-notam-cache',
      title: 'Test NOTAM',
      description: 'test',
      publishedAt: OBSERVED_AT,
      lat: 24.1,
      lon: 119.15,
      radiusKm: 50,
      severity: 'watch',
    }],
    osintEvents: [nearOsintEvent()],
    osint: [nearOsintItem()],
  };
}

describe('buildTrackFusionContext', () => {
  it('marks all axes present when scenario has real data near the track', () => {
    const context = buildTrackFusionContext(track(), scenarioWithNearSignals(), [relatedAnomaly()]);

    expect(context.axes.every((axis) => axis.present)).toBe(true);
    expect(context.gaps).toHaveLength(0);
    expect(context.citations.length).toBeGreaterThan(0);
    expect(context.citations.every((c) => c.id)).toBe(true);
  });

  it('records absent axes as gaps for an empty scenario', () => {
    const context = buildTrackFusionContext(track(), { ...getScenario('taiwan-strait') }, []);

    expect(context.axes.every((axis) => !axis.present)).toBe(true);
    expect(context.gaps).toHaveLength(context.axes.length);
    expect(context.citations).toHaveLength(0);
  });

  it('excludes satellite passes and osint events far from the track', () => {
    const farSatellite: SatellitePass = { ...nearSatellite(), id: 'sat-far', lat: 24.1, lon: 133.0 };
    const farOsintEvent: OsintMapEvent = { ...nearOsintEvent(), id: 'oe-far', lat: 24.1, lon: 133.0 };

    const scenario: Scenario = {
      ...getScenario('taiwan-strait'),
      satellites: [farSatellite],
      osintEvents: [farOsintEvent],
    };

    const context = buildTrackFusionContext(track(), scenario, []);

    const satelliteAxis = context.axes.find((axis) => axis.kind === 'satellite')!;
    const osintAxis = context.axes.find((axis) => axis.kind === 'osint')!;

    expect(satelliteAxis.present).toBe(false);
    expect(osintAxis.present).toBe(false);
    expect(context.gaps.some((gap) => gap.startsWith('위성'))).toBe(true);
    expect(context.gaps.some((gap) => gap.startsWith('OSINT'))).toBe(true);
  });

  it('picks up anomalies by relatedTrackIds only', () => {
    const otherAnomaly: Anomaly = { ...relatedAnomaly(), id: 'an-other', title: '무관 신호', relatedTrackIds: ['other-track'] };

    const context = buildTrackFusionContext(track(), { ...getScenario('taiwan-strait') }, [relatedAnomaly(), otherAnomaly]);

    const anomalyAxis = context.axes.find((axis) => axis.kind === 'anomaly')!;
    expect(anomalyAxis.present).toBe(true);
    expect(anomalyAxis.detail).toContain('경계 근접 검토 신호');
    expect(anomalyAxis.detail).not.toContain('무관 신호');
    expect(anomalyAxis.citation?.id).toBe('cit-1');
  });
});
