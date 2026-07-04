# AirMaven Verify 아이디어 브리프

> 전시 공중·우주 관련 언론보도, 국영매체 발표, SNS 주장이 실제로 맞는지 OSINT·공개 항적·위성/궤도·기상·공식 발표를 조합해 검증하는 **Air/Space Claim Verification Copilot**

- 상태: Implemented prototype
- 작성일: 2026-07-04
- 프로젝트: AirMaven Lite / D4D Hackathon
- 핵심 차별 기능: **항공·우주 사건 주장 검증(Claim Verification)**

## 0. 현재 구현 현황

- 앱 피벗 완료: 기존 상황도/지구본 스타일은 유지하고, 중심 워크플로우를 `Fusion Copilot`에서 `Claim Verification`으로 전환했다.
- 구현된 화면: 주장 검증 대기열, 판정 패널, 근거 매트릭스, 근거 이력 타임라인, OSINT 소스 상태 매트릭스.
- 구현된 공개 연계: GDELT, Google News RSS, OpenSky, CelesTrak, Copernicus STAC, NASA FIRMS, Open-Meteo, OurAirports, AISStream, ICAO FIR/NOTAM.
- 안전 기본값: 전세계 고비용 조회는 standby로 두고 AOI 선택 시에만 수집한다. 누락·비활성·쿼터 제한은 “증거 공백”으로 표시하며, 임의의 가짜 데이터를 생성하지 않는다.

---

## 1. 한 줄 정의

**AirMaven Verify는 “전투기 격추”, “기지 타격”, “위성 감시”, “항공기 손실” 같은 전시 공중·우주 주장을 공개 증거로 교차검증해, 분석관에게 사실 가능성·반박 증거·증거 공백을 보여주는 OSINT 검증 코파일럿이다.**

---

## 2. 문제 배경

현대 분쟁에서는 실제 군사행동만큼이나 **정보전**이 중요하다. 국영매체, 군 발표, SNS, 텔레그램, 유튜브, 익명 OSINT 계정이 거의 실시간으로 사건을 주장하지만, 초기 보도에는 다음 문제가 자주 발생한다.

- 같은 사건을 여러 매체가 반복 인용하지만 원출처는 하나뿐이다.
- 격추·피격·기지 타격 주장이 실제 항적·잔해·위성 증거와 맞지 않을 수 있다.
- 오래된 영상이나 다른 전쟁의 이미지가 재사용될 수 있다.
- AI 생성 영상·이미지가 실제 전장 증거처럼 유포될 수 있다.
- 군용기·스텔스기·민감 항공기는 공개 ADS-B에 잡히지 않기 때문에 “항적 없음”을 곧바로 “사건 없음”으로 해석하면 안 된다.
- 공식 발표도 지연되거나 정치적 이해관계가 반영될 수 있다.

따라서 필요한 것은 단순한 뉴스 요약이 아니라, **주장 단위로 증거를 구조화하고, 지지·반박·공백을 분리해 분석관이 판단할 수 있게 만드는 시스템**이다.

---

## 3. 동기 사례: 2026년 미국-이란 전쟁 중 F-35 격추 주장

2026년 4월 3일, 이란 국영매체와 IRGC 측은 미군 F-35 전투기를 격추했다는 주장을 내놓았다. CBS 보도에 따르면, CENTCOM은 전날 유사한 주장에 대해 모든 미군 전투기가 accounted for 상태라고 반박했고, 이란 측이 같은 false claim을 반복했다고 밝혔다. 이후 AFP Fact Check와 BOOM 등은 관련 항공기 피격·파괴 영상 중 AI 생성 또는 허위로 유포된 사례를 검증했다.

이 사례는 AirMaven Verify가 겨냥하는 문제를 잘 보여준다.

> “보도가 있었는가?”가 아니라, **그 보도가 공개 증거로 얼마나 검증 가능한가?**

---

## 4. 제품 가설

### 4.1 핵심 가설

분석관, 상황실, 정책 담당자, 언론 팩트체커는 전시 공중·우주 사건 주장에 대해 다음 질문에 빠르게 답해야 한다.

