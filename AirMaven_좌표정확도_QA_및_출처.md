# AirMaven Lite 좌표 정확도 QA 및 출처 문서

작성일: 2026-06-30  
대상: `AirMaven Lite` Maven-style Air ISR Fusion Copilot prototype

## 1. 결론

AirMaven Lite의 지도 좌표는 다음 세 레이어로 분리한다.

1. **파란 AOI bounding box**
   - 실제 공개 데이터 수집 범위.
   - 출처 기반 좌표를 사용한다.
   - 앱 내부 형식은 `[minLon, minLat, maxLon, maxLat]`.

2. **보라색 dashed reference line**
   - 서해/NLL AOI에서만 표시한다.
   - ArcGIS Online 공개 `Korea Northern Limit Line` Feature Service의 LineString 좌표를 사용한다.
   - 앱에서는 공식 작전 경계가 아니라 `public reference layer`로만 취급한다.

3. **노란/주황 synthetic watch cell**
   - anomaly scoring 데모용 가상 구역.
   - 공식 경계, 방공식별구역, NLL, 군사분계선으로 설명하면 안 된다.

발표 시 권장 문구:

> 파란 박스는 공개 데이터 수집을 위한 출처 기반 AOI bounding box입니다.  
> 보라색 선은 공개 ArcGIS Feature Service에서 가져온 NLL reference overlay입니다.  
> 노란/주황 박스는 이상징후 탐지 데모를 위한 synthetic review cell이며 공식 경계가 아닙니다.

## 2. 적용된 AOI bounding box

| AOI | 앱 내부 bbox `[minLon, minLat, maxLon, maxLat]` | 중심점 `[lat, lon]` | 출처 |
|---|---:|---:|---|
| 대만해협 | `[118.4271213, 23.4204107, 120.7974216, 25.5523561]` | `[24.4917388, 119.6054017]` | OpenStreetMap Nominatim `Taiwan Strait`, OSM way `1087698081` |
| 수도권 상공 | `[124.3727348, 36.8544193, 127.8481129, 38.2811104]` | `[37.5665, 126.978]` | OSM/Nominatim Seoul + Incheon + Gyeonggi-do 행정 bbox union |
| 남중국해 | `[102.2384722, -3.2287222, 122.1513056, 25.5672778]` | `[11.1692778, 112.1948889]` | Marine Regions / IHO `South China Sea (IHO Sea Area)` |
| 서해/NLL 인근 | `[123.547708291629, 37.626084840136, 126.688972200141, 38.2047340114075]` | `[37.91540942577175, 125.118340245885]` | ArcGIS Online `Korea Northern Limit Line` Feature Service extent |

## 3. 출처별 세부 내용

### 3.1 대만해협

출처:

- OpenStreetMap Nominatim Search API
- Query: `Taiwan Strait`
- OSM object: `way 1087698081`

Nominatim 원본 응답의 `boundingbox`는 다음 순서다.

```text
[southLat, northLat, westLon, eastLon]
["23.4204107", "25.5523561", "118.4271213", "120.7974216"]
```

앱 내부 형식으로 변환:

```text
[minLon, minLat, maxLon, maxLat]
[118.4271213, 23.4204107, 120.7974216, 25.5523561]
```

출처 URL:

- https://nominatim.openstreetmap.org/search?q=Taiwan%20Strait&format=jsonv2&limit=1
- https://nominatim.org/release-docs/latest/api/Search/

### 3.2 수도권 상공

출처:

- OpenStreetMap Nominatim Search API
- 서울특별시, 인천광역시, 경기도 행정 bbox를 조회한 뒤 union bbox를 사용한다.

원본 bbox:

| 행정구역 | Nominatim bbox `[southLat, northLat, westLon, eastLon]` |
|---|---:|
| Seoul | `[37.4285424, 37.7014794, 126.7644328, 127.1837702]` |
| Incheon | `[36.8544193, 38.0500000, 124.3727348, 126.7936261]` |
| Gyeonggi-do | `[36.8937750, 38.2811104, 126.2779479, 127.8481129]` |

Union 결과:

```text
minLon = 124.3727348
minLat = 36.8544193
maxLon = 127.8481129
maxLat = 38.2811104
```

앱 내부 형식:

```text
[124.3727348, 36.8544193, 127.8481129, 38.2811104]
```

