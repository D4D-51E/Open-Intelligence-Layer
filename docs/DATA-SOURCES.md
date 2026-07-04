# 외부 데이터 · API 목록

AirMaven가 사용하는 모든 외부 데이터 소스. **공개 데이터**만 사용하며, 가능한 한 무-API키 소스를 택했다. API 키가 필요한 소스는 전부 **서버 측 환경변수**로만 다루고 브라우저에 노출하지 않는다.

## 실시간 트랙 · 위치

| # | 소스 | 용도 | 엔드포인트 | 키 | 갱신 |
|---|---|---|---|---|---|
| 1 | **adsb.lol** | 항공기 ADS-B 항적, 비상 스쿼크(7700/7600/7500), 군용/고가치 자산 | `api.adsb.lol/v2` (`/mil`, `/squawk/{n}`, `/point/...`) | 무 | 상시(수집기 60초) |
| 2 | **AISStream** | 선박 AIS 위치(글로벌 WebSocket 스트림) | `stream.aisstream.io/v0/stream` | `AISSTREAM_API_KEY` | 상시 스트림 |
| 3 | **Celestrak** | 위성 궤도요소(TLE), SGP4 전파용 | `celestrak.org/NORAD/elements/gp.php` | 무 | ~일 1회(클라 전파는 실시간) |

## 위협 · 사건

| # | 소스 | 용도 | 엔드포인트 | 키 | 갱신 |
|---|---|---|---|---|---|
| 4 | **NASA FIRMS** | 열 이상(화재) 탐지 — 타격주장 열적 교차검증 | `firms.modaps.eosdis.nasa.gov/api/area/csv/...` | `NASA_FIRMS_MAP_KEY` | ~수 시간 |
| 5 | **EMSC seismicportal** | 지진(얕은 진원=폭발형 필터) | `www.seismicportal.eu/fdsnws/event/1/query` | 무 | 실시간 |
| 6 | **air_alert_ua** (Telegram) | 우크라이나 공습경보(오블라스트 단위) | `t.me/s/air_alert_ua` | 무 | 실시간(폴) |
| 7 | **Tzeva Adom** | 이스라엘 Pikud HaOref 공식 사이렌 미러(oref.org.il 해외 IP 차단 대체) | `api.tzevaadom.co.il/notifications` | 무 | 실시간(폴) |
| 8 | **FAA NOTAM** | 항공고시보(공역 통제) | `notams.aim.faa.gov` | 무 | 주기 수집 |

## 공역 · 지리

| # | 소스 | 용도 | 엔드포인트 | 키 | 갱신 |
|---|---|---|---|---|---|
| 9 | **OpenAIP** | 전 세계 공역 벡터 타일(분류별 색상) | `api.tiles.openaip.net` (프록시: `/api/openaip/{z}/{x}/{y}`) | `OPENAIP_API_KEY` | 정적 타일 |
| 10 | **data.go.kr — 국토교통부 항공교통본부** | ROK 항공로(항로 구조) → 좌표 해석 후 GeoJSON | odcloud `15122908/v1` | 무(공공키) | 정적 |
| 11 | **ROK AIP (KADIZ·P-73 등)** | 남한 특수공역(정적 GeoJSON, `public/data/kr-airspace.json`) | 정적 | — | 정적 |
| 12 | **BigDataCloud** | 역지오코딩(뷰포트 국가/해역 라벨, 클라이언트) | keyless client API | 무 | 온디맨드 |

## OSINT · 텍스트

| # | 소스 | 용도 | 엔드포인트 | 키 | 갱신 |
|---|---|---|---|---|---|
| 13 | **공개 Telegram 채널(84개)** | OSINT 타격/피해/사상 결과 게시물 | `t.me/s/<channel>` (프리뷰 스크레이핑) | 무 | 15분 수집 |
| 14 | **GDELT** | 글로벌 뉴스 이벤트 | `api.gdeltproject.org` | 무 | 주기 수집 |
| 15 | **방위·국제 RSS** | 국방/국제 뉴스 피드 | USNI, Defense News, Breaking Defense, TWZ, DoD, Al Jazeera, BBC, 연합뉴스(EN) | 무 | 주기 수집 |
| 16 | **Open-Meteo** | 기상(관심지역 관측) | `api.open-meteo.com/v1/forecast` | 무 | 주기 수집 |
| 17 | **Google Translate(무키)** | 비-라틴 OSINT 텍스트 영어 번역 | `translate.googleapis.com/translate_a/single` | 무 | 온디맨드 |

## AI

| # | 소스 | 용도 | 엔드포인트 | 키 | 갱신 |
|---|---|---|---|---|---|
| 18 | **OpenAI** | 코파일럿(지역 요약·이상탐지), 봇 브리핑 | `api.openai.com` (기본 gpt-5.4-mini) | `OPENAI_API_KEY` | 온디맨드 |
| 19 | **Telegram Bot API** | 봇 조회·능동 푸시(웹훅 + sendMessage) | `api.telegram.org/bot<token>` | `TELEGRAM_BOT_TOKEN` | 실시간 |

---

## 환경변수(시크릿) 요약

| 변수 | 용도 | 위치 |
|---|---|---|
| `DATABASE_URL` | Neon Postgres 연결 | Vercel · Railway |
| `AISSTREAM_API_KEY` | AIS 스트림 | Railway(수집기) |
| `NASA_FIRMS_MAP_KEY` | FIRMS 열적 | Vercel |
| `OPENAIP_API_KEY` | 공역 타일 | Vercel |
| `OPENAI_API_KEY` | AI 코파일럿·브리핑 | Vercel |
| `COPILOT_MODEL` | AI 모델 선택(기본 `gpt-5.4-mini`) | Vercel |
| `TELEGRAM_BOT_TOKEN` | 봇 | Vercel |
| `TELEGRAM_WEBHOOK_SECRET` | 웹훅 위조 차단 | Vercel |
| `TELEGRAM_ALLOWED_CHAT_IDS` / `TELEGRAM_OPEN` | 봇 접근 제어 | Vercel |
| `CRON_SECRET` | 수집·푸시 크론 인증 | Vercel · GitHub Actions |

> 모든 키는 서버 측 전용. 클라이언트 번들·레포에 하드코딩하지 않는다.

## 정직성 · 한계 (데이터 관점)

- **날조 없음**: 합성 트랙/좌표/열점을 만들지 않는다. 채널은 라이브 도달성 검증을 통과한 것만.
- **계산된 위치**: 위성은 실측 텔레메트리가 아니라 공개 TLE로 SGP4 전파한 위치(최신 元素 기준 ~km).
- **이스라엘 경보**: oref.org.il이 해외 IP를 차단하므로 동일 공식 데이터의 **Tzeva Adom 미러**를 사용.
- **근사 실시간**: 15분/5분 크론(GitHub Actions)은 부하 시 지연될 수 있어 "즉시"는 ~5–15분 근사.
