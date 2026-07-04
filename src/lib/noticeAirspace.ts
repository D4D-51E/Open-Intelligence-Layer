import type { AirspaceNotice } from './types';

export type AirspaceKind = 'MOA' | 'TRA' | 'DANGER' | 'RESTRICTED' | 'PROHIBITED' | 'TSA' | 'CTR' | 'GENERIC';

export type NoticeAirspace = {
  noticeId: string;
  kind: AirspaceKind;
  flMin?: number;
  flMax?: number;
  active: boolean;
};

export type AirspaceMatch = {
  notice: AirspaceNotice;
  airspace: NoticeAirspace;
  withinRadius: boolean;
  withinAltBand: boolean;
};

const EARTH_RADIUS_NM = 3440.065;
const NM_PER_KM = 0.539957;
const FEET_PER_METER = 3.28084;

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}

function haversineNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = degToRad(bLat - aLat);
  const dLon = degToRad(bLon - aLon);
  const lat1 = degToRad(aLat);
  const lat2 = degToRad(bLat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_NM * c;
}

const KIND_RULES: Array<{ kind: AirspaceKind; patterns: RegExp[] }> = [
  { kind: 'DANGER', patterns: [/danger area/i, /\beg\s?d\d*\b/i, /\bdanger\b/i, /위험/] },
  { kind: 'RESTRICTED', patterns: [/restricted/i, /제한/] },
  { kind: 'PROHIBITED', patterns: [/prohibited/i, /금지/] },
  { kind: 'MOA', patterns: [/military operations area/i, /\bmoa\b/i] },
  { kind: 'TRA', patterns: [/temporary reserved/i, /\btra\b/i] },
  { kind: 'TSA', patterns: [/temporary segregated/i, /\btsa\b/i] },
  { kind: 'CTR', patterns: [/control zone/i, /\bctr\b/i] },
];

function classifyKind(text: string): AirspaceKind {
  const rule = KIND_RULES.find((entry) => entry.patterns.some((pattern) => pattern.test(text)));
  return rule?.kind ?? 'GENERIC';
}

// Ordered by token specificity: an entry only matches when its unit markers (FL / SFC/GND / FT) are present,
// so earlier entries never swallow a later entry's format.
const FL_BAND_PATTERNS: Array<{ re: RegExp; toFl: (match: RegExpMatchArray) => [number, number] }> = [
  { re: /FL\s*(\d+)\s*[-/]\s*(?:FL\s*)?(\d+)/i, toFl: (m) => [Number(m[1]), Number(m[2])] },
  { re: /(?:SFC|GND)\s*-\s*FL\s*(\d+)/i, toFl: (m) => [0, Number(m[1])] },
  { re: /(?:SFC|GND)\s*-\s*(\d+)\s*FT/i, toFl: (m) => [0, Math.round(Number(m[1]) / 100)] },
  { re: /(\d+)\s*FT\s*-\s*(\d+)\s*FT/i, toFl: (m) => [Math.round(Number(m[1]) / 100), Math.round(Number(m[2]) / 100)] },
];

function parseFlBand(text: string): { flMin?: number; flMax?: number } {
  for (const { re, toFl } of FL_BAND_PATTERNS) {
    const match = text.match(re);
    if (!match) continue;
    const [a, b] = toFl(match);
    return { flMin: Math.min(a, b), flMax: Math.max(a, b) };
  }
  return {};
}

function isActive(notice: AirspaceNotice, at: Date): boolean {
  const from = notice.effectiveFrom ? new Date(notice.effectiveFrom) : undefined;
  const to = notice.effectiveTo ? new Date(notice.effectiveTo) : undefined;
  if (from && at < from) return false;
  if (to && at > to) return false;
  return true;
}

export function classifyNotice(notice: AirspaceNotice, at: Date): NoticeAirspace {
  const text = `${notice.title} ${notice.description}`;
  const { flMin, flMax } = parseFlBand(text);
  return {
    noticeId: notice.id,
    kind: classifyKind(text),
    flMin,
    flMax,
    active: isActive(notice, at),
  };
}

export function matchActiveAirspace(
  point: { lat: number; lon: number; altitudeM: number; observedAt: string },
  notices: AirspaceNotice[],
  at: Date,
): AirspaceMatch[] {
  const pointFl = (point.altitudeM * FEET_PER_METER) / 100;

  return notices
    .map((notice) => {
      const airspace = classifyNotice(notice, at);
      const distanceNm = haversineNm(point.lat, point.lon, notice.lat, notice.lon);
      const withinRadius = distanceNm <= notice.radiusKm * NM_PER_KM;
      const withinAltBand =
        airspace.flMin === undefined && airspace.flMax === undefined
          ? true
          : (airspace.flMin === undefined || pointFl >= airspace.flMin) &&
            (airspace.flMax === undefined || pointFl <= airspace.flMax);
      return { notice, airspace, withinRadius, withinAltBand };
    })
    .filter((match) => match.airspace.active && match.withinRadius);
}
