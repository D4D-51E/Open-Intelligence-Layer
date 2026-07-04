# AirMaven

D4D T2 **실시간 글로벌 항적 + 다중소스 융합 3D 글로브** 해커톤 프로토타입.

AirMaven은 공개 ADS-B 항적을 전세계 단위로 실시간 노출하고, 같은 화면에서 기상 · 공역(NOTAM/OpenAIP) · OSINT 뉴스 신호를 겹쳐 보여주는 풀스크린 3D 글로브 앱이다. 줌 아웃하면 전세계 군용기 피드, 줌 인하면 뷰포트 단위 상세 항적으로 자동 전환되고, 선택한 항적에는 기상 · 위성 · 공역 · OSINT · 이상탐지 축을 결합한 융합 컨텍스트가 표시된다.

> Safety boundary: this is **analyst decision-support only**. The military marker is public ADS-B flag exposure, not identification. It does not perform target designation, strike recommendation, weapon selection, or automated engagement logic. Only public/open data is used — nothing here is synthesized or fabricated, and no data is scoped to track or target a specific individual.

## UX — 풀스크린 글로브

- 화면 전체를 차지하는 MapLibre GL 3D 글로브(`SituationRealGlobe`)가 기본이자 유일한 뷰. 과거의 4분할 ops 대시보드(`?view=ops`)와 스크롤형 narrative 리포트 모드는 제거되었다.
- HUD 오버레이: 좌상단에 항적 수 · 군용기 수 · adsb.lol 수신 상태, 우상단에 유형/고도 필터와 공역·OSINT·NOTAM·타임라인 토글, 우측 패널에 선택 항적의 융합 컨텍스트와 이벤트 타임라인.
- 줌 레벨에 따라 자동으로 전환되는 두 조회 전략(`fetchStrategyForZoom`):
  - **줌 아웃**: adsb.lol `/v2/mil` 전세계 군용기 피드.
  - **줌 인**: 현재 뷰포트 bbox 기준 point 조회(`adsb.lol` 반경 질의).
- **타임라인 모드**: 켜면 실시간 폴링 대신 Neon에 기록된 과거 관측치(`/api/history`)를 스크러버로 재생.
- **공역 레이어**: OpenAIP 벡터 타일(줌 ≥5에서만 로드) + 실시간 NOTAM 서클.

## 데이터 경로 (두 개, 둘 다 동작 중)

**1) baseline — 정적 스냅샷 융합**

```
scripts/fetch-live-data.mjs → public/data/live-scenarios.json → src/lib/baselineData.getScenario → trackFusion / fusion
```

OpenSky, CelesTrak, Copernicus STAC, NASA FIRMS, Open-Meteo, OurAirports, ICAO FIR, AISStream, ICAO/SkyLink NOTAM 등 다수의 공개 API를 폴링해 스냅샷 JSON을 만들고, 이를 트랙별 융합 컨텍스트(`trackFusion.ts`)와 AOI 융합 이벤트(`fusion.ts`)의 기반 데이터로 사용한다. 이 스냅샷은 위성/위성패스/기상/공역(FIR)/구형 OSINT 축의 원천이다.

**2) 라이브 피벗 — 글로브에 직접 주입되는 실시간 레이어**

- 항적: 브라우저가 줌 레벨에 따라 adsb.lol 전세계 군용 또는 뷰포트 point 조회를 직접 폴링(`src/lib/adsbLolApi.ts`).
- 관측 이력: Neon 관측 저장소 타임라인(`/api/history`).
- OSINT: GDELT + 엄선된 국방/국제 RSS 피드가 Neon에 적재되고 `/api/osint`로 조회.
- NOTAM: FAA `notamSearch` 공개 엔드포인트가 Neon에 적재되고 `/api/notam`으로 조회.
- 공역 폴리곤: OpenAIP 벡터 타일(`/api/openaip/{z}/{x}/{y}`, 줌 ≥5).

두 경로는 서로를 대체하지 않는다 — baseline 스냅샷이 기상/위성/FIR/구형 OSINT 축을 채우고, 라이브 피벗이 화면에 보이는 항적·OSINT·NOTAM을 실시간으로 덮어쓴다(`App.tsx`의 `mergeLiveScenario`/`scenario` 조립 로직 참고).

## 데이터 소스 & API