주의:

- 인천 행정구역은 서해 도서 지역을 포함하므로 bbox가 서쪽으로 넓다.
- “서울 시내 상공”이 아니라 “수도권/인천 도서 포함 공개 항적 조회 AOI”로 설명해야 한다.

### 3.3 남중국해

출처:

- Marine Regions Gazetteer
- `South China Sea (IHO Sea Area)`
- Source note: IHO Special Publication 23, 3rd edition, 1953

Marine Regions 페이지에 표기된 원천 좌표:

```text
Min. Lat  3° 13' 43.4" S
Min. Long 102° 14' 18.5" E
Max. Lat  25° 34' 2.2" N
Max. Long 122° 9' 4.7" E
```

DMS를 decimal degree로 변환:

```text
minLat = -(3 + 13/60 + 43.4/3600) = -3.2287222
minLon = 102 + 14/60 + 18.5/3600 = 102.2384722
maxLat = 25 + 34/60 + 2.2/3600 = 25.5672778
maxLon = 122 + 9/60 + 4.7/3600 = 122.1513056
```

앱 내부 형식:

```text
[102.2384722, -3.2287222, 122.1513056, 25.5672778]
```

출처 URL:

- https://marineregions.org/gazetteer.php?id=4332&p=details

주의:

- 이 bbox는 남중국해 IHO sea-area 범위다.
- 영유권 주장선이나 특정 국가의 claim boundary가 아니다.

### 3.4 서해/NLL 인근

출처:

- ArcGIS Online item: `Korea Northern Limit Line`
- Item ID: `87ca87d22e2049faadf3dd948d5f0563`
- Type: Feature Service
- Service URL: `https://services9.arcgis.com/BoQbjA9eARgaPglj/arcgis/rest/services/Korea_Northern_Limit_Line/FeatureServer`

ArcGIS item extent:

```text
[
  [123.54770829162874, 37.62608484013601],
  [126.68897220014071, 38.2047340114075]
]
```

앱 내부 bbox:

```text
[123.547708291629, 37.626084840136, 126.688972200141, 38.2047340114075]
```

출처 URL:

- https://www.arcgis.com/home/item.html?id=87ca87d22e2049faadf3dd948d5f0563&sublayer=0
- https://www.arcgis.com/sharing/rest/content/items/87ca87d22e2049faadf3dd948d5f0563?f=json

주의:

- 공개 ArcGIS 레이어이며, 정부 공식 작전 경계로 보증하지 않는다.
- 앱에서는 `public reference layer`로 표기한다.

## 4. NLL reference LineString

서해/NLL AOI에서는 bbox만 표시하지 않고, ArcGIS Feature Service에서 가져온 LineString 좌표를 보라색 dashed line으로 표시한다.

Feature Service query:

```text
https://services9.arcgis.com/BoQbjA9eARgaPglj/arcgis/rest/services/Korea_Northern_Limit_Line/FeatureServer/0/query?f=geojson&where=1%3D1&outFields=*&returnGeometry=true
```

앱에 반영된 좌표 형식은 Leaflet용 `[lat, lon]`이다.

```text
[38.2047340114075, 123.547708291629]
[38.0129257131588, 124.854407764646]
[37.7940747871476, 124.87237269524]
[37.6684392460398, 125.081289371552]
[37.626084840136, 125.250231102965]
[37.6984204547133, 125.495315586566]
[37.6984204547133, 125.700425125269]
[37.7545757344508, 125.775616093053]
[37.6965168859086, 126.052585354131]
[37.7298293399902, 126.116830801289]
[37.735064154203, 126.1620405604]
[37.7802739133138, 126.186256755217]
[37.8249482936983, 126.193092526526]
[37.8333350385665, 126.233922926362]
[37.8301831079111, 126.27637366173]
[37.8297072157099, 126.312065576817]
[37.8487429037566, 126.373455670768]
[37.8496946881589, 126.384877083596]
[37.8511223647624, 126.398677957429]
[37.8416045207391, 126.43151451931]
[37.8282795391064, 126.455785021569]
[37.812575096468, 126.466254649995]
[37.7792626423863, 126.553342922808]
[37.7630823075467, 126.576661640666]
[37.7673653373572, 126.606642849339]
[37.7825938877945, 126.630437459397]
[37.7844974565992, 126.663749913479]
[37.8211411560889, 126.666605266686]
[37.8344661377216, 126.672791865301]
[37.8358938143251, 126.681833817123]
[37.8392250597333, 126.688972200141]
[37.8420804129402, 126.688020415738]
```

