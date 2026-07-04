import type { LiveSourceStatus, Scenario } from './types';

export type OsintIntegrationTier = 'public-no-key' | 'free-key' | 'manual' | 'commercial';
export type OsintIntegrationFamily = 'news' | 'official' | 'factcheck' | 'track' | 'satellite' | 'orbit' | 'thermal' | 'weather' | 'airspace' | 'maritime' | 'forensics';

export type OsintSourceCatalogEntry = {
  id: string;
  name: string;
  family: OsintIntegrationFamily;
  tier: OsintIntegrationTier;
  role: string;
  url: string;
  mode: string;
  statusKey?: string;
  verdictUse: string;
  caveat: string;
};

export const osintSourceCatalog: OsintSourceCatalogEntry[] = [
  {
    id: 'gdelt',
    name: 'GDELT DOC 2.0',
    family: 'news',
    tier: 'public-no-key',
    role: '전세계 보도·주장 탐지와 기사 출처 수집',
    url: 'https://www.gdeltproject.org/data.html',
    mode: '라이브 기사 목록 / 실패 시 Google News RSS 대체',
    statusKey: 'gdelt',
    verdictUse: '주장이 언제, 어디서, 어떤 매체를 통해 확산됐는지 확인',
    caveat: '보도량은 사실 여부가 아니라 주장 확산 정도를 보여줍니다.',
  },
  {
    id: 'google-news',
    name: 'Google News RSS',
    family: 'news',
    tier: 'public-no-key',
    role: 'GDELT 장애 또는 제한 시 보도 수집 보조 피드',
    url: 'https://news.google.com/rss',
    mode: '라이브 RSS',
    statusKey: 'googleNews',
    verdictUse: '동일 주장 보도 출처와 시간대 보강',
    caveat: '검색 랭킹과 지역화에 영향을 받습니다.',
  },
  {
    id: 'opensky',
    name: 'OpenSky Network',
    family: 'track',
    tier: 'public-no-key',
    role: '공개 ADS-B 항적/state-vector 확인',
    url: 'https://openskynetwork.github.io/opensky-api/rest.html',
    mode: '라이브/TTL 캐시; OAuth2 선택',
    statusKey: 'opensky',
    verdictUse: '민간·공개 송신 항공기의 존재/동선 맥락 확인',
    caveat: '군용기·스텔스·비송신 항공기는 보이지 않을 수 있어 부재 증명이 아닙니다.',
  },
  {
    id: 'celestrak',
    name: 'CelesTrak GP/TLE',
    family: 'orbit',
    tier: 'public-no-key',
    role: '공개 위성 궤도와 상공 통과 후보 계산',
    url: 'https://celestrak.org/NORAD/documentation/gp-data-formats.php',
    mode: '라이브 GP JSON + satellite.js 전파',
    statusKey: 'celestrak',
    verdictUse: '주장 시각 전후 공개 위성 관측 가능성 후보 제시',
    caveat: '위성 통과 가능성은 실제 촬영·해상도·공개 여부를 보장하지 않습니다.',
  },
  {
    id: 'copernicus-stac',
    name: 'Copernicus Data Space STAC',
    family: 'satellite',
    tier: 'public-no-key',
    role: 'Sentinel 장면 메타데이터, 촬영 시각, 구름량 조회',
    url: 'https://documentation.dataspace.copernicus.eu/APIs/STAC.html',
    mode: '선택 라이브 STAC; 실패 시 공백 근거',
    statusKey: 'copernicusStac',
    verdictUse: '해당 AOI/시간대에 공개 위성 장면이 있었는지 확인',
    caveat: '무료 공개 해상도로 소형 전투기 잔해를 직접 식별하기 어렵습니다.',
  },
  {
    id: 'nasa-firms',
    name: 'NASA FIRMS',
    family: 'thermal',
    tier: 'free-key',
    role: 'VIIRS/MODIS 열 이상 후보로 대형 화재·폭발 보조 확인',
    url: 'https://firms.modaps.eosdis.nasa.gov/api/',
    mode: 'NASA_FIRMS_MAP_KEY 설정 시 수집',
    statusKey: 'nasaFirms',
    verdictUse: '기지 타격·대형 화재 주장에 대한 열 이상 보조 신호 확인',
    caveat: '열 이상은 원인 식별이 아니며 해상도·지연·오탐 한계가 있습니다.',
  },
  {
    id: 'open-meteo',
    name: 'Open-Meteo',
    family: 'weather',
    tier: 'public-no-key',
    role: '구름, 시정, 강수, 돌풍 등 관측 가능성 맥락',
    url: 'https://open-meteo.com/en/docs',
    mode: '라이브 기상 스냅샷',
    statusKey: 'openMeteo',
    verdictUse: '위성/항공 관측 가능성, 영상 신빙성 판단 보조',
    caveat: '격자형 기상 모델이라 현장 관측과 차이가 있을 수 있습니다.',
  },
  {
    id: 'icao-fir',
    name: 'ICAO FIR by location',
    family: 'airspace',
    tier: 'free-key',
    role: '관심 좌표의 비행정보구역 식별',
    url: 'https://dataservices.icao.int/',
    mode: 'ICAO_API_KEY 설정 시 24시간 TTL 캐시',
    statusKey: 'icaoFir',
    verdictUse: '항공 주장과 관련된 공식 공역 맥락 확인',
    caveat: 'FIR 식별은 항공기 임무·소속·행동을 증명하지 않습니다.',
  },
  {
    id: 'icao-notam',
    name: 'ICAO NOTAM',
    family: 'airspace',
    tier: 'free-key',
    role: '공역 폐쇄·위험구역·항행 공지 확인',
    url: 'https://dataservices.icao.int/',
    mode: 'ICAO_NOTAM_ENDPOINT 설정 시 호출',
    statusKey: 'notices',
    verdictUse: '공역 폐쇄/위험구역 주장과 공식 공지 교차 확인',
    caveat: 'API 계약과 endpoint 형식이 기관 계정에 따라 달라질 수 있습니다.',
  },
  {
    id: 'aisstream',
    name: 'AISStream',
    family: 'maritime',
    tier: 'free-key',
    role: '해상 구조·항모전단·항만 활동 주변 AIS 맥락',
    url: 'https://aisstream.io/documentation',
    mode: 'AISSTREAM_API_KEY 설정 시 서버 WebSocket 수집',
    statusKey: 'ais',
    verdictUse: '기지/해협/해상 사건 주변 선박 활동 맥락 확인',
    caveat: '군함은 AIS를 끄거나 위장할 수 있어 보조 맥락으로만 사용합니다.',
  },
  {
    id: 'official-statements',
    name: '공식 발표 URL',
    family: 'official',
    tier: 'manual',
    role: 'CENTCOM/국방부/정부 발표 링크 수동 등록',
    url: 'https://www.defense.gov/News/Releases/',
    mode: '분석관 URL 등록 / 데모 시드 근거',
    verdictUse: '주장에 대한 공식 확인·부인·정정 발표 반영',
    caveat: '공식 발표도 지연·부분 공개·정치적 표현 가능성이 있어 단독 확증은 피합니다.',
  },
  {
    id: 'factchecks',
    name: '팩트체크 기사',
    family: 'factcheck',
    tier: 'manual',
    role: 'AFP/Reuters/BOOM 등 팩트체크 링크 수동 등록',
    url: 'https://factcheck.afp.com/',
    mode: '분석관 URL 등록 / 데모 시드 근거',
    verdictUse: '조작 영상, 과거 사진 재사용, 허위 주장 반박 여부 확인',
    caveat: '팩트체크 범위가 특정 영상·사진에 한정될 수 있습니다.',
  },
  {
    id: 'media-forensics',
    name: '미디어 포렌식 체크리스트',
    family: 'forensics',
    tier: 'manual',
    role: '키프레임, EXIF, 역이미지 검색, 생성형 영상 의심 신호 기록',
    url: 'https://support.google.com/websearch/answer/1325808',
    mode: '수동 체크리스트',
    verdictUse: '소셜 영상/이미지 증거의 재사용·생성 가능성 표시',
    caveat: 'AI 탐지기는 보조 신호이며 단독 판정 근거로 쓰지 않습니다.',
  },
  {
    id: 'commercial-imagery',
    name: 'Planet/Maxar 고해상도 이미지',
    family: 'satellite',
    tier: 'commercial',
    role: '고해상도 피해 확인 또는 tasking 후보',
    url: 'https://www.planet.com/products/high-resolution-satellite-imagery/',
    mode: '유료/파트너십; MVP는 tasking 필요성만 표시',
    verdictUse: '무료 공개 영상으로 불충분할 때 다음 수집 요구로 제시',
    caveat: '실시간 무료 자동 조회 대상이 아니므로 제품 내에서는 공백/다음 확인으로 표시합니다.',
  },
];

export function sourceStatusForCatalogEntry(entry: OsintSourceCatalogEntry, scenario: Scenario): LiveSourceStatus | 'manual' | 'commercial-ready' {
  if (entry.tier === 'manual') return 'manual';
  if (entry.tier === 'commercial') return 'commercial-ready';
  if (!entry.statusKey) return 'standby';
  return scenario.sourceStatus?.[entry.statusKey] ?? 'standby';
}

export function implementedSourceCount(scenario: Scenario) {
  return osintSourceCatalog.filter((entry) => {
    const status = sourceStatusForCatalogEntry(entry, scenario);
    return status === 'live' || status === 'cached' || status === 'standby' || status === 'manual' || status === 'commercial-ready';
  }).length;
}
