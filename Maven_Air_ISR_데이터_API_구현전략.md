# Maven-style Air ISR Fusion Copilot 데이터/API 구현 전략

> 작성일: 2026-06-29  
> 목적: D4D 해커톤 T2 백업/대안 프로젝트인 **Maven형 공중 ISR 융합 코파일럿**을 사전에 프로토타입화하기 위한 기능 범위, 데이터 소스, 무료/공개 API, 오픈소스 도구, 현실적 구현 전략을 정리한다.

---

## 0. 최종 제품 정의

**Maven-style Air ISR Fusion Copilot**은 공개 항적·기상·뉴스/OSINT·위성궤도 데이터와 synthetic 작전 이벤트를 융합해 특정 지역의 공중·우주 상황을 지도와 타임라인으로 보여주고, 이상징후를 AI 브리핑과 citation으로 설명하는 분석관 보조 시스템이다.

핵심 포지셔닝:

> “타격 자동화”가 아니라 **공개 데이터 기반 분석관 의사결정 보조 시스템**이다.

---

## 1. 해커톤 MVP 범위

24시간 해커톤에서 완성도 높게 보이려면 아래 4가지를 핵심으로 잡는다.

### 반드시 만들 것

1. **지역 선택**
   - 서해/NLL 인근
   - 대만해협
   - 남중국해
   - 수도권 상공

2. **지도 + 타임라인**
   - 공개 항적
   - 기상 레이어
   - 뉴스/OSINT 이벤트
   - synthetic 군사/안보 이벤트
   - 위성궤도 보조 레이어

3. **이상징후 탐지 3개**
   - 특정 구역 접근
   - 평소 항로 이탈 또는 급격한 우회
   - 뉴스 이벤트 직후 항적/활동 증가

4. **AI 브리핑 + citation**
   - 현재 상황 요약
   - 이상징후 목록
   - 근거 출처
   - 신뢰도
   - 추가 확인 필요사항

### 과감히 줄일 것

- 정밀 공중전/ISR 판정 모델
- 실제 군사 데이터
- 실제 표적 지정/타격 추천
- 위성 영상 분석
- 완전한 실시간 데이터 파이프라인
- 고정밀 궤도/관측 가능성 계산

---

## 2. 기능별 데이터/API 매핑 요약

| 기능 | 1차 데이터/API | 백업 데이터/API | 구현 현실성 | 메모 |
|---|---|---|---:|---|
| 항적 표시 | OpenSky Network REST API | ADSB.lol, Airplanes.live, cached sample | 높음 | OpenSky는 실제 샘플 호출 성공. rate/credit 관리 필요 |
| 기상 레이어 | Open-Meteo | cached Open-Meteo JSON | 매우 높음 | API key 불필요, 무료 비상업 한도 존재 |
| 뉴스/OSINT | GDELT DOC 2.0 API | GDELT raw/BigQuery, ReliefWeb, 수동 RSS/cache | 중상 | GDELT는 무료/open이지만 rate limit 주의 |
| 위성궤도 | CelesTrak GP/TLE | cached CelesTrak JSON/TLE | 높음 | 정밀 ISR 판정보다 “우주 상황 보조 레이어”로 사용 |
| 공항/기지성 객체 | OurAirports CSV | synthetic points | 높음 | 공항 위치/활주로/주파수 등 공개 CSV |
| 국가/해안선/지도 배경 | Natural Earth | MapLibre/Leaflet 기본 지도 | 높음 | Natural Earth는 public domain |
| 구역/ADIZ/주의구역 | synthetic GeoJSON | 수동 AOI polygon | 높음 | 민감/분쟁 경계는 synthetic 처리 추천 |
| 공간 연산 | Turf.js | 직접 point-in-polygon | 높음 | 구역 접근/거리/버퍼 계산 |
| 지도 시각화 | Leaflet 또는 MapLibre GL JS | deck.gl 보조 | 높음 | 2D 지도면 Leaflet, 고급 레이어면 MapLibre/deck.gl |

---

## 3. 데이터 소스 상세

### 3.1 항적 데이터

#### 1순위: OpenSky Network REST API

