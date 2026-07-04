import { describe, expect, it } from 'vitest';
import { classifyNotice, matchActiveAirspace } from './noticeAirspace';
import type { AirspaceNotice } from './types';

const AT = new Date('2026-07-04T12:00:00Z');

function baseNotice(overrides: Partial<AirspaceNotice>): AirspaceNotice {
  return {
    id: 'n-1',
    regionId: 'seoul-airspace',
    source: 'icao-notam-cache',
    title: 'Notice',
    description: '',
    publishedAt: '2026-07-01T00:00:00Z',
    lat: 37.5,
    lon: 127.0,
    radiusKm: 50,
    severity: 'warning',
    ...overrides,
  };
}

describe('classifyNotice', () => {
  it('classifies a danger area and parses its FL band', () => {
    const notice = baseNotice({
      title: 'Danger Area Activated',
      description: 'Danger area active FL180-FL350 for military exercise',
    });

    const result = classifyNotice(notice, AT);

    expect(result.kind).toBe('DANGER');
    expect(result.flMin).toBe(180);
    expect(result.flMax).toBe(350);
    expect(result.active).toBe(true);
  });

  it('falls back to GENERIC when no keywords match', () => {
    const notice = baseNotice({
      title: 'Notice to Airmen',
      description: 'General airspace advisory, no specific classification',
    });

    const result = classifyNotice(notice, AT);

    expect(result.kind).toBe('GENERIC');
    expect(result.flMin).toBeUndefined();
    expect(result.flMax).toBeUndefined();
  });

  it('parses SFC/GND and plain-feet FL band formats', () => {
    const sfcNotice = baseNotice({ title: 'Restricted Area', description: 'Restricted SFC-FL240' });
    expect(classifyNotice(sfcNotice, AT)).toMatchObject({ kind: 'RESTRICTED', flMin: 0, flMax: 240 });

    const gndFtNotice = baseNotice({ title: 'Restricted Area', description: 'Restricted GND-5000FT' });
    expect(classifyNotice(gndFtNotice, AT)).toMatchObject({ kind: 'RESTRICTED', flMin: 0, flMax: 50 });

    const ftFtNotice = baseNotice({ title: 'Restricted Area', description: 'Restricted 1500FT-9500FT' });
    expect(classifyNotice(ftFtNotice, AT)).toMatchObject({ kind: 'RESTRICTED', flMin: 15, flMax: 95 });
  });

  it('is active only within the effective window', () => {
    const notice = baseNotice({
      title: 'Prohibited Area',
      description: 'Prohibited 금지',
      effectiveFrom: '2026-07-01T00:00:00Z',
      effectiveTo: '2026-07-10T00:00:00Z',
    });

    expect(classifyNotice(notice, new Date('2026-07-05T00:00:00Z')).active).toBe(true);
    expect(classifyNotice(notice, new Date('2026-06-30T00:00:00Z')).active).toBe(false);
    expect(classifyNotice(notice, new Date('2026-07-11T00:00:00Z')).active).toBe(false);
  });
});

describe('matchActiveAirspace', () => {
  const point = { lat: 37.5, lon: 127.0, altitudeM: 3048, observedAt: '2026-07-04T12:00:00Z' }; // ~FL100

  it('includes an in-radius/in-alt notice, excludes a far one, and flags an out-of-altband one', () => {
    const inRange = baseNotice({
      id: 'in-range',
      lat: 37.5,
      lon: 127.0,
      radiusKm: 50,
      title: 'Danger Area',
      description: 'Danger area FL050-FL150',
    });
    const far = baseNotice({
      id: 'far',
      lat: 0,
      lon: 0,
      radiusKm: 50,
      title: 'Danger Area',
      description: 'Danger area FL050-FL150',
    });
    const altMismatch = baseNotice({
      id: 'alt-mismatch',
      lat: 37.5,
      lon: 127.0,
      radiusKm: 50,
      title: 'Danger Area',
      description: 'Danger area FL200-FL300',
    });

    const result = matchActiveAirspace(point, [inRange, far, altMismatch], AT);
    const ids = result.map((match) => match.notice.id);

    expect(ids).toContain('in-range');
    expect(ids).not.toContain('far');
    expect(ids).toContain('alt-mismatch');

    expect(result.find((m) => m.notice.id === 'in-range')?.withinAltBand).toBe(true);
    expect(result.find((m) => m.notice.id === 'alt-mismatch')?.withinAltBand).toBe(false);
  });
});
