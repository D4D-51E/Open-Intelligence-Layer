import { describe, expect, it } from 'vitest';
import { liveTrackHistoryForRegion, mergeLiveTrackHistory } from './liveTrackHistory';
import type { Track } from './types';

function track(observedAt: string, lat: number, lon: number): Track {
  return {
    id: 'live-taiwan-strait-abc123',
    source: 'opensky-cache',
    callsign: 'TEST01',
    originCountry: 'Test',
    platformType: 'commercial',
    baselineCorridorKm: 25,
    points: [{
      lat,
      lon,
      altitudeM: 9000,
      velocityMs: 230,
      headingDeg: 90,
      observedAt,
    }],
  };
}

describe('live track history', () => {
  it('deduplicates repeated snapshots and accumulates changed positions', () => {
    let history = mergeLiveTrackHistory({}, 'taiwan-strait', [track('2026-06-30T03:00:00.000Z', 24.1, 119.1)], '2026-06-30T03:00:10.000Z');
    history = mergeLiveTrackHistory(history, 'taiwan-strait', [track('2026-06-30T03:00:00.000Z', 24.1, 119.1)], '2026-06-30T03:00:20.000Z');
    history = mergeLiveTrackHistory(history, 'taiwan-strait', [track('2026-06-30T03:05:00.000Z', 24.2, 119.2)], '2026-06-30T03:05:10.000Z');

    const [merged] = liveTrackHistoryForRegion(history, 'taiwan-strait');
    expect(merged.points.map((point) => [point.observedAt, point.lat, point.lon])).toEqual([
      ['2026-06-30T03:00:00.000Z', 24.1, 119.1],
      ['2026-06-30T03:05:00.000Z', 24.2, 119.2],
    ]);
  });

  it('caps retained trail points', () => {
    let history = {};
    for (let index = 0; index < 10; index += 1) {
      history = mergeLiveTrackHistory(
        history,
        'taiwan-strait',
        [track(`2026-06-30T03:${String(index).padStart(2, '0')}:00.000Z`, 24 + index / 100, 119 + index / 100)],
        '2026-06-30T03:10:00.000Z',
      );
    }

    const [merged] = liveTrackHistoryForRegion(history, 'taiwan-strait');
    expect(merged.points).toHaveLength(8);
    expect(merged.points[0].observedAt).toBe('2026-06-30T03:02:00.000Z');
  });
});