- 공식 문서: https://openskynetwork.github.io/opensky-api/rest.html
- Root URL: `https://opensky-network.org/api`
- 핵심 엔드포인트: `GET /states/all`
- bounding box 파라미터:
  - `lamin`: lower latitude
  - `lomin`: lower longitude
  - `lamax`: upper latitude
  - `lomax`: upper longitude

예시:

```bash
curl "https://opensky-network.org/api/states/all?lamin=33&lomin=124&lamax=39&lomax=132"
```

해커톤 사용 방식:

- 지역별 bbox를 미리 정의한다.
- 30~60초마다 최신 state vector를 가져온다.
- 지도에는 현재 위치, 고도, 속도, 방위, 호출부호만 표시한다.
- 과거 항적은 실시간 API에 의존하지 말고, 사전 캐시 또는 synthetic path로 보강한다.

장점:

- 공식 REST API가 있음
- anonymous 호출 가능
- bbox 필터 가능
- 실제 샘플 호출 성공

주의:

- OpenSky 문서 기준 OAuth2 client credentials flow를 지원하며, Basic auth는 더 이상 허용되지 않는다.
- anonymous 사용자는 최신 state vector만 접근 가능하고 time 파라미터가 무시된다.
- credit/rate 제한이 있으므로 캐시 필수.
- 군용기/민감 항공기는 누락되거나 필터링될 수 있으므로 “전체 공중상황”이라고 주장하면 안 된다.

구현 추천:

```ts
// normalized aircraft state
{
  id: string,              // icao24
  callsign?: string,
  source: "opensky",
  lat: number,
  lon: number,
  altitudeM?: number,
  velocityMs?: number,
  headingDeg?: number,
  verticalRateMs?: number,
  originCountry?: string,
  observedAt: string
}
```

---

#### 백업: ADSB.lol

- 웹사이트: https://www.adsb.lol/
- API: https://api.adsb.lol/
- 문서: https://www.adsb.lol/docs/open-data/api/
- Historical data: https://www.adsb.lol/docs/open-data/historical/
- 라이선스: 문서 기준 ODbL 1.0

특징:

- ADSB.lol은 open data에 초점을 둔 ADS-B tracker다.
- API와 historical daily archive를 제공한다.
- community/volunteer feeder 기반이라 지역 커버리지가 일정하지 않을 수 있다.

해커톤 사용 방식:

- OpenSky가 rate limit에 걸릴 때 대체 API로 사용한다.
- 또는 historical archive를 사전 다운로드해서 demo-safe cache로 사용한다.

주의:

- 항공 데이터 라이선스가 ODbL이면 파생 데이터 공유 조건을 확인해야 한다.
- API 안정성/SLA는 상용 수준으로 가정하면 안 된다.

---

#### 백업: Airplanes.live

- API guide: https://airplanes.live/api-guide/
- 문서 기준 위치: `http://api.airplanes.live/v2/`
- 문서 기준 rate limit: 1 request/sec
- 문서 기준: non-commercial, no SLA/no uptime guarantee

해커톤 사용 방식:

- OpenSky/ADSB.lol이 실패할 때 fallback.
- API shape가 ADS-B Exchange v2 계열과 유사해 normalized adapter를 만들기 좋다.

주의:

- commercial use는 별도 조건 확인 필요.
- 안정성 보장 없음.

---

### 3.2 기상 데이터

#### 1순위: Open-Meteo

- 공식 문서: https://open-meteo.com/en/docs
- About: https://open-meteo.com/en/about
- Terms: https://open-meteo.com/en/terms
- 특징:
  - API key 불필요
  - 비상업 무료 사용 가능
  - 무료 API는 10,000 calls/day, 5,000/hour, 600/min 제한
  - CC BY 4.0 attribution 필요

예시:

```bash
curl "https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,wind_speed_10m,wind_gusts_10m,weather_code&hourly=visibility,cloud_cover,precipitation&forecast_days=1"
```

해커톤 사용 변수:

- `temperature_2m`
- `wind_speed_10m`
- `wind_gusts_10m`
- `visibility`
- `cloud_cover`
- `precipitation`
- `weather_code`

이상징후에 쓰는 방법:

