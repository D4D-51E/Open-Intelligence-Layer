import type { QueryIntent, QueryModule, RegionId } from './types';

const allModules: QueryModule[] = ['tracks', 'ships', 'weather', 'osint', 'satellites', 'airspace', 'notices', 'fusion'];

const regionPatterns: Array<{ id: RegionId; patterns: RegExp[] }> = [
  { id: 'global', patterns: [/전세계|글로벌|세계|global|worldwide|world/i] },
  { id: 'taiwan-strait', patterns: [/대만|타이완|taiwan|strait/i] },
  { id: 'seoul-airspace', patterns: [/수도권|서울|인천|경기|seoul|incheon/i] },
  { id: 'south-china-sea', patterns: [/남중국해|south china|spratly|paracel/i] },
  { id: 'west-sea-nll', patterns: [/서해|nll|연평|백령|yellow sea|west sea/i] },
];

const modulePatterns: Array<{ module: QueryModule; patterns: RegExp[] }> = [
  { module: 'tracks', patterns: [/항적|항공|항공기|비행|ads-b|opensky|track|aircraft|flight/i] },
  { module: 'ships', patterns: [/선박|해상|ais|ship|vessel|maritime/i] },
  { module: 'weather', patterns: [/기상|날씨|시정|운량|풍속|weather|visibility|wind/i] },
  { module: 'osint', patterns: [/뉴스|osint|기사|보도|위협|intel|news/i] },
  { module: 'satellites', patterns: [/위성|궤도|celestrak|satellite|orbit/i] },
  { module: 'airspace', patterns: [/공역|fir|icao|관제|airspace/i] },
  { module: 'notices', patterns: [/notam|공지|고시|notice/i] },
  { module: 'fusion', patterns: [/융합|요약|브리핑|상황|관계|fusion|summary|brief/i] },
];

export const demoQueries = [
  '전세계 공개 OSINT 핫스팟과 위성 레이어를 요약해줘',
  '대만해협에서 최근 공개 항적과 OSINT를 융합 요약해줘',
  '수도권 상공의 이상신호와 기상 위험을 확인해줘',
  '남중국해에서 항공·해상 활동과 FIR 맥락을 비교해줘',
  '서해 NLL 인근 데이터 공백과 신뢰도 한계를 설명해줘',
];

function inferRegion(raw: string): RegionId | undefined {
  return regionPatterns.find((entry) => entry.patterns.some((pattern) => pattern.test(raw)))?.id;
}

function inferModules(raw: string): QueryModule[] {
  const modules = modulePatterns
    .filter((entry) => entry.patterns.some((pattern) => pattern.test(raw)))
    .map((entry) => entry.module);
  if (modules.length === 0) return allModules;
  if (!modules.includes('fusion')) modules.push('fusion');
  return [...new Set(modules)];
}

function inferFocus(raw: string): QueryIntent['focus'] {
  if (/공백|한계|정확|신뢰|출처|citation|품질|quality/i.test(raw)) return 'data-quality';
  if (/이상|경고|관찰|위험|anomaly|risk|alert/i.test(raw)) return 'anomaly';
  if (/증가|감소|활동|activity|spike|trend/i.test(raw)) return 'activity';
  return 'overview';
}

export function parseAnalystQuery(raw: string, fallbackRegionId: RegionId): QueryIntent {
  const normalized = raw.trim();
  return {
    raw: normalized,
    regionId: inferRegion(normalized) ?? fallbackRegionId,
    modules: inferModules(normalized),
    focus: inferFocus(normalized),
  };
}
