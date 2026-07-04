import { describe, expect, it } from 'vitest';
import { getScenario } from './baselineData';
import { buildClaimMapEvents, buildVerificationCases } from './verify';
import type { Scenario, SatelliteScene, ThermalAnomaly } from './types';

function scene(): SatelliteScene {
  return {
    id: 'copernicus-scene-1',
    regionId: 'south-china-sea',
    source: 'copernicus-stac-cache',
    provider: 'Copernicus Sentinel',
    platform: 'Sentinel-2',
    observedAt: '2026-07-04T01:10:00.000Z',
    cloudCoverPct: 18,
    summary: 'Sentinel scene metadata intersects AOI.',
    url: 'https://browser.dataspace.copernicus.eu/',
  };
}

function thermal(): ThermalAnomaly {
  return {
    id: 'firms-1',
    regionId: 'south-china-sea',
    source: 'nasa-firms-cache',
    provider: 'NASA FIRMS',
    lat: 11.1,
    lon: 112.1,
    observedAt: '2026-07-04T01:15:00.000Z',
    confidence: 0.78,
    frpMw: 120,
    satellite: 'VIIRS',
  };
}

describe('buildVerificationCases', () => {
  it('keeps the F-35 claim as a citation-backed likely false/false case', () => {
    const cases = buildVerificationCases(getScenario('global'));
    const f35 = cases.find((item) => item.claim.id === 'claim-iran-f35-shootdown-2026');

    expect(f35).toBeDefined();
    expect(f35?.verdict.label).toMatch(/false/);
    expect(f35?.evidence.some((item) => item.category === 'factcheck' && item.stance === 'contradicts')).toBe(true);
    expect(f35?.verdict.caveats.join(' ')).toMatch(/공개 ADS-B 부재/);
  });

  it('uses satellite scene and thermal OSINT as supporting/context evidence for base strike claims', () => {
    const scenario: Scenario = {
      ...getScenario('south-china-sea'),
      satelliteScenes: [scene()],
      thermalAnomalies: [thermal()],
      sourceStatus: { copernicusStac: 'live', nasaFirms: 'live' },
    };

    const cases = buildVerificationCases(scenario);
    const baseStrike = cases.find((item) => item.claim.id === 'claim-scs-base-strike');

    expect(baseStrike?.evidence.map((item) => item.category)).toEqual(expect.arrayContaining(['satellite_scene', 'thermal']));
    expect(baseStrike?.evidence.some((item) => item.category === 'thermal' && item.stance === 'supports')).toBe(true);
    expect(baseStrike?.verdict.label).not.toBe('false');
  });

  it('converts verification claims into map review points', () => {
    const events = buildClaimMapEvents(buildVerificationCases(getScenario('west-sea-nll')));

    expect(events.some((event) => event.source === 'claim-review-cache')).toBe(true);
    expect(events[0].tags).toContain('claim');
  });
});