- 기상 악화 조건:
  - visibility 낮음
  - cloud_cover 높음
  - precipitation 있음
  - wind_gusts 높음
- 기상 악화 중 특정 구역 접근 항적을 “주의 필요”로 표시

구현 추천:

```ts
{
  source: "open-meteo",
  regionId: string,
  lat: number,
  lon: number,
  observedAt: string,
  windSpeedKmh?: number,
  windGustKmh?: number,
  visibilityM?: number,
  cloudCoverPct?: number,
  precipitationMm?: number,
  weatherCode?: number
}
```

---

### 3.3 뉴스/OSINT 데이터

#### 1순위: GDELT

- Data page: https://www.gdeltproject.org/data.html
- DOC 2.0 API: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
- Rate limiting 안내: https://blog.gdeltproject.org/ukraine-api-rate-limiting-web-ngrams-3-0/

GDELT 특징:

- GDELT는 자체 설명 기준 전체 데이터베이스가 무료/open이다.
- raw data download, Analysis Service, BigQuery 접근을 제공한다.
- DOC 2.0 API는 기사 검색, article list, timeline 등 모드를 제공한다.
- API는 rate-limited이므로 캐시와 throttle이 필수다.

예시 쿼리:

```bash
curl "https://api.gdeltproject.org/api/v2/doc/doc?query=taiwan%20strait&mode=artlist&format=json&timespan=1week&maxrecords=20"
```

타임라인 쿼리:

```bash
curl "https://api.gdeltproject.org/api/v2/doc/doc?query=taiwan%20strait&mode=timelinevolraw&format=json&timespan=1week"
```

해커톤 사용 방식:

- 키워드 기반 기사 검색:
  - `taiwan strait`
  - `south china sea`
  - `air defense`
  - `drone`
  - `missile test`
  - `military exercise`
- 지역별 query preset을 만든다.
- 기사 URL, title, source domain, seen date를 citation 카드로 표시한다.
- volume timeline을 항적 변화와 함께 보여주면 “융합” 느낌이 강해진다.

주의:

- API rate limit이 있다. 실제 샘플 호출 중 429를 확인했다.
- 해커톤 데모는 반드시 cached GDELT response를 포함해야 한다.
- 뉴스는 사실 검증 전 신호이므로 “confirmed intelligence”가 아니라 “open-source signal”로 표현한다.

구현 추천:

```ts
{
  id: string,
  source: "gdelt",
  title: string,
  url: string,
  domain?: string,
  language?: string,
  publishedAt?: string,
  query: string,
  regionId: string,
  credibilityHint: "source" | "multi-source" | "unverified",
  summary?: string
}
```

---

#### 선택지: ReliefWeb

- API docs: https://apidoc.reliefweb.int/
- Endpoints: reports, disasters, countries 등
- 2025-11-01 이후 appname pre-approval 관련 안내가 있으므로 즉시 해커톤용 핵심 API로 쓰기보다는 보조 후보로 둔다.

적합한 용도:

- 자연재해/인도주의 위기와 항공 활동 간 상관관계
- 남중국해/대만해협보다는 재난·구호 관련 공중 활동 설명에 적합

---

#### 선택지: ACLED

- API docs: https://acleddata.com/api-documentation/getting-started
- API 접근에는 myACLED 계정 필요

적합한 용도:

- 분쟁 이벤트와 항공/뉴스 활동의 상관관계

주의:

- 계정 생성/인증이 필요하므로 사전 준비 없이는 해커톤장에서 리스크가 크다.
- 백업 데이터로는 좋지만 MVP 핵심 API로 두지 않는 것을 추천한다.

---

### 3.4 위성궤도/우주 데이터

#### 1순위: CelesTrak GP Data

- 문서: https://celestrak.org/NORAD/documentation/gp-data-formats.php
- 기본 쿼리 구조:

```text
https://celestrak.org/NORAD/elements/gp.php?{QUERY}=VALUE[&FORMAT=VALUE]
```

지원 query:

- `CATNR`
- `INTDES`
- `GROUP`
- `NAME`
- `SPECIAL`

지원 format:

