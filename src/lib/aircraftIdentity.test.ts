import { describe, expect, it } from 'vitest';
import { buildAircraftIdentity } from './aircraftIdentity';
import type { Track } from './types';

const OBSERVED_AT = '2026-07-01T00:00:00.000Z';

function track(overrides: Partial<Track> = {}): Track {
  return {
    id: 'track-a',
    source: 'opensky-cache',
    callsign: 'REAL01',
    originCountry: 'KR',
    platformType: 'commercial',
    baselineCorridorKm: 25,
    points: [{ lat: 24.1, lon: 119.1, altitudeM: 9100, velocityMs: 230, headingDeg: 82, observedAt: OBSERVED_AT }],
    ...overrides,
  };
}

describe('buildAircraftIdentity', () => {
  it('matches a USAF Reach callsign to its program and operator, and flags militaryLikely', () => {
    const identity = buildAircraftIdentity(track({ callsign: 'RCH293' }));

    expect(identity.callsignProgram).toContain('Reach');
    expect(identity.operatorCandidates).toContain('USAF');
    expect(identity.operatorCandidates).toContain('미 공군');
    expect(identity.militaryLikely).toBe(true);
    expect(identity.notes.some((note) => note.includes('휴리스틱'))).toBe(true);
  });

  it('does not assign a military program for an ordinary civil callsign', () => {
    const identity = buildAircraftIdentity(track({ callsign: 'KAL672' }));

    expect(identity.callsignProgram).toBeUndefined();
    expect(identity.militaryLikely).toBe(false);
    expect(identity.operatorCandidates).toHaveLength(0);
  });

  it('flags a US military hex block with registrationCountry and militaryLikely', () => {
    const identity = buildAircraftIdentity(track({ callsign: 'REAL01', icao24: 'AE1460' }));

    expect(identity.registrationCountry).toBe('미국 (US)');
    expect(identity.militaryLikely).toBe(true);
  });

  it('resolves a civil US hex block to a country without militaryLikely', () => {
    const identity = buildAircraftIdentity(track({ callsign: 'KAL672', icao24: 'A00001' }));

    expect(identity.registrationCountry).toBe('미국 (US)');
    expect(identity.militaryLikely).toBe(false);
  });

  it('maps a known ICAO type code to a human-readable label', () => {
    const identity = buildAircraftIdentity(track({ typeCode: 'C17' }));

    expect(identity.typeCandidate).toBe('Boeing C-17 Globemaster III');
  });

  it('falls back to the raw code for an unknown type code', () => {
    const identity = buildAircraftIdentity(track({ typeCode: 'ZZ99' }));

    expect(identity.typeCandidate).toBe('ZZ99 (ADS-B 방송 기종코드)');
    expect(identity.notes.some((note) => note.includes('미등록'))).toBe(true);
  });

  it('matches a USAF Reach spelled-out callsign to the same program as RCH', () => {
    const identity = buildAircraftIdentity(track({ callsign: 'REACH421' }));

    expect(identity.callsignProgram).toContain('Reach');
    expect(identity.militaryLikely).toBe(true);
  });

  it('matches a Duke callsign to the USAF program', () => {
    const identity = buildAircraftIdentity(track({ callsign: 'DUKE12' }));

    expect(identity.operatorCandidates).toContain('USAF');
    expect(identity.militaryLikely).toBe(true);
  });

  it('maps a known fighter type code to a human-readable label', () => {
    const identity = buildAircraftIdentity(track({ typeCode: 'F16' }));

    expect(identity.typeCandidate).toBe('General Dynamics F-16');
  });

  it('leaves optional fields undefined without crashing when icao24/typeCode are absent', () => {
    const identity = buildAircraftIdentity(track());

    expect(identity.icao24).toBeUndefined();
    expect(identity.registration).toBeUndefined();
    expect(identity.registrationCountry).toBeUndefined();
    expect(identity.typeCandidate).toBeUndefined();
    expect(identity.callsignProgram).toBeUndefined();
    expect(identity.militaryLikely).toBe(false);
  });
});
