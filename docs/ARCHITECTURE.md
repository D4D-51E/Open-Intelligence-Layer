# 아키텍처 · 기술스택 · 서비스 구조 · 기능

## 1. 시스템 아키텍처

```
                              ┌──────────────────────────────────────────┐
   외부 공개 소스              │  브라우저 (SPA)                            │
   ───────────               │  Vite + React 18 + TS                      │
   adsb.lol ─┐               │  MapLibre GL 3D 글로브                     │
   AISStream │               │  · 위성 SGP4 전파(satellite.js)            │
   Celestrak │               │  · 신뢰도 검증 패널 / AI 코파일럿          │
   NASA FIRMS│               │  · 타임라인 리플레이                        │
   EMSC      │  fetch/폴링   └───────────────▲────────────────────────────┘
   OpenAIP   │                               │ HTTPS (/api/*, /data/*)
   Telegram  │               ┌───────────────┴────────────────────────────┐
   Tzeva Adom│──────────────▶│  Vercel Serverless Functions (Node, /api)   │
   data.go.kr│               │  read: history·telegram·osint·notam·seismic │
   GDELT/RSS │               │        ·satellites·firms·openaip(proxy)     │
   OpenAI    │               │  cron: cron/record   bot: tg(webhook+push)  │
   └─────────┘               └──────────────▲──────────────┬──────────────┘
                                            │ SQL(HTTP)     │ 트리거
   ┌───────────────────────────┐           │               │
   │ Railway 상주 워커(collector)│───────────┤        ┌──────┴───────────┐
   │ · AISStream WebSocket      │  write     │        │ GitHub Actions   │
   │ · adsb.lol 폴링(60초)      │            ▼        │ cron(스케줄러)   │
   └───────────────────────────┘   ┌─────────────────┐│ */15 수집        │
                                    │  Neon Postgres  ││ 0 */6 브리핑     │
                                    │  (시계열/상태)  ││ */5 실시간 알림  │
                                    └─────────────────┘└──────────────────┘
                                            │ sendMessage
                                            ▼
                                    ┌─────────────────┐
                                    │  Telegram Bot    │  (모바일 조회·푸시)
                                    └─────────────────┘
```

핵심 설계 원칙:
- **수집과 조회 분리** — 상시 수집(Railway·크론)이 Neon에 시계열을 적재, 프론트/봇은 Neon을 읽는다(재스크레이핑 X).
- **키 은닉** — 키가 필요한 소스(OpenAIP·OpenAI·FIRMS·AIS)는 서버 함수/워커에서만 접근.
- **뷰포트 스코핑** — 대용량 레이어(선박·위성·공역)는 현재 화면·줌 기준으로만 렌더.

## 2. 기술 스택

| 영역 | 기술 |
|---|---|
| 프론트엔드 | Vite · React 18 · TypeScript · MapLibre GL(3D 글로브) · 순수 CSS |
| 지도/궤도 | OpenFreeMap 다크 벡터 스타일 · OpenAIP 벡터 타일 · satellite.js(SGP4) |
| 서버리스 API | Vercel Functions (Node `.mjs` 핸들러) |
| 데이터베이스 | Neon Postgres (`@neondatabase/serverless` HTTP 드라이버) |
| 상주 수집기 | Railway 워커(node:20-slim, Docker) — `ws` WebSocket |
| 스케줄링 | GitHub Actions cron |
| AI | OpenAI (gpt-4o-mini) |
| 봇 | Telegram Bot API(웹훅) |
| 배포 | Vercel(웹+API) · Railway(수집기) · GitHub(origin·darkwinter) |
| 테스트/게이트 | vitest(61 테스트) · tsc · vite build |

## 3. 서비스 구조

### 3.1 Vercel Serverless Functions (`api/`, 12개 — Hobby 한도)

| 함수 | 역할 |
|---|---|
| `history.mjs` | 타임라인용 항적/선박 이력 조회(`?kind=tracks\|vessels`, bbox/time) |
| `telegram.mjs` | 텔레그램 OSINT 게시물 조회 (+ `?kind=airalert` 우크라 공습경보) |
| `osint.mjs` | OSINT 이벤트(뉴스/클러스터/FIRMS) 조회 |
| `notam.mjs` | NOTAM 조회 |
| `seismic.mjs` | EMSC 지진(폭발형 필터) |
| `satellites.mjs` | Celestrak TLE 프록시(그룹별) |
| `firms.mjs` | NASA FIRMS 실시간 열점(주장 지역 bbox) |
| `openaip/[z]/[x]/[y].mjs` | OpenAIP 공역 타일 프록시(키 은닉) |
| `copilot.mjs` | OpenAI 요약/이상탐지(멀티턴) |
| `tg.mjs` | 텔레그램 봇 웹훅 + 능동 푸시(`?push=briefing\|anomaly\|alert`) |
| `cron/record.mjs` | 15분 관측 수집 엔트리(`recordAllObservations`) |
| `cron/record-vessels.mjs` | (비활성) AIS 수집 수동 fallback |

### 3.2 수집 로직 (`db/`)