- `TLE`
- `3LE`
- `2LE`
- `XML`
- `KVN`
- `JSON`
- `JSON-PRETTY`
- `CSV`

예시:

```bash
# 우주정거장 그룹 JSON
curl "https://celestrak.org/NORAD/elements/gp.php?GROUP=STATIONS&FORMAT=JSON"

# GPS 운영 위성 CSV
curl "https://celestrak.org/NORAD/elements/gp.php?GROUP=GPS-OPS&FORMAT=CSV"

# 특정 위성 ISS TLE
curl "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"
```

해커톤 사용 방식:

- 위성궤도는 메인 기능이 아니라 보조 레이어로 사용한다.
- “현재 AOI 상공/근처를 지나는 공개 위성 후보” 정도만 표시한다.
- ISR 가능성 판단은 단순화한다.

주의:

- CelesTrak 문서상 너무 자주 요청하지 말아야 하며, GP 데이터는 2시간마다 확인해도 충분하다.
- 실제 정찰 가능성은 센서/궤도/기상/태양각 등 복잡한 조건이 필요하므로 해커톤에서는 “public orbital awareness layer”로 표현한다.

---

#### 궤도 계산 라이브러리: satellite.js

- GitHub: https://github.com/shashwatak/satellite-js
- 특징:
  - TLE/OMM 기반 SGP4/SDP4 propagation 지원
  - 브라우저/Node.js에서 사용 가능
  - MIT license

사용 방식:

- CelesTrak JSON 또는 TLE를 가져온다.
- satellite.js로 현재 시각의 위성 lat/lon을 계산한다.
- 지도에 위성 위치와 궤적 line을 표시한다.

주의:

- 단순히 “위성 위치”를 보여주는 것은 가능하지만, 실제 관측 가능성/센서 해상도/임무 능력은 추정하지 않는다.

---

### 3.5 공항/인프라 데이터

#### 1순위: OurAirports

- Open data page: https://ourairports.com/data/
- GitHub-hosted CSV:
  - airports.csv: https://davidmegginson.github.io/ourairports-data/airports.csv
  - runways.csv: https://davidmegginson.github.io/ourairports-data/runways.csv
  - navaids.csv: https://davidmegginson.github.io/ourairports-data/navaids.csv
  - airport-frequencies.csv: https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv
- 라이선스: Public Domain

해커톤 사용 방식:

- AOI 내 공항/활주로를 지도에 표시한다.
- 항적이 특정 공항에서 멀어지는지/접근하는지 보조 설명에 사용한다.
- “공항 주변 비정상 접근” 같은 간단한 anomaly rule에 사용한다.

주의:

- 군사기지 데이터로 오해하지 말고, 공개 공항/비행장 데이터로 제한한다.

---

### 3.6 지도/경계 데이터

#### 1순위: Natural Earth

- Downloads: https://www.naturalearthdata.com/downloads/
- Terms: https://www.naturalearthdata.com/about/terms-of-use/
- 특징:
  - public domain vector/raster map data
  - 국가 경계, 해안선, 지명, 물리 지형 등 제공

해커톤 사용 방식:

- 국가 경계/해안선/육지 배경 표시
- GeoJSON으로 변환해서 로컬에 저장
- API 의존성 없이 지도 배경 품질 향상

---

#### OpenStreetMap tiles 사용 주의

- Tile usage policy: https://operations.osmfoundation.org/policies/vector/
- Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/

주의:

- OSM tile server를 bulk download/scraping 하면 안 된다.
- Nominatim은 heavy use 금지 및 1 req/sec 제한이 있다.
- 해커톤 데모는 소량/브라우저 사용 수준으로만 사용하고, 대량 타일 캐시는 피한다.

추천:

- 단순 데모: Leaflet + OSM tile 소량 사용
- 안정 데모: MapLibre + 로컬 GeoJSON/Natural Earth 또는 static basemap
- 인터넷 리스크 회피: 지도 배경 없이도 작동하는 fallback view 준비

---

## 4. 오픈소스 구현 도구

