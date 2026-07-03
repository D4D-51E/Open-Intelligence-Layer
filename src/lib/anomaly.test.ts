import { describe, expect, it } from 'vitest';
import { detectAnomalies } from './anomaly';
import { getScenario } from './baselineData';
import type { Track } from './types';

function realLikeTrack(id: string, callsign: string): Track {
  return {
    id,
    source: 'opensky-cache',
    callsign,
    originCountry: 'Test',
    platformType: 'commercial',
    baselineCorridorKm: 25,
    points: [{
      lat: 24.1,
      lon: 119.1,
      altitudeM: 9000,
      velocityMs: 230,
      headingDeg: 90,
      observedAt: '2026-07-01T00:00:00.000Z',
    }],
  };
}

describe('detectAnomalies', () => {
  it('ignores malformed empty tracks instead of crashing', () => {
    const scenario = getScenario('taiwan-strait');
    const validTrack = realLikeTrack('trk-valid-cache-row', 'VALID01');
    const malformedTrack: Track = {
      ...validTrack,
      id: 'trk-empty-cache-row',
      callsign: 'EMPTYROW',
      points: [],
    };

    expect(() => detectAnomalies({ ...scenario, tracks: [malformedTrack, validTrack] })).not.toThrow();
    const anomalies = detectAnomalies({ ...scenario, tracks: [malformedTrack, validTrack] });

    expect(anomalies.flatMap((anomaly) => anomaly.relatedTrackIds)).not.toContain('trk-empty-cache-row');
  });
});
