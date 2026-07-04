import { describe, expect, it } from 'vitest';
import { isWithinRegion, normalizeAdsbAircraft, normalizeAdsbList } from './adsbCommon';
import type { Region } from './types';

const region: Region = {
  id: 'seoul-airspace',
  name: '수도권 상공',
  shortName: '수도권',
  description: 'test',
  bbox: [124, 36, 128, 39],
  center: [37.5, 126.5],
  zoom: 7,
};

const NOW = 1_770_000_000; // fixed unix seconds

describe('normalizeAdsbAircraft', () => {
  it('maps a readsb aircraft and preserves identity + military flag', () => {
    const track = normalizeAdsbAircraft(
      region,
      NOW * 1000,
      { hex: 'AE1234', flight: 'RCH431 ', r: '08-8888', t: 'C17', lat: 37.5, lon: 126.5, alt_baro: 30000, gs: 420, track: 90, dbFlags: 1 },
      { idPrefix: 'adsb-lol', sourceLabel: 'adsb.lol' },
    );
    expect(track).not.toBeNull();
    expect(track!.id).toBe('adsb-lol-seoul-airspace-ae1234');
    expect(track!.callsign).toBe('RCH431');
    expect(track!.isMilitary).toBe(true);
    expect(track!.icao24).toBe('ae1234');
    expect(track!.registration).toBe('08-8888');
    expect(track!.typeCode).toBe('C17');
    expect(track!.points[0].altitudeM).toBeGreaterThan(0);
  });

  it('forceMilitary overrides a missing dbFlags', () => {
    const track = normalizeAdsbAircraft(
      region,
      NOW * 1000,
      { hex: 'abc123', flight: 'TEST1', lat: 37.5, lon: 126.5 },
      { idPrefix: 'adsb-lol', sourceLabel: 'adsb.lol 군용', forceMilitary: true },
    );
    expect(track!.isMilitary).toBe(true);
  });

  it('returns null when coordinates are missing', () => {
    const track = normalizeAdsbAircraft(region, NOW * 1000, { hex: 'abc123', flight: 'NOPOS' }, { idPrefix: 'adsb-lol', sourceLabel: 'adsb.lol' });
    expect(track).toBeNull();
  });
});

describe('isWithinRegion', () => {
  it('accepts points inside the padded bbox and rejects far ones', () => {
    expect(isWithinRegion(region, 37.5, 126.5)).toBe(true);
    expect(isWithinRegion(region, 10, 100)).toBe(false);
  });

  it('always returns true for the global region', () => {
    expect(isWithinRegion({ ...region, id: 'global' }, 0, 0)).toBe(true);
  });
});

describe('normalizeAdsbList', () => {
  it('sorts by speed desc and applies the optional filter', () => {
    const tracks = normalizeAdsbList(
      { now: NOW, ac: [
        { hex: 'a1', flight: 'SLOW', lat: 37.5, lon: 126.5, gs: 100 },
        { hex: 'a2', flight: 'FAST', lat: 37.6, lon: 126.6, gs: 450 },
        { hex: 'a3', flight: 'FAR', lat: 10, lon: 100, gs: 300 },
      ] },
      region,
      { idPrefix: 'adsb-lol', sourceLabel: 'adsb.lol' },
      (_ac, track) => isWithinRegion(region, track.points[0].lat, track.points[0].lon),
    );
    expect(tracks.map((t) => t.callsign)).toEqual(['FAST', 'SLOW']);
  });
});