| 영역 | 추천 도구 | 링크 | 이유 |
|---|---|---|---|
| 2D 지도 | Leaflet | https://leafletjs.com/ | 가볍고 빠르게 구현 가능 |
| 고급 WebGL 지도 | MapLibre GL JS | https://www.maplibre.org/maplibre-gl-js/docs/ | vector tile, WebGL, 스타일링 유리 |
| 대규모/고급 시각화 | deck.gl | https://deck.gl/ | 항적 line, arc, heatmap 등 고급 레이어 |
| 공간 연산 | Turf.js | https://turfjs.org/ | point-in-polygon, distance, buffer 계산 |
| 위성 궤도 | satellite.js | https://github.com/shashwatak/satellite-js | TLE/OMM SGP4 계산 |
| 데이터 캐시 | SQLite / DuckDB / JSON files | - | 해커톤 데모 안정성 확보 |
| AI 브리핑 | LLM API 또는 로컬 템플릿 | - | citation 기반 요약 생성 |

추천 스택:

- Frontend: Next.js 또는 Vite + React
- 지도: Leaflet 먼저, 여유 있으면 MapLibre/deck.gl
- 공간 연산: Turf.js
- 데이터 저장: `/data/cache/*.json`
- 서버: Next.js API routes 또는 FastAPI
- AI: LLM API + fallback template summarizer

---

## 5. 표준 데이터 모델

여러 소스를 바로 UI에 연결하면 복잡해지므로, 반드시 normalized event store를 둔다.

```text
real API data
  + cached sample data
  + synthetic event data
      ↓
normalizer
      ↓
normalized event store
      ↓
map / timeline / anomaly engine / AI briefing
```

### 5.1 Region

```ts
type Region = {
  id: string;
  name: string;
  description: string;
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  center: [number, number];              // [lon, lat]
  watchZones: GeoJSON.FeatureCollection;
};
```

### 5.2 Track

```ts
type Track = {
  id: string;
  source: "opensky" | "adsblol" | "airplanes-live" | "synthetic";
  callsign?: string;
  originCountry?: string;
  points: Array<{
    lat: number;
    lon: number;
    altitudeM?: number;
    velocityMs?: number;
    headingDeg?: number;
    observedAt: string;
  }>;
};
```

### 5.3 WeatherSnapshot

```ts
type WeatherSnapshot = {
  source: "open-meteo" | "cache";
  regionId: string;
  observedAt: string;
  lat: number;
  lon: number;
  windSpeedKmh?: number;
  windGustKmh?: number;
  visibilityM?: number;
  cloudCoverPct?: number;
  precipitationMm?: number;
  weatherCode?: number;
};
```

### 5.4 OsintItem

```ts
type OsintItem = {
  id: string;
  source: "gdelt" | "reliefweb" | "manual" | "synthetic";
  regionId: string;
  title: string;
  url?: string;
  domain?: string;
  publishedAt?: string;
  summary?: string;
  tags: string[];
  confidence: number;
};
```

### 5.5 Anomaly

```ts
type Anomaly = {
  id: string;
  type: "zone_approach" | "route_deviation" | "weather_risk" | "osint_correlation" | "activity_spike";
  severity: "info" | "watch" | "warning";
  title: string;
  description: string;
  confidence: number;
  relatedTrackIds: string[];
  relatedOsintIds: string[];
  citations: Array<{ title: string; url?: string; source: string }>;
};
```

---

## 6. 이상징후 탐지 규칙

처음부터 ML 모델을 만들지 말고 rule-based scoring으로 시작한다.

### 6.1 특정 구역 접근

입력:

- 항공기 현재 위치
- watch zone polygon

로직:

- 항공기가 watch zone 내부면 +40점
- watch zone 50km 이내면 +20점
- 고도/속도 변화가 크면 +10점

도구:

- Turf.js `booleanPointInPolygon`
- Turf.js `distance`

---

### 6.2 평소 항로 이탈/급격한 우회

입력:

- 최근 track points
- baseline route 또는 synthetic expected corridor

로직:

- heading change가 짧은 시간 내 60도 이상이면 +15점
- expected corridor에서 30km 이상 벗어나면 +25점
- vertical rate가 급변하면 +10점

해커톤 현실안:

- 실제 historical baseline은 만들지 말고, region별 synthetic corridor를 정의한다.
- “평소 항로”는 실제 통계가 아니라 “demo baseline”이라고 명시한다.