1. 누가 무엇을 주장했는가?
2. 주장 시각과 사건 시각은 언제인가?
3. 주장 위치는 어디인가?
4. 공식 발표와 충돌하는가?
5. 공개 항적·위성·기상·NOTAM·OSINT와 맞는가?
6. 영상/이미지 증거는 원본인가, 재사용인가, AI 생성 가능성이 있는가?
7. 현재 공개 데이터만으로 “사실”, “거짓”, “판단 보류” 중 어디에 가까운가?

### 4.2 제품 명제

**AirMaven Verify는 공중·우주 사건을 “지도 위 객체”가 아니라 “검증할 주장”으로 다룬다.**

Maven류 시스템이 전장 데이터를 작전 의사결정과 연결한다면, AirMaven Verify는 공개 정보 환경에서 주장의 신뢰도를 검증한다.

---

## 5. Project Maven과의 차별점

| 구분 | Project Maven / Maven Smart System | AirMaven Verify |
|---|---|---|
| 중심 객체 | target, sensor feed, mission, battlespace object | **claim, evidence, contradiction, gap** |
| 주 목적 | ISR 융합, 전장 상황 인식, 작전/타깃 워크플로우 지원 | **공중·우주 사건 주장 검증** |
| 데이터 성격 | 군 내부 ISR, 드론/위성 영상, 작전 데이터, 다중 센서 | 공개 항적, 공개 위성/궤도, 뉴스, 공식 발표, OSINT |
| 사용자 질문 | “무엇을 탐지했고 어떻게 행동할 것인가?” | **“이 주장은 사실인가? 어떤 증거가 있고 무엇이 비어 있는가?”** |
| 산출물 | 작전 상황도, AI 탐지, 타깃/계획 워크플로우 | 검증 카드, 반박 증거, 증거 공백, 공유 가능한 브리프 |
| 안전 경계 | 군 작전 체계와 연결 가능 | 표적 지정·무기 추천·교전 판단 제외 |

핵심 메시지:

> **AirMaven Verify는 Maven을 축소 복제하지 않는다. 정보전 환경에서 공중·우주 주장의 진위를 검증하는 별도 워크플로우를 제공한다.**

---

## 6. 핵심 사용 시나리오

### 시나리오 A: “미군 F-35가 격추됐다”는 국영매체 주장

입력:

```text
Iranian state media claims IRGC shot down a U.S. F-35 over central Iran on April 3, 2026.
```

시스템 처리:

1. 주장 구조화
   - 주장 주체: IRGC / 이란 국영매체
   - 대상: U.S. F-35
   - 사건 유형: 격추 / aircraft loss
   - 위치: central Iran 또는 보도상 특정 지점
   - 사건 시각: 보도 및 주장 내 시각

2. 증거 수집
   - CENTCOM/DoD 공식 발표
   - 독립 언론 보도
   - 팩트체크 기관 보도
   - 공개 항적 및 tanker/SAR 활동 패턴
   - 위성/궤도 통과 후보
   - 관련 이미지·영상의 재사용/AI 생성 가능성

3. 결과 산출
   - 지지 증거: 원주장, 사진/영상 주장, 관련 SNS 확산
   - 반박 증거: 공식 부인, 독립 확인 부재, 허위 영상 판정
   - 공백: 군용기 ADS-B 비공개 가능성, 위성 이미지 부재, 잔해 검증 부족
   - 판정: Likely False 또는 Unverified, confidence와 caveat 포함

---

## 7. 주요 기능

### 7.1 Claim Card

“누가, 언제, 어디서, 무엇을 주장했는가”를 하나의 구조화 카드로 만든다.

필드 예시:

```json
{
  "claimId": "claim-2026-04-03-irgc-f35",
  "claimType": "aircraft_shootdown",
  "actor": "IRGC / Iranian state media",
  "targetAsset": "U.S. F-35",
  "claimedLocation": "Central Iran / Qeshm variant",
  "claimedTime": "2026-04-03T00:00:00Z",
  "sourceUrls": [],
  "initialReliability": "contested"
}
```