## 5. 코드 반영 위치

| 목적 | 파일 |
|---|---|
| AOI bbox/center/source metadata | `src/lib/regions.ts` |
| live API 수집 bbox/center | `scripts/fetch-live-data.mjs` |
| NLL reference line 좌표 | `src/lib/demoData.ts` |
| reference line 타입 | `src/lib/types.ts` |
| 지도 렌더링 | `src/components/SituationMap.tsx` |
| bbox 출처/QA 요약 | `README.md` |

중요한 구현 규칙:

- OpenSky API는 `[minLon, minLat, maxLon, maxLat]` bbox를 받아 `lamin/lomin/lamax/lomax`로 변환한다.
- Leaflet 렌더링은 `[lat, lon]` 순서를 사용한다.
- Nominatim 원본 bbox는 `[southLat, northLat, westLon, eastLon]` 순서라 앱 내부 형식으로 변환해야 한다.
- ArcGIS GeoJSON LineString은 `[lon, lat]` 순서라 Leaflet용 `[lat, lon]`으로 변환해야 한다.

## 6. QA 기준

좌표 QA는 다음 조건을 만족해야 통과한다.

1. `src/lib/regions.ts`와 `scripts/fetch-live-data.mjs`의 bbox/center가 일치한다.
2. bbox 순서가 `[minLon, minLat, maxLon, maxLat]`이고 유효 범위 안에 있다.
3. center가 bbox 내부에 있다.
4. live OpenSky track point가 해당 AOI bbox 내부에 있다.
5. synthetic watch zone vertex가 source-backed AOI 내부에 있다.
6. NLL reference line 좌표가 ArcGIS source extent 안에 있다.
7. 위성 마커는 CelesTrak GP + SGP4 propagation 결과여야 하며, 임의 `AOI center + offset` 좌표를 쓰면 안 된다.

최근 QA 결과:

```text
failures 0
```

검증 명령:

```bash
npm run fetch:live
npm run build
npm run lint
npm test
npm run typecheck
npm audit --audit-level=high
```

최근 검증 결과:

```text
build: pass
lint: pass
test: 3 passed
typecheck: pass
audit --audit-level=high: found 0 vulnerabilities
```

## 7. 데모 URL

기본 live map:

```text
http://localhost:5173/?basemap=live
```

서해/NLL reference line 직접 확인:

```text
http://localhost:5173/?basemap=live&region=west-sea-nll
```

Vite가 다른 포트를 배정하면 `5173` 대신 출력된 포트를 사용한다.

## 8. 발표 시 주의 문구

정확도 관련 질문을 받으면 다음처럼 답한다.

> 현재 파란 AOI 박스는 임의로 그린 것이 아니라 OSM/Nominatim, Marine Regions/IHO, ArcGIS 공개 Feature Service 기반 좌표로 교체했습니다.  
> 서해/NLL은 박스로만 표현하지 않고 공개 ArcGIS LineString도 별도 reference overlay로 표시합니다.  
> 다만 NLL은 민감한 경계이므로 공식 작전 경계라고 주장하지 않고 public reference layer로 표기합니다.  
> 노란/주황 watch cell은 실제 경계가 아니라 anomaly scoring 데모용 synthetic cell입니다.

## 9. 잔여 리스크

- Nominatim/OSM 데이터는 커뮤니티 기반 공개 데이터다. 좌표 품질은 좋지만 법적/군사적 공식성을 보장하지 않는다.
- Marine Regions/IHO sea-area bbox는 해역 정의에 적합하지만 영유권 claim boundary가 아니다.
- ArcGIS NLL Feature Service는 공개 레이어지만 출처 기관/라이선스 정보가 제한적이다. 따라서 공식 경계가 아니라 public reference layer로 표기한다.
- OpenSky 항적은 ADS-B 공개 데이터라 민감 항공기나 군용기는 누락될 수 있다.
- 해커톤 데모 목적상 synthetic watch cell은 유지한다. 이 cell은 실제 군사 판단에 쓰면 안 된다.
