import type { Track } from './types';
import { resolveOperator, type OperatorDb } from './callsignDb';

export type AircraftIdentity = {
  callsign: string;
  icao24?: string;
  registration?: string;
  callsignProgram?: string;
  operatorCandidates: string[];
  registrationCountry?: string;
  militaryLikely: boolean;
  typeCandidate?: string;
  notes: string[];
};

type CallsignProgram = {
  program: string;
  operator: string;
  operatorKo?: string;
};

// Well-known military/special-use callsign prefixes. Matching is a naming-convention
// heuristic only — it is NOT a verified operator lookup (no tail-number registry access).
const CALLSIGN_PROGRAMS: Record<string, CallsignProgram> = {
  RCH: { program: 'USAF Reach (AMC 수송)', operator: 'USAF', operatorKo: '미 공군' },
  REACH: { program: 'USAF Reach (AMC 수송)', operator: 'USAF', operatorKo: '미 공군' },
  KING: { program: 'USAF King (탐색구조)', operator: 'USAF', operatorKo: '미 공군' },
  FORTE: { program: 'USAF Forte (RQ-4 Global Hawk)', operator: 'USAF', operatorKo: '미 공군' },
  DUKE: { program: 'USAF Duke (테스트파일럿학교)', operator: 'USAF', operatorKo: '미 공군' },
  EVAC: { program: 'USAF Evac (의무후송)', operator: 'USAF', operatorKo: '미 공군' },
  SAM: { program: 'USAF Special Air Mission (VIP 수송)', operator: 'USAF', operatorKo: '미 공군' },
  SPAR: { program: 'USAF Special Air Mission (VIP 수송)', operator: 'USAF', operatorKo: '미 공군' },
  EXEC: { program: 'USAF Special Air Mission (행정 수송)', operator: 'USAF', operatorKo: '미 공군' },
  NAVY: { program: 'US Navy 항공대', operator: 'US Navy', operatorKo: '미 해군' },
  ARMY: { program: 'US Army 항공대', operator: 'US Army', operatorKo: '미 육군' },
  NATO: { program: 'NATO E-3 AWACS', operator: 'NATO', operatorKo: 'NATO 연합' },
  PLF: { program: 'Polish Air Force', operator: 'Polish AF', operatorKo: '폴란드 공군' },
  CFC: { program: 'Canadian Forces', operator: 'RCAF', operatorKo: '캐나다 공군' },
  RRR: { program: 'RAF Ascot (수송)', operator: 'RAF', operatorKo: '영국 공군' },
  ASCOT: { program: 'RAF Ascot (수송)', operator: 'RAF', operatorKo: '영국 공군' },
  BAF: { program: 'Belgian Air Force', operator: 'Belgian AF', operatorKo: '벨기에 공군' },
  GAF: { program: 'German Air Force', operator: 'German AF', operatorKo: '독일 공군' },
  FAF: { program: 'French Air Force', operator: 'French AF', operatorKo: '프랑스 공군' },
  IAM: { program: 'Italian Air Force', operator: 'Italian AF', operatorKo: '이탈리아 공군' },
  HAF: { program: 'Hellenic Air Force', operator: 'Hellenic AF', operatorKo: '그리스 공군' },
};

const CALLSIGN_PREFIXES_BY_LENGTH = Object.keys(CALLSIGN_PROGRAMS).sort((a, b) => b.length - a.length);

function matchCallsignProgram(callsign: string): CallsignProgram | undefined {
  const alphaPrefix = callsign.toUpperCase().match(/^[A-Z]+/)?.[0] ?? '';
  const prefix = CALLSIGN_PREFIXES_BY_LENGTH.find((candidate) => alphaPrefix.startsWith(candidate));
  return prefix ? CALLSIGN_PROGRAMS[prefix] : undefined;
}

type HexBlock = {
  start: number;
  end: number;
  country: string;
  militaryBlock?: boolean;
};

// Compact ICAO 24-bit address (Mode S / ADS-B "icao24") allocation blocks, per the
// broad country ranges in ICAO Annex 10 Vol III / Doc 9871. Simplified to whole
// blocks for demo purposes — edge addresses, sub-allocations, and reassignments are
// NOT modeled. Treat as a rough registration-country heuristic, not authoritative.
const HEX_ALLOCATION_BLOCKS: HexBlock[] = [
  // US DoD sub-range within the wider US civil block (approximate boundary).
  { start: 0xadf7c8, end: 0xafffff, country: '미국 (US)', militaryBlock: true },
  { start: 0xa00000, end: 0xafffff, country: '미국 (US)' },
  { start: 0x400000, end: 0x43ffff, country: '영국 (UK)' },
  { start: 0x718000, end: 0x71ffff, country: '대한민국 (South Korea)' },
  { start: 0x840000, end: 0x87ffff, country: '일본 (Japan)' },
  { start: 0x780000, end: 0x7bffff, country: '중국 (China)' },
  { start: 0x899000, end: 0x89ffff, country: '대만 (Taiwan)' },
  { start: 0x380000, end: 0x3affff, country: '프랑스 (France)' },
  { start: 0x3c0000, end: 0x3fffff, country: '독일 (Germany)' },
  { start: 0xc00000, end: 0xc3ffff, country: '캐나다 (Canada)' },
  { start: 0x7c0000, end: 0x7fffff, country: '호주 (Australia)' },
];