### 7.2 Evidence Timeline

주장 이후 나온 모든 증거를 시간순으로 보여준다.

- 최초 주장
- 공식 반박 또는 확인
- 독립 언론 보도
- OSINT 분석
- 위성 이미지/궤도 관련 정보
- 항적 데이터 확인 결과
- 팩트체크 결과

### 7.3 Contradiction Matrix

주장과 증거가 어떤 지점에서 충돌하는지 표로 보여준다.

| 검증 항목 | 주장 | 확인 결과 | 상태 |
|---|---|---|---|
| 기종 | F-35 격추 | 잔해 이미지가 기종과 불일치 또는 검증 불가 | 반박/불확실 |
| 항적 | 해당 지역 미군기 활동 | 공개 ADS-B로 직접 확인 불가 | 공백 |
| 공식 발표 | 격추 성공 | CENTCOM 부인 | 반박 |
| 영상 증거 | 격추 영상 | AI 생성/과거 이미지 재사용 가능성 | 반박 |
| 독립 확인 | 다수 매체 보도 | 원출처 반복 인용 가능성 | 약함 |

### 7.4 Verification Verdict

최종 출력은 단정적 “정답”이 아니라 **검증 가능성 판정**이다.

판정 단계:

1. `Confirmed` — 독립 증거와 공식/물증이 강하게 일치
2. `Likely True` — 다수 독립 증거가 일치하지만 일부 공백 존재
3. `Plausible but Unverified` — 가능성은 있으나 물증 부족
4. `Inconclusive` — 공개 데이터만으로 판단 불가
5. `Likely False` — 핵심 증거가 반박되거나 모순이 큼
6. `False` — 재사용/조작/공식 정정 등으로 허위가 명확

### 7.5 Shareable Verification Brief

분석관, 지휘부, 언론 대응팀이 바로 공유할 수 있는 1페이지 브리프를 생성한다.

포맷:

```markdown
## Verdict
Likely False / Confidence 72

## Claim
IRGC claimed a U.S. F-35 was shot down over central Iran.

## Supporting Evidence
- Iranian state media claim
- Claimed debris images circulated online

## Contradicting Evidence
- CENTCOM stated all U.S. fighter aircraft were accounted for
- Independent verification absent
- Related viral videos flagged as AI-generated or misleading by fact-checkers

## Evidence Gaps
- F-35 tracks are generally not visible in public ADS-B
- No independently verified crash-site imagery
- No confirmed serial-number or debris-chain evidence

## Analyst Note
Do not treat this as confirmed aircraft loss without independent physical evidence or official acknowledgment.
```

---

## 8. 데이터 소스 후보

| 영역 | 소스 후보 | 목적 | 한계 |
|---|---|---|---|
| 공식 발표 | CENTCOM, DoD, 동맹국 국방부 | 공식 확인/부인 | 정치적 지연·선택적 공개 가능 |
| 공개 항적 | OpenSky, ADSB.lol, Airplanes.live | 민항/일부 군용 항적, tanker/SAR 패턴 | 스텔스기·민감 군용기 누락 가능 |
| 위성/궤도 | CelesTrak, satellite.js, 공개 위성 이미지 제공자 | 해당 시간대 관측 가능성, 위성 통과 후보 | 실제 촬영 여부·해상도·구름 영향 제한 |
| 기상 | Open-Meteo, METAR/TAF | 비행/시야/구름 조건 검토 | 고해상도 현장 기상과 차이 가능 |
| 뉴스/OSINT | GDELT, NewsAPI, 수동 URL 입력 | 원출처 추적, 보도 확산 경로 | 같은 원출처 반복 인용 가능 |
| 팩트체크 | AFP Fact Check, BOOM, Bellingcat류 분석 | 허위 영상·이미지 검증 참고 | 모든 사건을 즉시 커버하지 않음 |
| 이미지/영상 | reverse image search, keyframe extraction, EXIF, AI detection | 재사용/조작/AI 생성 가능성 | 완전 자동 판정은 위험, human review 필요 |

---

## 9. MVP 범위