---

### 6.3 기상 악화 속 접근

입력:

- 항적
- Open-Meteo weather snapshot
- watch zone

로직:

- visibility 낮음 + 접근 중이면 +20점
- precipitation 있음 + 접근 중이면 +10점
- wind gust 높음 + 접근 중이면 +10점

해커톤 메시지:

> 기상 악화 자체가 위협은 아니지만, 관측/식별 난이도를 높이는 operational risk factor로 사용한다.

---

### 6.4 뉴스 이벤트와 항적 변화 상관관계

입력:

- GDELT article timeline
- 항적 수/접근 이벤트 수

로직:

- 관련 뉴스가 최근 24~72시간 내 증가하면 +10점
- 같은 기간 AOI 항적 수가 평균 대비 증가하면 +15점
- 둘 다 발생하면 “OSINT correlation” anomaly 생성

해커톤 현실안:

- 평균 대비 증가는 cached/synthetic baseline으로 계산한다.
- 실제 인과관계가 아니라 “correlation signal”로 표현한다.

---

## 7. AI 브리핑 설계

### 7.1 브리핑 포맷

AI 출력은 자유 텍스트만 두지 말고 구조화한다.

```json
{
  "situation_summary": "...",
  "key_anomalies": [
    {
      "title": "...",
      "severity": "watch",
      "why_it_matters": "...",
      "evidence": ["citation-1", "citation-2"],
      "confidence": 0.72
    }
  ],
  "recommended_next_checks": [
    "...",
    "..."
  ],
  "caveats": [
    "OpenSky/ADS-B coverage is incomplete.",
    "Synthetic watch zones are for demonstration only."
  ]
}
```

### 7.2 Citation 강제

AI에게 넘기는 context는 반드시 citation ID를 포함한다.

```text
[flight:opensky:abc123]
Callsign SIA606 observed at 2026-06-29T12:45Z near 127.0011, 36.3583.

[weather:openmeteo:seoul:2026-06-29T12:45Z]
Visibility 9000m, cloud cover 80%, precipitation 0.2mm.

[osint:gdelt:1]
Title: Example article...
URL: <source-url>
Published: ...
```

브리핑 UI에는 반드시:

- 근거 카드
- 출처 URL
- 데이터 시각
- confidence
- caveat

을 표시한다.

---

## 8. 데모용 지역 preset

### 8.1 수도권 상공

```ts
{
  id: "seoul-airspace",
  name: "수도권 상공",
  bbox: [126.3, 36.7, 128.0, 38.3],
  center: [126.9780, 37.5665]
}
```

장점:

- OpenSky 항적이 잘 잡힐 가능성이 높음
- Open-Meteo 샘플 안정적
- 발표자가 설명하기 쉬움

주의:

- 군사적 판단 표현을 피하고 “공개 항공 activity monitoring”으로 설명

---

### 8.2 대만해협

```ts
{
  id: "taiwan-strait",
  name: "대만해협",
  bbox: [118.0, 21.5, 123.5, 26.5],
  center: [120.8, 24.0]
}
```

장점:

- Maven-style Air ISR 스토리가 강함
- GDELT 뉴스 이벤트가 잘 나올 가능성

주의:

- 실제 군사 활동 판단처럼 보이지 않게 synthetic 이벤트와 공개 데이터임을 명시

---

### 8.3 남중국해

```ts
{
  id: "south-china-sea",
  name: "남중국해",
  bbox: [108.0, 5.0, 122.0, 22.0],
  center: [115.0, 13.5]
}
```

장점:

- 해상/공중/OSINT 융합 스토리 가능

주의:

- bbox가 크면 OpenSky credit 비용이 커질 수 있음. 데모에서는 작은 sub-region으로 제한 추천

---

## 9. 수집/캐시 전략

해커톤장에서 실시간 API에 의존하면 위험하다. 반드시 cached/synthetic first로 간다.

### 9.1 폴더 구조

