import type { Region, Track, TrackPoint } from './types';

// Shared normalization for readsb/tar1090-style ADS-B JSON feeds.
// Both Airplanes.live (/v2/point) and adsb.lol (/v2/lat/lon/dist, /v2/mil) return
// the same `{ now, ac: [...] }` aircraft shape, so the mapping lives here once.

export type AdsbApiAircraft = {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  category?: string;
  lat?: number | string;
  lon?: number | string;
  alt_baro?: number | string;
  alt_geom?: number | string;
  gs?: number | string;
  ias?: number | string;
  tas?: number | string;
  track?: number | string;
  true_heading?: number | string;
  mag_heading?: number | string;
  seen?: number | string;
  seen_pos?: number | string;
  dbFlags?: number | string;
};

export type AdsbApiResponse = {
  msg?: string;
  now?: number;
  ac?: AdsbApiAircraft[];
};

export type NormalizeOpts = {
  idPrefix: string;
  sourceLabel: string;
  forceMilitary?: boolean;
};

const earthRadiusNm = 3440.065;
const feetToMeters = 0.3048;
const knotsToMs = 0.514444;
const minRadiusNm = 6;
const maxRadiusNm = 250;
const globalRadiusNm = 100;
const maxTracksPerFeed = 500;

export function toNumber(value: number | string | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 16) || 'aircraft';
}

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function haversineNm(aLat: number, aLon: number, bLat: number, bLon: number) {
  const dLat = degToRad(bLat - aLat);
  const dLon = degToRad(bLon - aLon);
  const lat1 = degToRad(aLat);
  const lat2 = degToRad(bLat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return earthRadiusNm * c;
}

export function regionRadiusNm(region: Region, overrideRadiusNm?: number) {
  if (overrideRadiusNm && overrideRadiusNm > 0) {
    return clamp(Math.round(Number(overrideRadiusNm)), minRadiusNm, maxRadiusNm);
  }

  if (region.id === 'global') return globalRadiusNm;

  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  const [centerLat, centerLon] = region.center;
  const corners = [
    [minLat, minLon],
    [minLat, maxLon],
    [maxLat, minLon],
    [maxLat, maxLon],
  ] as const;
  const radius = Math.max(
    ...corners.map(([lat, lon]) => haversineNm(centerLat, centerLon, lat, lon)),
  );
  const padded = radius * 1.12;
  return clamp(Math.max(minRadiusNm, Math.round(padded)), minRadiusNm, maxRadiusNm);
}

export function isMilitaryFlag(value: number | null) {
  if (value == null) return false;
  return (value & 1) === 1;
}

function classifyPlatform(callsign: string, dbFlags: number | null): Track['platformType'] {
  if (!callsign || callsign.length < 3) return 'unknown';
  if (isMilitaryFlag(dbFlags)) return 'unknown';
  return 'commercial';
}

function normalizeObservedAt(nowMs: number | null, aircraft: AdsbApiAircraft) {
  const seen = Math.max(0, toNumber(aircraft.seen) ?? toNumber(aircraft.seen_pos) ?? 0);
  const base = Number.isFinite(nowMs ?? NaN) ? nowMs! : Date.now();
  return new Date(Math.max(0, base - seen * 1000)).toISOString();
}

export function isWithinRegion(region: Region, lat: number, lon: number, padDeg = 0.5) {
  if (region.id === 'global') return true;
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return lat >= minLat - padDeg && lat <= maxLat + padDeg && lon >= minLon - padDeg && lon <= maxLon + padDeg;
}

export function normalizeAdsbAircraft(
  region: Region,
  nowMs: number | null,
  aircraft: AdsbApiAircraft,
  opts: NormalizeOpts,
): Track | null {
  const lat = toNumber(aircraft.lat);
  const lon = toNumber(aircraft.lon);
  if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const hexRaw = String(aircraft.hex ?? '').trim();
  const flightRaw = String(aircraft.flight ?? '').trim().replace(/\s+/g, '');
  const callsign = flightRaw || String(aircraft.r ?? '').trim() || hexRaw || 'Aircraft';
  const dbFlags = toNumber(aircraft.dbFlags);
  const rawAltitude = toNumber(aircraft.alt_baro) ?? toNumber(aircraft.alt_geom);
  const altitudeM = rawAltitude == null ? 0 : Math.max(0, Math.round(rawAltitude * feetToMeters));
  const knots = toNumber(aircraft.gs) ?? toNumber(aircraft.ias) ?? toNumber(aircraft.tas);
  const velocityMs = knots == null ? 0 : Math.max(0, Math.round(knots * knotsToMs * 10) / 10);
  const heading = toNumber(aircraft.true_heading) ?? toNumber(aircraft.track) ?? toNumber(aircraft.mag_heading);

  const point: TrackPoint = {
    lat,
    lon,
    altitudeM,
    velocityMs,
    headingDeg: heading == null ? 0 : Math.round(heading),
    observedAt: normalizeObservedAt(nowMs, aircraft),
  };

  return {
    id: `${opts.idPrefix}-${region.id}-${normalizeId(hexRaw || callsign)}`,
    source: 'adsb-cache',
    callsign: callsign || `ADS-B-${region.id}`,
    originCountry: 'Unknown',
    platformType: classifyPlatform(callsign, dbFlags),
    baselineCorridorKm: 25,
    notes: `${opts.sourceLabel} ${rawAltitude == null ? '위치' : '고도'} 기반 상태벡터`,
    isMilitary: opts.forceMilitary === true || isMilitaryFlag(dbFlags),
    icao24: hexRaw ? hexRaw.toLowerCase() : undefined,
    registration: String(aircraft.r ?? '').trim() || undefined,
    typeCode: String(aircraft.t ?? '').trim() || undefined,
    points: [point],
  };
}

export function normalizeAdsbList(
  payload: AdsbApiResponse,
  region: Region,
  opts: NormalizeOpts,
  filter?: (aircraft: AdsbApiAircraft, track: Track) => boolean,
): Track[] {
  const nowMs = toNumber(payload.now) != null ? Number(toNumber(payload.now)) * 1000 : Date.now();
  const aircraft = Array.isArray(payload.ac) ? payload.ac : [];
  return aircraft
    .map((item) => {
      const track = normalizeAdsbAircraft(region, nowMs, item, opts);
      if (!track) return null;
      if (filter && !filter(item, track)) return null;
      return track;
    })
    .filter((track): track is Track => track !== null)
    .slice(0, maxTracksPerFeed)
    .sort((a, b) => (b.points[0]?.velocityMs ?? 0) - (a.points[0]?.velocityMs ?? 0));
}