해커톤 MVP에서는 “완전 자동 진실 판정”이 아니라, **검증 워크플로우를 설득력 있게 보여주는 것**을 목표로 한다.

### 반드시 구현할 것

1. **Claim 입력/선택**
   - 수동 입력 또는 샘플 사건 선택
   - 예: “IRGC claims U.S. F-35 shot down”

2. **Claim 구조화 카드**
   - actor, asset, location, time, source 분리

3. **Evidence Timeline**
   - 공식 발표
   - 뉴스/팩트체크 링크
   - 항적/위성/기상 확인 결과

4. **Verdict Panel**
   - Likely False / Inconclusive 등 판정
   - supporting evidence, contradicting evidence, evidence gaps 분리

5. **Source Health / Caveat**
   - 공개 항적 부재는 반증이 아님
   - 군용기 데이터 누락 가능성 표시
   - AI 영상 판정은 보조 신호로만 표시

### 선택 구현

- 지도 위 claimed location 표시
- 위성 통과 후보 레이어
- 항적 replay 또는 주변 항공 활동 요약
- 공유용 Markdown 브리프 export
- 이미지/영상 URL 입력 후 수동 포렌식 체크리스트

---

## 10. UI 제안

### 10.1 Claim Inbox

좌측 패널:

- 신규 주장 리스트
- claim type 필터: aircraft shootdown, base strike, drone loss, satellite claim
- source type 필터: state media, official, social, independent media

### 10.2 Verification Workspace

중앙:

- 지도
- claimed location
- 관련 항적/공항/공역
- 위성 통과 후보
- 관련 사건 타임라인

### 10.3 Evidence & Verdict Panel

우측:

- Verdict
- Confidence
- Supporting evidence
- Contradicting evidence
- Evidence gaps
- Analyst caveats
- Export brief 버튼

---

## 11. 판단 점수 모델 초안

최종 confidence는 단일 AI 판단이 아니라 여러 신호의 합성으로 계산한다.

### 11.1 지지 점수

- 독립 출처 수
- 원출처 다양성
- 공식 확인 여부
- 검증 가능한 잔해/좌표/시각 존재
- 위성 또는 지상 영상과 일치
- 항공 사고·SAR 패턴과 일치

### 11.2 반박 점수

- 공식 부인
- 동일 주장의 반복 허위 이력
- 영상/이미지 재사용 판정
- 주장 기종과 잔해 불일치
- 시간·위치 불일치
- 같은 원출처 반복 인용

### 11.3 공백 점수

- 공개 항적 부재
- 위성 이미지 부재
- 좌표 불명확
- 사건 시각 불명확
- 독립 물증 부재
- 군용기 비공개 가능성

### 11.4 원칙

- “항적 없음”은 곧바로 “거짓”이 아니다.
- “공식 부인”만으로 곧바로 “거짓”도 아니다.
- 단, 허위 영상·재사용 이미지·기종 불일치가 확인되면 반박 점수를 크게 높인다.
- 최종 판정은 항상 citation과 caveat를 함께 제공한다.

---

## 12. 안전·윤리 경계

AirMaven Verify는 다음을 하지 않는다.

- 표적 지정
- 타격 추천
- 무기체계 선택
- 실시간 교전 지원
- 특정 군용기의 은닉 위치 추적 또는 노출
- 확인되지 않은 정보를 확정 표현으로 전파

AirMaven Verify는 다음을 한다.

- 공개 주장을 구조화한다.
- 공개 증거를 교차검증한다.
- 반박 증거와 증거 공백을 표시한다.
- 분석관이 판단할 수 있도록 citation과 confidence를 제공한다.
- 불확실한 경우 판단 보류를 권고한다.

---

## 13. 성공 지표

| 지표 | 설명 |
|---|---|
| Claim-to-Brief Time | 주장 입력 후 검증 브리프 생성까지 걸리는 시간 |
| Citation Coverage | 최종 판정에 연결된 출처 수와 품질 |
| Contradiction Detection Rate | 시간·위치·기종·출처 모순 탐지율 |
| Evidence Gap Clarity | 판단 불가 사유가 명확히 표시되는 정도 |
| Analyst Trust | 분석관이 결과를 그대로 공유/보고 초안으로 활용할 수 있는 정도 |
| False Certainty Avoidance | 불확실한 사건을 과도하게 확정하지 않는 정도 |

