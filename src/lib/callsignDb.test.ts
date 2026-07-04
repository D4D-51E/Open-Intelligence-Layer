import { describe, expect, it } from 'vitest';
import { parseOperatorDb, resolveOperator } from './callsignDb';
import { buildAircraftIdentity } from './aircraftIdentity';
import type { Track } from './types';

const sampleFile = {
  operators: {
    RCH: { n: 'Air Mobility Command', c: 'United States', r: 'REACH', m: 1 },
    KAL: { n: 'Korean Air', c: 'South Korea', r: 'KOREANAIR', m: 0 },
  },
};

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 't1',
    source: 'adsb-cache',
    callsign: 'RCH431',
    originCountry: 'Unknown',
    platformType: 'unknown',
    baselineCorridorKm: 25,
    points: [{ lat: 37, lon: 126, altitudeM: 9000, velocityMs: 200, headingDeg: 90, observedAt: '2026-07-04T00:00:00.000Z' }],
    ...overrides,
  };
}

describe('parseOperatorDb / resolveOperator', () => {
  it('parses the operators file into a lookup with the military flag', () => {
    const db = parseOperatorDb(sampleFile);
    expect(db.size).toBe(2);
    expect(db.get('RCH')?.name).toBe('Air Mobility Command');
    expect(db.get('RCH')?.military).toBe(true);
    expect(db.get('KAL')?.military).toBe(false);
  });

  it('resolves by 3-letter prefix and returns null for tactical/registration callsigns', () => {
    const db = parseOperatorDb(sampleFile);
    expect(resolveOperator('RCH431', db)?.entry.name).toBe('Air Mobility Command');
    expect(resolveOperator('KAL672', db)?.prefix).toBe('KAL');
    expect(resolveOperator('DRAGON', db)).toBeNull();
    expect(resolveOperator('N123AB', db)).toBeNull();
  });

  it('returns an empty db for malformed input', () => {
    expect(parseOperatorDb(null).size).toBe(0);
    expect(parseOperatorDb({}).size).toBe(0);
    expect(parseOperatorDb({ operators: 'nope' } as unknown).size).toBe(0);
  });
});

describe('buildAircraftIdentity with the operator dataset', () => {
  it('uses the dataset as the primary operator source', () => {
    const db = parseOperatorDb(sampleFile);
    const identity = buildAircraftIdentity(track({ callsign: 'RCH431' }), db);
    expect(identity.callsignProgram).toContain('Air Mobility Command');
    expect(identity.operatorCandidates.join(' ')).toContain('Air Mobility Command');
    expect(identity.militaryLikely).toBe(true);
    expect(identity.notes.some((note) => note.includes('데이터셋'))).toBe(true);
  });

  it('falls back to the built-in prefix table when no dataset is provided', () => {
    const identity = buildAircraftIdentity(track({ callsign: 'RCH431' }));
    expect(identity.militaryLikely).toBe(true);
    expect(identity.callsignProgram).toBeDefined();
  });
});