| 레이어 | 소스 | 경로 |
|---|---|---|
| 전세계 군용 항적 | adsb.lol `/v2/mil` | 브라우저 직접 폴링(줌 아웃), 서버 측 기록(Neon) |
| 뷰포트 상세 항적 | adsb.lol `/v2/lat/{lat}/lon/{lon}/dist/{nm}` | 브라우저 직접 폴링(줌 인), Vite/Vercel same-origin `/adsb-lol/*` 프록시 경유(CORS 회피) |
| 항적(baseline) | OpenSky Network `/states/all` | `scripts/fetch-live-data.mjs` → `live-scenarios.json` |
| 기상 | Open-Meteo | baseline 스냅샷 + 서버 측 기록(Neon `weather_observations`) |
| 위성/궤도 | CelesTrak GP(`GROUP=stations`) + satellite.js | baseline 스냅샷 |
| 위성 장면 메타데이터 | Copernicus Data Space STAC `/v1/search` | baseline 스냅샷 |
| 열이상 탐지 | NASA FIRMS area CSV API | baseline 스냅샷(`NASA_FIRMS_MAP_KEY` 필요) |
| 공항 컨텍스트 | OurAirports CSV | baseline 스냅샷 |
| FIR 컨텍스트 | ICAO API Data Service `fir-by-location` | baseline 스냅샷 |
| AIS 해상 | AISStream WebSocket | baseline 스냅샷(서버 측 전용, 키 필요) |
| OSINT 뉴스 | GDELT DOC 2.0 + 국방/국제 RSS(defense.gov, Defense News, Breaking Defense, USNI News, The War Zone, 연합뉴스, BBC World, Al Jazeera) | 서버 측 기록(Neon `osint_items`) → `/api/osint` |
| NOTAM | FAA `notamSearch`(공개, 주요 공항 목록) | 서버 측 기록(Neon `notam_notices`) → `/api/notam` |
| NOTAM(baseline) | SkyLink NOTAM API(1차) / ICAO NOTAM(fallback) | baseline 스냅샷 |
| 공역 폴리곤 | OpenAIP 벡터 타일 | `/api/openaip/{z}/{x}/{y}`(서버 측 키 주입 프록시) |
| 항공기 운영자/기종 식별 | Mictronics readsb 커뮤니티 운영자 데이터셋 | `scripts/fetch-callsign-db.mjs` → `public/data/aircraft-operators.json` |

값이 없거나 실패한 소스는 조용히 빈 값으로 채워지지 않는다 — 해당 축은 "데이터 없음"으로 남고 합성된 값으로 대체되지 않는다.

## 저장소 — Neon Postgres + pgvector

라이브 피벗 레이어(항적/기상/OSINT/NOTAM 관측치)는 Neon Postgres(HTTP 드라이버, `@neondatabase/serverless`) 프로젝트 `airmaven`(ap-southeast-1)에 시계열로 누적된다.

- 테이블: `track_observations`, `weather_observations`, `osint_items`, `notam_notices`, `ingest_runs`(`db/schema.sql`).
- `osint_items.embedding vector(1536)` 컬럼은 pgvector 확장으로 준비되어 있지만 **Phase 3 — 아직 미구현**이다. nullable이며 임베딩을 채우는 OpenAI 호출은 현재 코드에 없다(추후 OSINT 시맨틱 검색/RAG용 백필 예정).
- 마이그레이션: `npm run db:migrate`(`scripts/db-migrate.mjs`, `.env`의 `DATABASE_URL` 사용).

## Serverless API 표면 (Vercel Functions)

| 엔드포인트 | 역할 |
|---|---|
| `GET /api/openaip/[z]/[x]/[y]` | OpenAIP 벡터 타일 프록시. `OPENAIP_API_KEY`를 서버 측에서만 주입해 브라우저에 노출하지 않는다. |
| `GET /api/cron/record` | 관측 기록 실행 엔드포인트. `CRON_SECRET` Bearer 토큰으로 보호되며 adsb.lol 전세계 군용/뷰포트 항적, 기상, OSINT, NOTAM을 Neon에 적재한다(`db/ingest.mjs`, `recordAllObservations`). |
| `GET /api/history` | 지역/시간범위/종류(`tracks`\|`weather`)별 저장된 관측치 조회. 타임라인 스크러버가 사용. |
| `GET /api/osint` | 저장된 GDELT/RSS OSINT 항목 조회(지역/티어/시간범위 필터). |
| `GET /api/notam` | 저장된 FAA NOTAM 조회(bbox 필터). |

## 스케줄러 — GitHub Actions (Vercel Hobby cron은 daily-only)