---

## 14. 발표용 메시지

### 14.1 10초 피치

> **AirMaven Verify는 전시 항공기 격추·기지 타격 같은 주장이 사실인지 OSINT, 공개 항적, 위성/궤도, 공식 발표를 대조해 검증하는 공중·우주 정보검증 코파일럿입니다.**

### 14.2 Maven과의 비교 피치

> Project Maven이 전장 데이터를 작전 의사결정으로 연결한다면, AirMaven Verify는 정보전 속 공중·우주 주장이 사실인지 공개 증거로 검증합니다. 우리의 핵심 객체는 target이 아니라 claim입니다.

### 14.3 안전 피치

> 우리는 표적을 찾지 않습니다. 우리는 주장을 검증합니다. 격추·피격·타격 보도가 나왔을 때 무엇이 사실이고, 무엇이 모순이며, 무엇이 아직 비어 있는지 보여줍니다.

---

## 15. 구현 로드맵

### Phase 1: 해커톤 데모

- 샘플 claim 3개 구성
  - F-35 격추 주장
  - 공군기지 타격 주장
  - 드론 격추 영상 주장
- Claim Card UI
- Evidence Timeline UI
- Verdict Panel UI
- 공개 위성 이미지는 “고해상도 자동 판독”이 아니라 scene metadata, 촬영시각, cloud cover, 외부 브라우저 링크 중심으로 표시
- 공개 항적은 “직접 반증”이 아니라 tanker/SAR/민항 우회/공개 관측 항공활동의 보조 증거로 표시
- 수동/반자동 evidence 입력
- 기존 AirMaven 지도·위성·항적 레이어와 연결

### Phase 2: 반자동 수집

- URL 입력 시 claim extraction
- 공식 발표/뉴스 검색 연동
- 항적 데이터 시간창 조회
- CelesTrak 기반 위성 통과 후보 계산
- 이미지/영상 포렌식 체크리스트 자동화

### Phase 3: 운영형 검증 워크플로우

- claim inbox 자동 수집
- 원출처 추적 및 중복 보도 클러스터링
- evidence graph 구축
- analyst review state
- shareable intelligence brief export
- audit log / chain-of-custody

---

## 16. 공개 정보 기반 구현 현실성 평가

AirMaven Verify는 공개 정보만으로 **검증 보조 시스템**까지는 현실적으로 구현 가능하다. 다만 공개 정보만으로 전투기 격추 여부를 자동 확정하는 시스템으로 포지셔닝하면 과장이다.

### 16.1 결론 요약

| 기능 | 공개 정보만으로 가능성 | 현실적 구현 수준 |
|---|---:|---|
| 언론/SNS/국영매체 주장 수집 | 높음 | GDELT, Google News RSS, 수동 URL 입력으로 가능 |
| 공식 발표 대조 | 높음 | CENTCOM, DoD, 각국 국방부, 동맹국 발표 링크 수집 가능 |
| 공개 항적 확인 | 중간 | 민항 및 일부 공개 군용기만 가능 |
| F-35/B-2 등 민감 군용기 직접 항적 확인 | 낮음 | 공개 ADS-B에는 안 잡히는 것이 정상일 수 있음 |
| 위성 궤도/통과 후보 계산 | 높음 | CelesTrak GP/TLE + satellite.js로 가능 |
| 공개 위성 이미지 scene 조회 | 중간~높음 | Copernicus STAC, Landsat 계열 catalog 조회 가능 |
| 위성 이미지로 전투기 잔해 식별 | 낮음 | 무료 공개 해상도로는 거의 불가 |
| 대형 폭발/기지 피해 흔적 확인 | 중간 | Sentinel-1/2, Landsat로 제한적 가능 |
| AI 영상/재사용 이미지 탐지 | 중간 | 자동 확정이 아니라 포렌식 체크리스트/보조 신호로 가능 |