function parseIcao24(icao24: string): number | undefined {
  const cleaned = icao24.trim().toUpperCase();
  if (!/^[0-9A-F]{1,6}$/.test(cleaned)) return undefined;
  return parseInt(cleaned, 16);
}

function lookupHexAllocation(icao24: string): HexBlock | undefined {
  const value = parseIcao24(icao24);
  if (value === undefined) return undefined;
  return HEX_ALLOCATION_BLOCKS.find((block) => value >= block.start && value <= block.end);
}

// Small ICAO type-designator → human-readable name map. Anything absent falls back
// to the raw broadcast code, since ADS-B type codes are only a coarse hint.
const TYPE_CODE_NAMES: Record<string, string> = {
  C17: 'Boeing C-17 Globemaster III',
  C130: 'Lockheed C-130 Hercules',
  B738: 'Boeing 737-800',
  A320: 'Airbus A320',
  E3TF: 'Boeing E-3 Sentry',
  RQ4: 'RQ-4 Global Hawk',
  F16: 'General Dynamics F-16',
  F15: 'Boeing F-15',
  F18: 'Boeing F/A-18',
  F22: 'Lockheed F-22',
  F35: 'Lockheed F-35',
  A10: 'Fairchild A-10',
  B52: 'Boeing B-52',
  B1: 'Rockwell B-1',
  KC135: 'Boeing KC-135',
  KC46: 'Boeing KC-46',
  C5M: 'Lockheed C-5M',
  C5: 'Lockheed C-5',
  P8: 'Boeing P-8 Poseidon',
  E8: 'Boeing E-8 JSTARS',
  E2: 'Northrop E-2 Hawkeye',
  U2: 'Lockheed U-2',
  RC135: 'Boeing RC-135',
  MQ9: 'GA MQ-9 Reaper',
  KC10: 'McDonnell KC-10',
  C27J: 'Leonardo C-27J',
  A400: 'Airbus A400M',
  H60: 'Sikorsky UH-60',
  UH60: 'Sikorsky UH-60',
  CH47: 'Boeing CH-47',
  V22: 'Bell-Boeing V-22 Osprey',
  E7: 'Boeing E-7 Wedgetail',
};

function buildTypeCandidate(typeCode: string | undefined, notes: string[]): string | undefined {
  if (!typeCode) return undefined;
  const known = TYPE_CODE_NAMES[typeCode.toUpperCase()];
  if (known) return known;
  notes.push(`기종코드 "${typeCode}" 미등록 — ADS-B 원본 코드 그대로 표기`);
  return `${typeCode} (ADS-B 방송 기종코드)`;
}

function dedupe(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

export function buildAircraftIdentity(track: Track, operatorDb?: OperatorDb): AircraftIdentity {
  const notes: string[] = [];
  // Primary source: the community ICAO operator dataset (data-driven). The hardcoded
  // CALLSIGN_PROGRAMS table is only an offline fallback when the dataset is unavailable
  // or has no entry for this prefix.
  const dbMatch = operatorDb ? resolveOperator(track.callsign, operatorDb) : null;
  const callsignMatch = dbMatch ? undefined : matchCallsignProgram(track.callsign);
  const hexBlock = track.icao24 ? lookupHexAllocation(track.icao24) : undefined;

  const operatorCandidates: string[] = [];
  let callsignProgram: string | undefined;

  if (dbMatch) {
    const { entry, prefix } = dbMatch;
    callsignProgram = entry.telephony ? `${entry.name} (${entry.telephony})` : entry.name;
    operatorCandidates.push(entry.country ? `${entry.name} · ${entry.country}` : entry.name);
    notes.push(`ICAO 운영자 데이터셋 매칭: "${track.callsign}" 프리픽스 ${prefix} → ${entry.name}${entry.military ? ' (군용 운영자)' : ''}`);
  } else if (callsignMatch) {
    callsignProgram = callsignMatch.program;
    operatorCandidates.push(callsignMatch.operator);
    if (callsignMatch.operatorKo) operatorCandidates.push(callsignMatch.operatorKo);
    notes.push(`콜사인 프리픽스 오프라인 폴백(휴리스틱): "${track.callsign}" → ${callsignMatch.program}`);
  }

  if (hexBlock) {
    notes.push(`ICAO24(${track.icao24}) 등록국 추정: ${hexBlock.country} (대역 매칭 휴리스틱)`);
    if (hexBlock.militaryBlock) {
      operatorCandidates.push(`${hexBlock.country} 군용 대역 추정`);
    }
  }
  if (track.isMilitary && operatorCandidates.length === 0) {
    operatorCandidates.push(track.originCountry ? `${track.originCountry} 군용 추정` : '군용 추정');
  }
  if (operatorCandidates.length === 0) {
    notes.push('운용자 후보 식별 불가 — 데이터셋/콜사인/ICAO24 매칭 없음');
  }

  const militaryLikely = Boolean(track.isMilitary)
    || Boolean(dbMatch?.entry.military)
    || Boolean(callsignMatch)
    || Boolean(hexBlock?.militaryBlock);
  const typeCandidate = buildTypeCandidate(track.typeCode, notes);

  return {
    callsign: track.callsign,
    icao24: track.icao24,
    registration: track.registration,
    callsignProgram,
    operatorCandidates: dedupe(operatorCandidates),
    registrationCountry: hexBlock?.country ?? (dbMatch?.entry.country || undefined),
    militaryLikely,
    typeCandidate,
    notes,
  };
}