Vercel Hobby 플랜의 Cron Jobs는 하루 1회로 제한되어 15분 간격 기록에 쓸 수 없다. 대신 `.github/workflows/record-observations.yml`이 **15분마다** `curl`로 `/api/cron/record`를 호출한다(`RECORD_URL`, `CRON_SECRET` 리포지토리 시크릿 필요). adsb.lol/OpenSky 호출 자체는 Vercel 서버리스 함수 안에서 실행된다(Vercel egress는 adsb.lol에서 rate-limit되지 않음).

## 로컬 개발

```bash
npm install
npm run dev
```

`npm run dev`는 Vite 앱과 백그라운드 공개 데이터 갱신 루프(`scripts/dev-live.mjs`)를 함께 기동한다. 로컬 Vite URL(보통 `http://localhost:5173`)을 연다.

Vite 앱만 필요하면(자동 공개 API 갱신 없이):

```bash
npm run dev:vite
```

기타 스크립트:

```bash
npm run build            # tsc -b && vite build
npm run typecheck        # tsc --noEmit
npm run lint             # eslint . --ext ts,tsx --max-warnings 0
npm test                 # vitest run
npm run preview          # vite preview

npm run fetch:live       # scripts/fetch-live-data.mjs 1회 실행 → public/data/live-scenarios.json 갱신
npm run fetch:callsigns  # 커뮤니티 운영자 데이터셋 갱신 → public/data/aircraft-operators.json
npm run db:migrate       # Neon 스키마 마이그레이션 (.env 필요)
npm run record           # 로컬에서 1회 관측 기록 실행 (.env 필요)
npm run live:loop        # scripts/fetch-live-data.mjs 주기 실행 루프만
```

## 환경 변수

`.env.example`을 복사해 `.env`를 만든다:

```bash
cp .env.example .env
```

`.env.example`에 각 변수의 용도가 주석으로 정리되어 있다 — 필수 3개(`DATABASE_URL`, `CRON_SECRET`, `OPENAIP_API_KEY`)와 baseline 경로가 사용하는 다수의 선택적 소스 키(OpenSky OAuth2, Copernicus STAC, NASA FIRMS, AISStream, ICAO/SkyLink NOTAM)를 포함한다. **모든 키는 서버 측 전용이며 브라우저나 git에 노출되지 않는다** — 글로브는 airspace 타일과 NOTAM/OSINT 행을 항상 same-origin 프록시(`/api/*`)로 조회한다. `.env`는 gitignored.

## Vercel 배포

```bash
npm run build
npx vercel --prod
```

Vercel이 `npm run build`를 실행하고 `dist/`를 정적 자산으로 서빙한다(`vercel.json`). `api/` 아래 서버리스 함수가 함께 배포되며, `vercel.json`의 `rewrites`가 `/adsb-lol/*` → `https://api.adsb.lol/*`를 same-origin으로 프록시해 브라우저의 CORS 미지원 adsb.lol 호출을 우회한다.

## 안전 원칙

- 합성/조작 데이터 금지 — 공개 데이터만 사용, 표적화(targeting) 목적 없음.
- 시크릿(`DATABASE_URL`, `CRON_SECRET`, `OPENAIP_API_KEY` 등)은 서버 측 전용, 브라우저·git에 노출 금지.
- 군용 마커는 공개 ADS-B `dbFlags` 노출일 뿐, 신원 식별이나 표적 지정이 아니다.
- OSINT/뉴스 상관관계는 확인(confirmation)이 아니다.
- 커밋에 co-author 트레일러 없음(전역 규칙).

## Limitations

- 공개 ADS-B 데이터는 불완전하며 민감 항공기는 노출되지 않을 수 있다.
- OpenSky 익명 접근은 레이트리밋되어 baseline 스냅샷이 성긴 지역 데이터를 반환할 수 있다.
- GDELT는 공유 IP 레이트리밋으로 0건을 반환할 수 있다 — 이 경우 RSS 피드가 실질적인 OSINT 소스가 된다.
- CelesTrak은 반복 다운로드를 차단/레이트리밋할 수 있으며, 그 경우 위성 레이어는 비어 있다.
- AISStream 커버리지는 공개 AIS 수신기와 짧은 fetch 윈도우에 의존한다 — 선박이 적은 AOI는 정상적으로 0척일 수 있다.
- ICAO FIR 조회는 기본 24시간 TTL 캐시를 사용한다(체험판 키의 호출 제한 때문).
- `osint_items.embedding`(pgvector)은 Phase 3 미구현 — 현재 임베딩 백필/시맨틱 검색 없음.
- 위성 레이어는 공개 궤도 인식(orbital awareness)일 뿐 ISR 수집 능력에 대한 주장이 아니다.
