import { describe, expect, it } from 'vitest';
import { boundsToViewport, fetchStrategyForZoom, viewportRadiusNm, VIEWPORT_ZOOM_THRESHOLD } from './viewport';

describe('fetchStrategyForZoom', () => {
  it('uses the global military feed below the threshold', () => {
    expect(fetchStrategyForZoom(0)).toBe('global-mil');
    expect(fetchStrategyForZoom(VIEWPORT_ZOOM_THRESHOLD - 0.1)).toBe('global-mil');
  });

  it('switches to viewport fetching at and above the threshold', () => {
    expect(fetchStrategyForZoom(VIEWPORT_ZOOM_THRESHOLD)).toBe('viewport');
    expect(fetchStrategyForZoom(8)).toBe('viewport');
  });
});

describe('boundsToViewport', () => {
  it('derives bbox and center from the given bounds', () => {
    const viewport = boundsToViewport({ west: 118, south: 22, east: 122, north: 26 }, 5);

    expect(viewport.bbox).toEqual([118, 22, 122, 26]);
    expect(viewport.center).toEqual([24, 120]);
    expect(viewport.zoom).toBe(5);
  });
});

describe('viewportRadiusNm', () => {
  it('returns a plausible radius for a moderate bbox', () => {
    const bbox: [number, number, number, number] = [118, 22, 122, 26];
    const center: [number, number] = [24, 120];

    const radius = viewportRadiusNm(bbox, center);

    expect(radius).toBeGreaterThan(150);
    expect(radius).toBeLessThan(250);
  });

  it('clamps to the minimum radius for a tiny bbox', () => {
    const bbox: [number, number, number, number] = [120, 24, 120.01, 24.01];
    const center: [number, number] = [24.005, 120.005];

    expect(viewportRadiusNm(bbox, center)).toBe(6);
  });

  it('clamps to the maximum radius for a huge bbox', () => {
    const bbox: [number, number, number, number] = [-170, -80, 170, 80];
    const center: [number, number] = [0, 0];

    expect(viewportRadiusNm(bbox, center)).toBe(250);
  });
});
