# AirMaven Lite 개선 백로그

작성일: 2026-07-01
대상 과제: Maven-style Air ISR Fusion Copilot / 공개 항적·기상·OSINT·위성·공역 데이터를 융합한 분석관 보조 상황판

## 현재 구현 상태

| 기능 | 상태 | 판단 |
|---|---|---|
| OpenSky 항적 | 구현됨 | 공개 ADS-B 한계와 rate limit을 TTL 캐시로 방어 |
| Open-Meteo 기상 | 구현됨 | AOI 중심점 기상 맥락 제공 |
| GDELT OSINT | 구현됨/불안정 | 429 발생 시 backoff 후 Google News로 대체 |
| Google News RSS | 구현됨 | OSINT fallback |
| CelesTrak 위성 | 구현됨 | 공개 궤도 인식 및 ground track 표시 |
| OurAirports | 구현됨 | 공항/비행장 참고 레이어 |
| ICAO FIR | 구현됨 | AOI 중심점 기준 FIR 표시, 24h TTL |
| AISStream | 구현됨 | 서버 WebSocket 수집, 수신 0/캐시 상태 분리 |
| NOTAM | 미지원 | 현재 ICAO API 목록에 NOTAM endpoint 없음 |
| OSINT 지도 이벤트 | 비활성 | 부정확한 자동 지오코딩 방지를 위해 비활성 |

## 즉시 적용한 개선

1. 소스 상태 라벨 세분화
   - `라이브`, `캐시 정상`, `연결됨 · 수신 0`, `레이트리밋`, `미지원`, `비활성`, `사용 불가`로 분리.
   - 장애, 정상 캐시, 의도적 비활성을 구분한다.

2. 소스별 사유 기록
   - `sourceReasons`를 live cache에 추가.
   - 예: GDELT 429, NOTAM endpoint 미지원, OSINT 지도 이벤트 비활성, AIS 수신 0.

3. GDELT 429 backoff
   - 429 발생 시 `GDELT_BACKOFF_MS` 동안 재호출을 줄이고 Google News RSS로 대체.

4. AIS 수집 보강
   - 기본 WebSocket 수집 window를 20초로 확대.
   - 수신 0건이면 `empty`, 직전 AIS 캐시가 신선하면 `cached`로 유지.

5. NOTAM/OSINT 이벤트 상태 명확화
   - NOTAM은 현재 계정 API 목록 기준 `미지원`.
   - OSINT 지도 이벤트는 정확도 정책상 `비활성`.

## 다음 우선순위

### P0 — 데모 방어력

| 항목 | 이유 | 구현 방향 |
|---|---|---|
| 소스 상태 패널 고정 표시 | 심사위원이 “왜 안 나오나”를 바로 물을 가능성이 높음 | Ops 화면에도 source status/reason 요약을 작게 상시 표시 |
| 데이터 정확도 설명 카드 | 실제 데이터 신뢰성 과제에서 중요 | OpenSky/AIS/FIR/OSINT의 한계와 TTL을 한 줄씩 표시 |
| 수집 로그 요약 압축 | 현재 로그가 길어질 수 있음 | 실패/대체/캐시 사유만 강조 |

### P1 — 과제 적합도 강화

| 항목 | 이유 | 구현 방향 |
|---|---|---|
| 이벤트 중심 entity graph | Maven-style “융합”을 더 잘 보여줌 | 항공기·선박·FIR·뉴스를 relatedIds로 묶은 event object 생성 |
| AOI activity baseline | 이상징후 탐지 설득력 강화 | 최근 N개 스냅샷 대비 항적/선박 수 변화율 계산 |
| 출처별 confidence 모델 | citation 품질 강화 | source reliability, freshness, geocoding certainty를 분리 |
| “분석관 확인 큐” | Copilot의 사용자 역할 명확화 | anomaly를 검토/보류/무시 상태로 로컬 UI 관리 |

### P2 — 실제 데이터 레이어 확장

| 항목 | 이유 | 구현 방향 |
|---|---|---|
| NOTAM 대체 provider | 공역 이벤트의 공식성 보강 | ICAO 계정에 NOTAM endpoint가 생기면 연결, 아니면 FAA/Notamify/Cirium 검토 |
| 검증된 OSINT 지도 이벤트 | 지도 위 사건 포인트가 있으면 데모 임팩트 큼 | 명시 좌표 또는 신뢰 가능한 장소명 geocoding만 허용 |
| 공항별 METAR/TAF | 항공 상황판 신뢰도 상승 | 무료 항공기상 API 검토, AOI 주변 공항 weather layer 추가 |
| FIR 경계 polygon | 현재는 중심점 FIR만 표시 | 공식/공개 FIR 경계 데이터 확보 시 polygon 표시 |