### 16.2 항적 확인의 현실적 한계

OpenSky 같은 공개 ADS-B API는 `/states/all` bbox 조회와 state vector 확인을 지원하므로 특정 시간·지역의 공개 항공활동을 확인하는 데 유용하다. 하지만 OpenSky의 공개 API는 과거 조회 범위, 시간 해상도, credit/rate limit 제한이 있다.

더 중요한 한계는 **군용기 가시성**이다. 미국 FAA는 국가안보, 정보, 법집행 등 민감 임무에서는 ADS-B Out 송신을 끌 수 있는 예외를 인정한다. 따라서 F-35 같은 전투기가 공개 항적에 없다는 사실은 “격추가 없었다”의 직접 증거가 아니다.

AirMaven Verify에서 항적 데이터는 다음처럼 사용해야 한다.

- “해당 전투기가 없었다”를 증명하는 직접 반증으로 사용하지 않는다.
- tanker, ISR 지원기, SAR 항공기, 민항 우회 등 주변 패턴을 확인하는 보조 증거로 사용한다.
- 결과 문구는 “공개 항적상 직접 corroboration 없음” 또는 “공개 ADS-B로는 확인 불가”로 제한한다.

### 16.3 위성 이미지 조회의 현실적 한계

공개 위성 데이터는 다음 수준까지는 충분히 구현 가능하다.

- CelesTrak GP/TLE 데이터로 해당 시간대 공개 위성 통과 후보 계산
- Copernicus STAC API로 Sentinel scene 검색
- Sentinel-2 optical scene의 촬영시각, cloud cover, preview/link 표시
- Sentinel-1 SAR scene 존재 여부 확인
- Landsat 8/9 scene 조회 및 외부 브라우저 링크 제공

하지만 무료 공개 위성만으로 다음을 기대하면 안 된다.

- 격추된 전투기 잔해 식별
- 소형 충돌 흔적 확인
- 수시간 내 고해상도 피해 판독
- 특정 상업 위성이 실제로 해당 순간을 촬영했는지 자동 확정

Sentinel-2는 10m급 optical imagery와 5일 수준 revisit가 강점이지만, 작은 잔해 식별에는 부족하고 구름 영향을 받는다. Landsat 8/9는 15~30m급 해상도와 약 8일 수준의 조합 revisit로 대형 변화 탐지에는 유용하지만 항공기 잔해 검증에는 부적합하다. Sentinel-1 SAR은 구름·야간 조건에서도 scene 확인이 가능하지만, 해석 난도가 높고 소형 잔해 판독에는 제한이 크다.

상업 위성은 PlanetScope의 near-daily 3.7m급, SkySat의 50cm급 tasking/archive처럼 더 유리한 옵션이 있으나, 보통 subscription·tasking·구매가 필요하다. 해커톤 MVP에서는 상업 위성 이미지를 직접 확보하기보다 “고해상도 상업 영상 필요”를 evidence gap으로 표시하는 편이 현실적이다.

### 16.4 제품 표현 원칙

금지해야 할 표현:

> “공개 항적과 위성 이미지로 격추 사실을 자동 판정합니다.”

권장 표현:

> “공개 항적, 위성/궤도, 기상, 공식 발표, OSINT를 대조해 전시 항공 사건 주장의 신뢰도와 증거 공백을 분석합니다.”

판정 원칙:

- 항적 없음 ≠ 사건 없음
- 위성 이미지 없음 ≠ 사건 없음
- 공식 부인 ≠ 자동 허위
- 허위 영상/재사용 이미지 + 공식 부인 + 독립 증거 부재는 `Likely False` 판단 근거가 될 수 있음
- 공개 증거만으로 부족하면 `Inconclusive` 또는 `Plausible but Unverified`를 적극 사용한다.

### 16.5 MVP 구현 권장 범위

해커톤 MVP에서는 “자동 진실 판정”보다 다음 3가지를 명확히 보여주는 것이 현실적이다.