| 모듈 | 역할 |
|---|---|
| `client.mjs` | Neon SQL 클라이언트(`getSql`) |
| `ingest.mjs` | `recordAllObservations` — 리전별 항적/기상 + OSINT/NOTAM/텔레그램 |
| `telegramIngest.mjs` | 84개 채널 스크레이프 → 전쟁-결과 필터 → 번역 → upsert |
| `osintIngest.mjs` · `notamIngest.mjs` | GDELT/RSS · FAA NOTAM 수집 |
| `aisIngest.mjs` | AIS 수집 로직(수동 fallback) |
| `claimAssess.mjs` | 신뢰도 채점(지오로케이트 + 열적 + 교차출처 + 지역 열활동) — 웹/봇 공용 |
| `firms.mjs` | NASA FIRMS 조회/파싱 |
| `airAlert.mjs` | 우크라 공습경보 파싱(오블라스트 상태) |
| `anomalyAircraft.mjs` | 비상 스쿼크 + 고가치 자산 분류(앵커드 ICAO 코드) |
| `israelAlert.mjs` | 이스라엘 경보(Tzeva Adom 미러) |

### 3.3 Railway 상주 워커 (`collector/`)

- `index.mjs` — AISStream 글로벌 WebSocket → 스로틀 스냅샷 → `vessel_observations`.
- `aircraft.mjs` — adsb.lol AOI 폴링(60초) → `track_observations` (`COLLECT_AIRCRAFT`로 토글, 24h prune).

### 3.4 Neon Postgres 테이블

| 테이블 | 내용 |
|---|---|
| `track_observations` | 항공기 ADS-B 시계열 |
| `vessel_observations` | 선박 AIS 시계열 |
| `weather_observations` | 관심지역 기상 |
| `osint_items` | OSINT 이벤트(뉴스/클러스터) |
| `notam_notices` | NOTAM |
| `telegram_posts` | 텔레그램 OSINT 게시물(natural_key 멱등, 14일 보존) |
| `bot_subscribers` | 봇 푸시 구독자 |
| `bot_push_log` | 푸시 중복방지 로그 |
| `ingest_runs` | 수집 관측 로그 |

### 3.5 GitHub Actions 크론

| 워크플로우 | 스케줄 | 역할 |
|---|---|---|
| `record-observations.yml` | `*/15` | 관측 수집(항적·기상·OSINT·NOTAM·텔레그램) |
| `bot-briefing.yml` | `0 */6` | ① 6시간 UA·중동 브리핑 푸시 |
| `bot-rapid.yml` | `*/5` | ②③ 이상항적 + 공습경보 푸시 |
| `record-vessels.yml` | (비활성) | AIS 수동 fallback |

## 4. 기능 목록

### 4.1 실시간 융합 글로브
- 전 세계 항공기(ADS-B)·선박(AIS)·위성(TLE) 실시간 표시, 뷰포트/줌 필터.
- 항적/선박/위성 클릭 → 이동을 따라가는 팝업(식별·속도·침로·고도·좌표).
- 지역 리버스 지오코딩 라벨(육지 국가 / 해역명).

### 4.2 레이어 (HUD 토글)
- **공역** — OpenAIP 분류별 색상 + ROK AIP(KADIZ·P-73), **항로**(ROK 항공로 점선).
- **위성** — Celestrak 전체 활성(Starlink 포함), 줌인 시 화면 영역.
- **OSINT** — 지오로케이트된 텔레그램 주장(클릭 시 신뢰도+원문 링크).
- **폭발형** — EMSC 얕은 진원(≤2km) 지진.
- **경보** — 우크라이나 공습경보 오블라스트.
- **NOTAM** — 공역 통제.

### 4.3 OSINT 신뢰도 검증
- 84개 채널 → 전쟁-결과 필터 → 지오로케이트 → verdict(확인/가능성/미확인/허위)+0–100%+근거 원장.
- NASA FIRMS 실시간 열적 + 교차출처 + 지역 열활동(약한 맥락) 교차검증. 웹 패널·봇 동일 로직.

### 4.4 AI 코파일럿
- 지역 상황 한국어 요약, 규칙기반 이상탐지, 멀티턴 대화. 제공 데이터에만 근거·출처 표기.

### 4.5 타임라인
- 최근 6시간 항적·선박·위성 이동 재생(뷰포트 기준), 45분 트레일 윈도우.

### 4.6 텔레그램 봇
- **조회**: `/status` `/mil` `/verify [지명]` `/ai <질문>`.
- **구독**: `/subscribe` `/unsubscribe`.
- **능동 푸시**: ① 6시간 분쟁 브리핑, ② 이상 항적(비상 스쿼크·AWACS/ISR/급유기/폭격기), ③ 공습·격추 경보(공식 사이렌 100% + 텔레그램 신뢰도).
- 접근 제어: 웹훅 시크릿 + chat_id 화이트리스트/오픈 모드.

## 5. 품질 · 배포 게이트

- `npx tsc --noEmit`(타입) · `npx vitest run`(61 테스트) · `npm run build`(빌드).
- 배포: `vercel --prod`(웹+API), Railway 자동 재빌드(수집기), GitHub 크론.