```text
data/
  regions/
    seoul-airspace.geojson
    taiwan-strait.geojson
    south-china-sea.geojson
  cache/
    opensky-seoul-latest.json
    opensky-taiwan-latest.json
    openmeteo-seoul.json
    gdelt-taiwan-artlist.json
    celestrak-stations.json
    ourairports-airports.csv
  synthetic/
    synthetic-tracks.json
    synthetic-events.json
    baseline-corridors.geojson
    watch-zones.geojson
```

### 9.2 사전 수집 스크립트 후보

```bash
# OpenSky Seoul bbox
curl -L "https://opensky-network.org/api/states/all?lamin=36.7&lomin=126.3&lamax=38.3&lomax=128.0" \
  -o data/cache/opensky-seoul-latest.json

# Open-Meteo Seoul
curl -L "https://api.open-meteo.com/v1/forecast?latitude=37.5665&longitude=126.9780&current=temperature_2m,wind_speed_10m,wind_gusts_10m,weather_code&hourly=visibility,cloud_cover,precipitation&forecast_days=1" \
  -o data/cache/openmeteo-seoul.json

# CelesTrak Stations
curl -L "https://celestrak.org/NORAD/elements/gp.php?GROUP=STATIONS&FORMAT=JSON" \
  -o data/cache/celestrak-stations.json

# OurAirports
curl -L "https://davidmegginson.github.io/ourairports-data/airports.csv" \
  -o data/cache/ourairports-airports.csv
```

GDELT는 반드시 throttle:

```bash
sleep 6
curl -L "https://api.gdeltproject.org/api/v2/doc/doc?query=taiwan%20strait&mode=artlist&format=json&timespan=1week&maxrecords=20" \
  -o data/cache/gdelt-taiwan-artlist.json
```

---

## 10. 해커톤 전 준비 우선순위

### P0: 반드시 사전 준비

- [ ] 지역 preset 3개 정의
- [ ] synthetic tracks 5~10개 생성
- [ ] synthetic watch zones GeoJSON 생성
- [ ] OpenSky cache 1~2개 저장
- [ ] Open-Meteo cache 저장
- [ ] GDELT cache 저장
- [ ] CelesTrak cache 저장
- [ ] citation card UI mock 제작

### P1: 있으면 좋음

- [ ] OpenSky live refresh 버튼
- [ ] GDELT live refresh 버튼
- [ ] satellite.js로 위성 현재 위치 계산
- [ ] Turf.js 기반 point-in-polygon anomaly
- [ ] anomaly score panel

### P2: 시간 남으면

- [ ] deck.gl 항적 trail animation
- [ ] timeline brush interaction
- [ ] PDF/Markdown briefing export
- [ ] source reliability scoring

---

## 11. 3분 데모 시나리오

### 데모 제목

> 대만해협 Air ISR Fusion: 공개 항적·기상·뉴스·위성궤도 융합 상황판

### 흐름

1. **지역 선택**
   - “대만해협 AOI를 선택합니다.”

2. **데이터 레이어 로드**
   - 항적 레이어
   - 기상 레이어
   - GDELT 뉴스 이벤트
   - 공개 위성궤도 후보
   - synthetic watch zone

3. **이상징후 탐지**
   - watch zone 접근 항적
   - 급격한 우회/항로 이탈
   - 관련 뉴스 증가와 항적 증가의 correlation

4. **AI 브리핑**
   - 상황 요약
   - anomaly별 근거
   - citation 카드
   - confidence/caveat

5. **분석관 보조 강조**
   - “이 시스템은 판단을 자동화하지 않고, 공개 출처 기반 신호를 빠르게 융합해 분석관이 확인할 대상을 줄입니다.”

---

## 12. 안전/윤리/심사 대응 문구

발표에서 반드시 이렇게 말한다.

> 본 시스템은 공개 데이터와 synthetic 이벤트만 사용하며, 표적 지정이나 타격 자동화가 아니라 분석관의 상황 이해와 추가 확인 우선순위 결정을 돕는 의사결정 보조 도구입니다.

주의 문구:

- ADS-B/OpenSky coverage는 완전하지 않다.
- 군용기/민감 항공기는 누락될 수 있다.
- 뉴스/OSINT는 확인 전 신호이므로 추가 검증이 필요하다.
- watch zone과 baseline corridor는 데모용 synthetic data다.
- confidence는 확률적 진실이 아니라 데이터 품질/규칙 기반 신뢰도다.