1. **Claim Card**
   - 누가, 언제, 어디서, 무엇을 주장했는지 구조화
2. **Evidence Timeline**
   - 공식 발표, 뉴스/팩트체크, 공개 항적 조회 결과, 위성 scene 후보, 기상 조건을 시간순 표시
3. **Verdict Panel**
   - supporting evidence, contradicting evidence, evidence gaps, caveat, confidence를 분리 표시

특히 위성은 이미지 판독보다 다음 항목 중심으로 구현한다.

- 해당 AOI/일자의 Sentinel/Landsat scene 존재 여부
- 촬영시각
- cloud cover
- sensor type(optical/SAR)
- Copernicus Browser 또는 USGS/NASA 계열 외부 링크
- “이 해상도로는 잔해 식별 불가” 같은 caveat

---

## 17. 결론

AirMaven Verify는 기존 AirMaven의 공중·우주 데이터 융합 역량을 유지하면서도, Project Maven과 정면으로 겹치지 않는 독자적 차별점을 만든다.

- 기존 방향: 공중·우주 상황 인식 대시보드
- 개선 방향: **전시 공중·우주 주장 검증 코파일럿**

이 피벗의 장점은 명확하다.

1. 정보전이라는 실제 문제를 겨냥한다.
2. 공개 데이터 기반 MVP와 잘 맞는다.
3. Project Maven의 작전/타깃 워크플로우와 차별화된다.
4. 안전하고 윤리적인 human-in-the-loop 메시지를 만들 수 있다.
5. 해커톤 발표에서 “왜 필요한가”가 사례 중심으로 즉시 설명된다.

최종 포지셔닝:

> **AirMaven Verify: 공개 공중·우주 증거로 전시 항공 사건 주장을 검증하는 OSINT 코파일럿**

---

## 18. 참고 자료

- CSIS, “What Is Maven Smart System, and What Does It Do?”, 2026-06-02: https://www.csis.org/analysis/what-maven-smart-system-and-what-does-it-do
- Palantir Blog, “Maven Smart System: Innovating for the Alliance”, 2026-03-05: https://blog.palantir.com/maven-smart-system-innovating-for-the-alliance-5ebc31709eea
- CBS News live updates, Iran F-35 shootdown claim and CENTCOM denial, 2026-04-03: https://www.cbsnews.com/live-updates/iran-war-us-trump-warns-more-coming-oil-gas-strait-hormuz/
- AFP Fact Check, AI-generated video falsely shared as U.S. military plane struck by Iran, 2026: https://factcheck.afp.com/doc.afp.com.B2U99ZR
- BOOM Fact Check, “Video Of Destroyed, Abandoned US Fighter Jets Is AI-Generated”, 2026: https://www.boomlive.in/fact-check/viral-video-us-fighter-jets-abandoned-destroyed-f-35-iran-claim-fact-check-30904
- OpenSky Network REST API documentation: https://openskynetwork.github.io/opensky-api/rest.html
- Federal Register, “Revision to Automatic Dependent Surveillance-Broadcast (ADS-B) Out Equipment and Use Requirements”, 2019-07-18: https://www.federalregister.gov/documents/2019/07/18/2019-15248/revision-to-automatic-dependent-surveillance-broadcast-ads-b-out-equipment-and-use-requirements
- CelesTrak, “A New Way to Obtain GP Data”: https://celestrak.org/NORAD/documentation/gp-data-formats.php
- CelesTrak Usage Policy, 2026-05-22 update: https://celestrak.org/usage-policy.php
- Copernicus Data Space Ecosystem STAC API documentation: https://documentation.dataspace.copernicus.eu/APIs/STAC.html
- ESA Sentinel-2 mission page: https://www.esa.int/Applications/Observing_the_Earth/Copernicus/Sentinel-2
- NASA Landsat 9 mission page: https://science.nasa.gov/mission/landsat-9/
- Planet Monitoring / PlanetScope overview: https://www.planet.com/products/satellite-monitoring/
- Planet High-Resolution Satellite Tasking / SkySat overview: https://www.planet.com/products/high-resolution-satellite-imagery/
