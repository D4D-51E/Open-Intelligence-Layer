import type { ReferenceLine, RegionId, Scenario, TimelineEvent } from './types';
import { getRegion } from './regions';

const referenceLinesByRegion: Record<RegionId, ReferenceLine[]> = {
  global: [],
  'taiwan-strait': [],
  'seoul-airspace': [],
  'south-china-sea': [],
  'west-sea-nll': [
    {
      id: 'ref-nll-arcgis-public',
      regionId: 'west-sea-nll',
      name: 'Korea Northern Limit Line 공개 참고선',
      description: '공개 ArcGIS Feature Service LineString을 참고 오버레이로 표시합니다. 이 프로토타입은 이를 공식 작전 경계로 취급하지 않습니다.',
      source: 'ArcGIS Online Feature Service: Korea Northern Limit Line',
      sourceUrl: 'https://www.arcgis.com/home/item.html?id=87ca87d22e2049faadf3dd948d5f0563&sublayer=0',
      points: [
        [38.2047340114075, 123.547708291629],
        [38.0129257131588, 124.854407764646],
        [37.7940747871476, 124.87237269524],
        [37.6684392460398, 125.081289371552],
        [37.626084840136, 125.250231102965],
        [37.6984204547133, 125.495315586566],
        [37.6984204547133, 125.700425125269],
        [37.7545757344508, 125.775616093053],
        [37.6965168859086, 126.052585354131],
        [37.7298293399902, 126.116830801289],
        [37.735064154203, 126.1620405604],
        [37.7802739133138, 126.186256755217],
        [37.8249482936983, 126.193092526526],
        [37.8333350385665, 126.233922926362],
        [37.8301831079111, 126.27637366173],
        [37.8297072157099, 126.312065576817],
        [37.8487429037566, 126.373455670768],
        [37.8496946881589, 126.384877083596],
        [37.8511223647624, 126.398677957429],
        [37.8416045207391, 126.43151451931],
        [37.8282795391064, 126.455785021569],
        [37.812575096468, 126.466254649995],
        [37.7792626423863, 126.553342922808],
        [37.7630823075467, 126.576661640666],
        [37.7673653373572, 126.606642849339],
        [37.7825938877945, 126.630437459397],
        [37.7844974565992, 126.663749913479],
        [37.8211411560889, 126.666605266686],
        [37.8344661377216, 126.672791865301],
        [37.8358938143251, 126.681833817123],
        [37.8392250597333, 126.688972200141],
        [37.8420804129402, 126.688020415738],
      ],
    },
  ],
};

function emptyTimeline(): TimelineEvent[] {
  return [];
}

export function getScenario(regionId: RegionId): Scenario {
  return {
    region: getRegion(regionId),
    tracks: [],
    ships: [],
    weather: null,
    osint: [],
    osintEvents: [],
    satellites: [],
    satelliteScenes: [],
    thermalAnomalies: [],
    airports: [],
    airRoutes: [],
    notices: [],
    airspaceContexts: [],
    fusionEvents: [],
    watchZones: [],
    referenceLines: referenceLinesByRegion[regionId],
    timeline: emptyTimeline(),
  };
}

export const dataSources = [
  { name: 'OpenSky Network', role: '공개 ADS-B/state-vector 항공기 데이터', url: 'https://openskynetwork.github.io/opensky-api/rest.html', mode: '라이브/캐시만 사용' },
  { name: 'Open-Meteo', role: '기상 위험과 가시거리 맥락', url: 'https://open-meteo.com/en/docs', mode: '라이브 응답 없으면 빈 상태' },
  { name: 'GDELT', role: '뉴스/OSINT 기사와 볼륨 신호', url: 'https://www.gdeltproject.org/data.html', mode: '라이브 기사 목록' },
  { name: 'Google News RSS', role: 'GDELT 실패 시 공개 뉴스 검색 피드', url: 'https://news.google.com/rss', mode: '라이브 RSS' },
  { name: 'CelesTrak', role: '공개 위성 GP/TLE 궤도 인식 + ground track', url: 'https://celestrak.org/NORAD/documentation/gp-data-formats.php', mode: '라이브 응답 없으면 빈 상태' },
  { name: 'OurAirports', role: '공개 공항/비행장 맥락과 공항 연결 참고축', url: 'https://ourairports.com/data/', mode: '라이브 CSV 캐시' },
  { name: 'ICAO FIR by location', role: 'AOI 중심점 기준 FIR 식별', url: 'https://dataservices.icao.int/', mode: '24시간 TTL 캐시' },
  { name: 'AISStream', role: '실시간 AIS 선박 위치 WebSocket', url: 'https://aisstream.io/documentation', mode: '서버 fetch 루프에서 키 사용' },
  { name: 'ICAO NOTAM', role: '공식 NOTAM 공역 공지', url: 'https://dataservices.icao.int/', mode: 'ICAO_NOTAM_ENDPOINT 설정 시 호출' },
];