---

## 13. 현실성 평가

| 기능 | 난이도 | 데모 임팩트 | 안정성 | 판단 |
|---|---:|---:|---:|---|
| 지도 + 항적 표시 | 중 | 높음 | 중상 | 반드시 구현 |
| 기상 레이어 | 하 | 중 | 높음 | 반드시 구현 |
| GDELT 뉴스/citation | 중 | 높음 | 중 | cache 필수 |
| 위성궤도 레이어 | 중 | 중상 | 높음 | 보조 기능으로 구현 |
| anomaly scoring | 중 | 매우 높음 | 높음 | rule-based로 구현 |
| AI 브리핑 | 중 | 매우 높음 | 중 | LLM + fallback template |
| 실제 historical baseline | 상 | 중 | 낮음 | 이번 MVP 제외 |
| 실제 위성 ISR 가능성 판정 | 상 | 중 | 낮음 | 이번 MVP 제외 |

---

## 14. API 샘플 호출 검증 메모

2026-06-29 기준 짧은 샘플 호출 결과:

- Open-Meteo: 서울 좌표 forecast JSON 응답 확인
- CelesTrak: `GROUP=STATIONS&FORMAT=JSON` 응답 확인
- OurAirports: `airports.csv` 다운로드 확인
- OpenSky: 한국 bbox `states/all` anonymous 응답 확인
- GDELT: DOC API는 반복 호출 시 429 rate limit 확인. throttle/cache 필요

---

## 15. 추천 최종 구현안

가장 현실적인 MVP 이름:

> **AirMaven Lite: Open-source Air ISR Fusion Copilot**

최종 기능:

1. Region preset 선택
2. Cached/live 항적 로드
3. 기상/뉴스/위성 보조 레이어 표시
4. Rule-based anomaly 3종 탐지
5. AI briefing + citation card 생성

이 정도면 T2의 요구사항인:

- 항적·궤도·기상·OSINT 다중 소스 융합
- 자연어 질의 → 지역 상황 요약
- 이상징후 탐지
- 출처/citation 및 신뢰도 표기
- 타임라인·지도 시각화

을 모두 충족한다.

---

## 16. 참고 링크 모음

### 항적

- OpenSky REST API: https://openskynetwork.github.io/opensky-api/rest.html
- ADSB.lol: https://www.adsb.lol/
- ADSB.lol API: https://www.adsb.lol/docs/open-data/api/
- ADSB.lol historical: https://www.adsb.lol/docs/open-data/historical/
- Airplanes.live API guide: https://airplanes.live/api-guide/

### 기상

- Open-Meteo docs: https://open-meteo.com/en/docs
- Open-Meteo about: https://open-meteo.com/en/about
- Open-Meteo terms: https://open-meteo.com/en/terms

### 뉴스/OSINT

- GDELT data: https://www.gdeltproject.org/data.html
- GDELT DOC 2.0 API: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/
- GDELT rate limiting note: https://blog.gdeltproject.org/ukraine-api-rate-limiting-web-ngrams-3-0/
- ReliefWeb API: https://apidoc.reliefweb.int/
- ACLED API getting started: https://acleddata.com/api-documentation/getting-started

### 위성/우주

- CelesTrak GP data: https://celestrak.org/NORAD/documentation/gp-data-formats.php
- satellite.js: https://github.com/shashwatak/satellite-js

### 지도/인프라

- OurAirports data: https://ourairports.com/data/
- Natural Earth downloads: https://www.naturalearthdata.com/downloads/
- Natural Earth terms: https://www.naturalearthdata.com/about/terms-of-use/
- OSM vector tile policy: https://operations.osmfoundation.org/policies/vector/
- OSM Nominatim policy: https://operations.osmfoundation.org/policies/nominatim/

### 오픈소스 시각화/공간연산

- Leaflet: https://leafletjs.com/
- MapLibre GL JS: https://www.maplibre.org/maplibre-gl-js/docs/
- deck.gl: https://deck.gl/
- Turf.js: https://turfjs.org/
