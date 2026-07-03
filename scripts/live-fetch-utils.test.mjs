import { describe, expect, it } from 'vitest';
import {
  openSkyStateCreditsForBbox,
  publicErrorMessage,
  recommendedOpenSkyIntervalMs,
  retryAfterSecondsFromHeaders,
} from './live-fetch-utils.mjs';

const regions = [
  { bbox: [118.4271213, 23.4204107, 120.7974216, 25.5523561] },
  { bbox: [124.3727348, 36.8544193, 127.8481129, 38.2811104] },
  { bbox: [102.2384722, -3.2287222, 122.1513056, 25.5672778] },
  { bbox: [123.547708291629, 37.626084840136, 126.688972200141, 38.2047340114075] },
];

describe('OpenSky public API quota helpers', () => {
  it('estimates bbox credit cost using the OpenSky area tiers', () => {
    expect(regions.map((region) => openSkyStateCreditsForBbox(region.bbox))).toEqual([1, 1, 4, 1]);
  });

  it('recommends a safe anonymous interval for all configured AOIs', () => {
    expect(recommendedOpenSkyIntervalMs(regions)).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });

  it('parses OpenSky retry-after headers', () => {
    expect(retryAfterSecondsFromHeaders({ 'x-rate-limit-retry-after-seconds': '215' })).toBe(215);
  });

  it('sanitizes HTML-shaped upstream parse failures for public cache fields', () => {
    const error = new SyntaxError('Unexpected token \'<\', "<!DOCTYPE html><body>blocked</body>" is not valid JSON');
    const message = publicErrorMessage(error);

    expect(message).toBe('Invalid upstream response format (non-JSON)');
    expect(message).not.toMatch(/<|>|DOCTYPE|body/i);
  });
});
