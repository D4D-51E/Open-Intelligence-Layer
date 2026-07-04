import type { Briefing, LiveSourceStatus, SatellitePass, ShipTrack, TimelineEvent, Track } from './types';

export function generatedByLabel(value: Briefing['generatedBy']) {
  return value === 'openai-precomputed' ? 'OpenAI 사전 생성' : '규칙 기반 템플릿';
}

export function eventTypeLabel(value: TimelineEvent['type']) {
  const labels: Record<TimelineEvent['type'], string> = {
    track: '항적',
    ship: '선박',
    weather: '기상',
    osint: 'OSINT',
    'osint-event': 'OSINT 이벤트',
    satellite: '위성',
    'satellite-scene': '위성 장면',
    thermal: '열 이상',
    airport: '공항',
    route: '항로',
    notice: '공지',
    airspace: '공역',
    fusion: '융합',
    anomaly: '이상신호',
    claim: '주장',
    evidence: '근거',
  };
  return labels[value];
}

export function platformTypeLabel(value: Track['platformType']) {
  const labels: Record<Track['platformType'], string> = {
    commercial: '민항기',
    cargo: '화물기',
    unknown: '미식별',
  };
  return labels[value];
}

export function vesselTypeLabel(value: ShipTrack['vesselType']) {
  const labels: Record<ShipTrack['vesselType'], string> = {
    cargo: '화물선',
    tanker: '탱커',
    fishing: '어선',
    unknown: '미식별 선박',
  };
  return labels[value];
}

export function roleHintLabel(value: SatellitePass['roleHint']) {
  const labels: Record<SatellitePass['roleHint'], string> = {
    'public orbital awareness': '공개 궤도 인식',
    weather: '기상',
    communications: '통신',
    'earth observation': '지구관측',
  };
  return labels[value];
}

export function sourceStatusLabel(value: LiveSourceStatus) {
  if (value === 'live') return '라이브';
  if (value === 'cached') return '캐시 정상';
  if (value === 'standby') return '대기';
  if (value === 'empty') return '연결됨 · 수신 0';
  if (value === 'rate-limited') return '레이트리밋';
  if (value === 'unsupported') return '미지원';
  if (value === 'disabled') return '비활성';
  return '사용 불가';
}

export function sourceStatusIsOperational(value: LiveSourceStatus) {
  return value === 'live' || value === 'cached' || value === 'standby';
}