## 과제 포커스 기준으로 추가 발굴한 개선점

### 1. “멀티소스 융합”이 화면에서 더 직접 보여야 함
현재는 레이어가 많지만, 각 소스가 왜 연결되는지 한눈에 약하다. 심사 관점에서는 단순 지도보다 “융합된 사건”이 중요하다.

개선안:
- `Fusion Event` 객체 생성
- 예: `대만해협 항적 증가 + Google News 군사 기사 + RCAA FIR + 기상 양호`
- 이벤트 카드에 관련 출처와 confidence를 함께 표시

### 2. 이상징후가 단순 rule 이상으로 보여야 함
현재 rule 기반 신호는 안전하지만 다소 단순하다.

개선안:
- activity spike: 최근 캐시 대비 항적 수 증가
- maritime-air correlation: 선박/AIS와 항공 활동 동시 증가
- weather exception: 악천후인데 항적 유지/증가
- airspace context: FIR가 민감 지역일 때 추가 review cue

### 3. “왜 이 데이터만 보이는가”를 제품 안에서 답해야 함
사용자가 계속 묻는 핵심 질문이다. README보다 UI 안에서 답해야 한다.

개선안:
- 각 레이어에 `coverage`, `lastUpdated`, `emptyReason` 표시
- 예: `AIS: 연결됨, 20초 window 수신 0, 직전 캐시 없음`

### 4. 지도보다 “검토 큐”가 Maven 느낌을 만든다
Project Maven 스타일은 단순 지도 표시가 아니라 분석관의 검토 시간을 줄이는 것이 핵심이다.

개선안:
- 우측 패널을 `확인 큐` 중심으로 재구성
- 각 큐: 원인, 근거, 신뢰도, 다음 확인 액션

### 5. 실제 데이터 정확도 정책을 기능으로 보여줘야 함
합성 포인트를 제거한 결정은 좋다. 이걸 약점이 아니라 강점으로 포장해야 한다.

개선안:
- `정확도 정책: 좌표 없는 뉴스는 지도에 찍지 않음`
- `미지원/비활성/레이트리밋`을 명확히 보여 데이터 무결성 강조

## 데모 메시지

> AirMaven Lite는 공개 항적, AIS, 기상, 위성, ICAO FIR, 뉴스 OSINT를 한 화면에 융합하되, 출처가 불명확하거나 좌표 정확도가 낮은 데이터는 지도에 억지로 표시하지 않습니다. 대신 각 소스의 상태와 한계를 명시하고, 분석관이 검토해야 할 신호만 확인 큐로 올립니다.


## 2026-07-01 구현 업데이트 — Fusion Copilot

- `Fusion Event` 객체 생성 구현: 항적, AIS, FIR, 기상, 위성, OSINT 출처를 하나의 검토 카드로 묶고 confidence factor와 citation을 노출한다.
- 자연어 질의 프리셋 구현: 한국어 데모 질의를 deterministic parser로 AOI/module/focus intent에 매핑한다.
- 분석관 검토 큐 구현: `대기`, `검토 필요`, `확인됨`, `보류/무시` 상태를 로컬 UI로 관리한다.
- 안전 제약 유지: 좌표 없는 OSINT는 지도 이벤트로 만들지 않고, 데이터 공백은 합성하지 않으며, 표적 지정/타격 권고/자동 교전 판단은 제외한다.
- 최종 리뷰 보완: citation 없는 overview 카드는 생성하지 않는다. 실제 출처가 없으면 빈 상태를 표시하고, 명시적 수집 공백은 `source-status` citation을 가진 데이터 품질 카드로만 노출한다.
- 공개 캐시 보안/품질 보완: upstream HTML 오류 본문을 `/data/live-scenarios.json`에 저장하지 않고 HTTP 상태/서비스명 수준으로 축약한다.
- 운영 상태 보완: `empty`는 연결 성공/수신 0의 공백 상태로 유지하지만 정상 수집 카운트에는 포함하지 않는다.
- 지도 경계 보완: OSM은 기본 배경 타일로 유지하되, 상황 데이터는 브라우저에서 외부 API를 직접 호출하지 않고 `API 스냅샷` 캐시에서만 읽는다고 UI/문서에 명시한다.
