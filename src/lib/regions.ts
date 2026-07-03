import type { Region, RegionId } from './types';

export const regions: Region[] = [
  {
    id: 'global',
    name: '전세계 공개 OSINT 상황권역',
    shortName: 'Global',
    description: '전세계 공개 뉴스/OSINT 핫스팟과 공개 위성 궤도 보조 레이어를 한 화면에 배치하는 글로벌 상황판입니다. 상세 항적·AIS는 선택한 AOI에서만 수집합니다.',
    bbox: [-180, -60, 180, 82],
    center: [20, 20],
    zoom: 2,
    bboxSource: 'Global review canvas for public OSINT triage',
    bboxSourceUrl: 'https://www.openstreetmap.org/',
    bboxNote: '전세계 검토용 화면 범위입니다. 기사 본문 자동 지오코딩 또는 정확 사건 좌표가 아닙니다.',
  },
  {
    id: 'taiwan-strait',
    name: '대만해협 공중 ISR 관심지역',
    shortName: '대만해협',
    description: '공개 항적, 뉴스/OSINT, 기상, 위성궤도 보조 레이어를 결합해 대만해협 주변 공중 상황을 설명하는 출처 기반 AOI입니다.',
    bbox: [118.4271213, 23.4204107, 120.7974216, 25.5523561],
    center: [24.4917388, 119.6054017],
    zoom: 7,
    bboxSource: 'OpenStreetMap Nominatim search result: Taiwan Strait, OSM way 1087698081',
    bboxSourceUrl: 'https://nominatim.openstreetmap.org/search?q=Taiwan%20Strait&format=jsonv2&limit=1',
    bboxNote: '출처 기반 지리 bbox입니다. 정치·군사 경계가 아닙니다.',
  },
  {
    id: 'seoul-airspace',
    name: '수도권 공역 관심지역',
    shortName: '수도권 상공',
    description: '서울·인천·경기도 행정 bbox를 합친 출처 기반 수도권 AOI입니다. 실제 안보 판단이 아닌 공개 항공 활동 모니터링 용도입니다.',
    bbox: [124.3727348, 36.8544193, 127.8481129, 38.2811104],
    center: [37.5665, 126.978],
    zoom: 7,
    bboxSource: 'OpenStreetMap Nominatim administrative bboxes: Seoul relation 2297418, Incheon relation 2297419, Gyeonggi-do relation 2306392',
    bboxSourceUrl: 'https://nominatim.openstreetmap.org/search?q=Seoul%2C%20South%20Korea&format=jsonv2&limit=1',
    bboxNote: '서울·인천·경기도 bbox를 합친 범위입니다. 인천 도서 지역을 포함합니다.',
  },
  {
    id: 'south-china-sea',
    name: '남중국해 항공·해상 관심지역',
    shortName: '남중국해',
    description: 'Marine Regions/IHO 기반 남중국해 bbox를 사용해 넓은 해상 AOI에서 항적·뉴스·기상 신호를 보여주는 관심지역입니다.',
    bbox: [102.2384722, -3.2287222, 122.1513056, 25.5672778],
    center: [11.1692778, 112.1948889],
    zoom: 5,
    bboxSource: 'Marine Regions Gazetteer, South China Sea / IHO Sea Area',
    bboxSourceUrl: 'https://marineregions.org/gazetteer.php?id=4332&p=details',
    bboxNote: 'Marine Regions/IHO 해역 bbox입니다. 영유권 주장 경계가 아닙니다.',
  },
  {
    id: 'west-sea-nll',
    name: '서해/NLL 인근 관심지역',
    shortName: '서해/NLL 인근',
    description: 'ArcGIS 공개 Korea Northern Limit Line 레이어의 extent를 사용한 서해/NLL 인접 AOI입니다. 공개 reference layer일 뿐 공식 판정 기준이 아닙니다.',
    bbox: [123.547708291629, 37.626084840136, 126.688972200141, 38.2047340114075],
    center: [37.91540942577175, 125.118340245885],
    zoom: 8,
    bboxSource: 'ArcGIS Online Feature Service: Korea Northern Limit Line, item 87ca87d22e2049faadf3dd948d5f0563',
    bboxSourceUrl: 'https://www.arcgis.com/home/item.html?id=87ca87d22e2049faadf3dd948d5f0563&sublayer=0',
    bboxNote: '공개 참고 레이어 범위입니다. 공식 작전 경계 주장으로 쓰지 않습니다.',
  },
];

export const defaultRegionId: RegionId = 'seoul-airspace';

export function isRegionId(value: string): value is RegionId {
  return regions.some((region) => region.id === value);
}

export function getRegion(regionId: RegionId): Region {
  return regions.find((region) => region.id === regionId) ?? regions[0];
}
