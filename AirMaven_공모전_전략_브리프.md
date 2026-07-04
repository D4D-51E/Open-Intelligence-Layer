# AirMaven Lite 공모전 전략 브리프

> 대상 과제: **Maven형 공중 ISR 융합 코파일럿 / Maven-style Air ISR Fusion Copilot**  
> 행사: **D4D | Deploy for Defense Hackathon APAC - SEOUL 2026**  
> 작성일: **2026-07-04 KST**  
> 목적: 3분 발표와 제출물에서 평가 기준별 설득력을 높이기 위한 제품·데모·피치 전략 정리

---

## 1. 한 줄 전략

**AirMaven Lite는 공개 항적·위성궤도·기상·OSINT를 단순히 지도에 모으는 앱이 아니라, 분석관에게 출처·신뢰도·데이터 공백이 붙은 “검토할 사건 큐”를 올려주는 Air ISR Fusion Copilot이다.**

심사위원에게는 다음 문장으로 설명한다.

> AirMaven Lite는 공중·우주 공개 데이터를 융합해 “위협 확정”이 아니라 “분석관이 먼저 봐야 할 신호”를 생성하는 human-in-the-loop ISR 코파일럿입니다.

---

## 2. 공식 정보 요약

| 항목 | 내용 | 출처 |
| --- | --- | --- |
| 행사명 | D4D | Deploy for Defense Hackathon APAC - SEOUL 2026 | D4D Luma |
| 기간 | 2026년 7월 3일 ~ 7월 5일 | D4D Luma / 로컬 참가자 안내 CSV |
| 해킹 시간 | 2026년 7월 4일 10:00 ~ 7월 5일 10:00 KST | 로컬 참가자 안내 CSV |
| 제출 마감 | 2026년 7월 5일 10:00 KST | 로컬 참가자 안내 CSV |
| 1차 심사 | 팀당 3분 발표 + 2분 질의응답 | D4D Luma |
| 총 상금 | 1,500만 원 | D4D Luma |
| OSINT 트랙 상금 | 500만 원, StealthMole 제공 | D4D Luma |
| 관련 파트너 | StealthMole, Palantir, BONE AI, F4GE, Morph Systems, Prairie Schooner 등 | D4D Luma / StealthMole LinkedIn |

참고 링크:

- D4D 공식 행사 페이지: <https://luma.com/2ew4xn7b>
- StealthMole × Palantir D4D 안내: <https://www.linkedin.com/posts/stealthmole_stealthmole-palantir-d4d-activity-7475389764074950656-xdKC>

---

## 3. 평가 기준 해석

### 3.1 1단계 Track Judging

| 공식 기준 | 비중 | AirMaven 대응 전략 |
| --- | ---: | --- |
| 문제 적합성 / Problem Fit | 25% | T2의 “Maven형 공중 ISR 융합 코파일럿”을 정면으로 해결한다. |
| 군 적용 가능성 / Military Deployability | 30% | 공개 데이터 MVP에서 시작하지만 군 내부 센서·기밀 데이터 어댑터로 확장 가능한 구조를 강조한다. |
| 기술 구현 / Technical Execution | 25% | OpenSky, CelesTrak, Open-Meteo, OSINT를 정규화해 Fusion Event로 묶은 구현을 보여준다. |
| 창의성 / Creativity | 20% | 지도+챗봇이 아니라 citation·confidence·source health가 있는 분석관 검토 워크플로임을 강조한다. |

### 3.2 Main Stage Finals

| 공식 기준 | 비중 | AirMaven 대응 전략 |
| --- | ---: | --- |
| 임팩트 및 확장성 / Impact & Scalability | 35% | 공중·우주 ISR뿐 아니라 해상, C2, 군수, 사이버 OSINT로 확장 가능한 융합 구조를 제시한다. |
| 글로벌 확장 가능성 / Global Readiness | 25% | APAC, 대만해협, 남중국해, KADIZ 등 글로벌 안보 AOI에 적용 가능한 구조로 설명한다. |
| 기술 난이도 및 차별성 / Technical Difficulty / Moat | 20% | 다중 데이터 소스, anomaly logic, confidence factor, source provenance를 기술 차별점으로 제시한다. |
| 창업가·팀 추진력 / Founder & Team Drive | 20% | 24시간 내 실제 작동 데모와 테스트·빌드 통과 근거를 제시한다. |

---

## 4. 출제자 의도와 숨은 실전 기준

| 추론 기준 | 근거 | 실전 대응 | 확신도 |
| --- | --- | --- | --- |
| “작동하는 것”이 중요하다 | D4D는 hands-on build와 deployable solution을 강조한다. | 발표에서 코드·데모·테스트 결과를 보여준다. | 높음 |
| 단순 챗봇은 약하다 | T2 문제는 OSINT 모듈 오케스트레이션, 교차검증, citation, 시각화를 요구한다. | 자연어 질의는 입구로만 쓰고, 결과는 Fusion Event와 검토 큐로 보여준다. | 높음 |
| 데이터 신뢰도와 출처가 핵심이다 | T2 문제에 citation, 신뢰도 스코어링, 환각 방지가 포함된다. | source health, confidence factor, citation을 UI에 노출한다. | 높음 |
| 군 적용 가능성은 “기밀 데이터 사용”이 아니라 “군 워크플로 확장성”이다 | 공개·가상 데이터 활용 가능 안내가 있다. | 공개 API 어댑터 → 군 내부 센서 어댑터로 교체 가능한 구조를 설명한다. | 중상 |
| 안전 경계가 중요하다 | 방산·국방 AI 프로젝트 특성상 표적화·교전 자동화 오해가 생길 수 있다. | 표적 지정, 타격 추천, 자동 교전 판단은 제외한다고 명확히 말한다. | 높음 |

---

## 5. 제품 정의

### 5.1 제품명

**AirMaven Lite**  
**Maven-style Air ISR Fusion Copilot**

### 5.2 핵심 사용자

- 공군·합참·정보분석 셀
- 공중·우주 상황을 빠르게 훑어야 하는 OSINT 분석관
- 다중 출처를 직접 비교해야 하는 작전지원 담당자
- 국방·안보 분야의 공개정보 분석팀

### 5.3 문제 정의

공중·우주 상황 인식에 필요한 정보는 항공기 항적, 위성궤도, 기상, 뉴스/OSINT, 공항·FIR 맥락 등 여러 출처에 흩어져 있다. 분석관은 각 소스를 따로 열어보고, 시간·위치·출처를 수작업으로 연결해야 한다.

이 병목은 다음 문제를 만든다.

1. 상황 파악까지 시간이 오래 걸린다.
2. 출처별 신뢰도와 최신성을 한눈에 보기 어렵다.
3. 데이터 공백을 실제 이상징후로 오해할 수 있다.
4. 여러 공개 신호의 상관관계를 놓치기 쉽다.

### 5.4 해결 방식

AirMaven Lite는 공개 항적, 위성궤도, 기상, OSINT, 공항·FIR 정보를 하나의 상황판에 통합하고, 관련 신호를 **Fusion Event**로 묶어 분석관에게 검토 큐로 제공한다.

핵심은 자동 판단이 아니라 **분석관 증강**이다.

> 더 많은 데이터를 보여주는 것이 아니라, 분석관이 먼저 봐야 할 신호를 출처와 신뢰도로 정리한다.

---

## 6. Project Maven과의 관계

AirMaven Lite는 Project Maven의 핵심 아이디어 중 일부를 공개 데이터 환경에서 축소 구현한 것이다.

| 구분 | Project Maven / Maven Smart System | AirMaven Lite |
| --- | --- | --- |
| 주체 | 미국 국방부/NGA 중심 | 해커톤 프로토타입 / 공개정보 기반 |
| 데이터 | 군 ISR, 드론 영상, 위성, 기밀 데이터 가능 | 공개 항적, 위성궤도, 기상, 뉴스/OSINT |
| 목적 | 군사 정보분석·표적화·작전지원 | 공개 신호 기반 상황 인식·분석관 검토 보조 |
| 자동화 범위 | 작전 워크플로와 깊게 연결 가능 | 표적 지정·타격 추천·자동 교전 제외 |
| 핵심 UX | 전장 데이터 통합, 표적/상황 관리 | Fusion Event, citation, confidence, analyst review queue |

발표 표현:

> Project Maven의 “다중 ISR 융합과 분석가 증강” 아이디어를 따르되, 이 프로젝트는 공개 데이터 기반이고 표적 지정·타격·자동 교전은 하지 않습니다.

---

## 7. 현재 구현 데이터 소스

| 레이어 | 1차 소스 | 역할 | 주의사항 |
| --- | --- | --- | --- |
| 항적 | OpenSky Network REST API | 공개 ADS-B 항적 상태 벡터 | 군용기·민감 항공기는 누락될 수 있음 |
| 기상 | Open-Meteo | AOI 중심 기상 맥락 | 비상업 무료, attribution 필요 |
| 뉴스/OSINT | GDELT, Google News RSS fallback | 공개 기사·활동 신호 | 기사 위치를 정확 좌표처럼 표시하면 안 됨 |
| 위성/궤도 | CelesTrak GP/TLE | 공개 위성·궤도 인식 보조 | 정밀 ISR 판정으로 과장하면 안 됨 |
| 공항 | OurAirports CSV | 공항·비행장 맥락 | 공개 참고 레이어 |
| FIR | ICAO API Data Service | AOI 중심 FIR 맥락 | API 권한·엔드포인트 상태에 따라 제한 가능 |
| AIS | AISStream | 해상 활동 보조 레이어 | 키 필요, 수신 0 상태와 실패 상태를 구분해야 함 |

주요 공개 API 참고:

- OpenSky API: <https://openskynetwork.github.io/opensky-api/>
- CelesTrak GP Data: <https://celestrak.org/NORAD/documentation/gp-data-formats.php>
- Open-Meteo: <https://open-meteo.com/>
- GDELT Data/API: <https://www.gdeltproject.org/data.html>

---

## 8. MVP 범위

### 8.1 반드시 보여줄 기능

1. **AOI 선택**
   - 수도권 상공
   - 대만해협
   - 남중국해
   - 서해/NLL 인근

2. **다중 소스 융합**
   - 공개 항적
   - 위성/궤도
   - 기상
   - 뉴스/OSINT
   - 공항/FIR/공역 맥락

3. **Fusion Event 카드**
   - 사건명
   - 관련 항적/기상/OSINT
   - confidence factor
   - citation
   - source health
   - 분석관 검토 상태

4. **자연어 질의**
   - “현재 이 지역의 공중·우주 공개 신호와 검토할 이상징후를 요약해줘.”
   - “대만해협 주변의 항적·기상·OSINT 신호를 요약해줘.”
   - “수도권 상공에서 검토가 필요한 이벤트만 보여줘.”

5. **지도 + 타임라인**
   - 지도에서 공간적 맥락 제공
   - 타임라인에서 시간 흐름 제공

6. **안전 경계**
   - 표적 지정 없음
   - 타격 추천 없음
   - 자동 교전 없음
   - 공개 데이터 기반 분석 보조만 수행

### 8.2 줄여야 할 범위

- 정밀 공중전 판정 모델
- 실제 군사 데이터
- 실제 표적 지정/타격 추천
- 위성 영상 분석
- 완전한 실시간 데이터 파이프라인
- 고정밀 궤도 관측 가능성 계산
- 새 대형 API 추가

---

## 9. 후보 전략 3개와 선택 논리

| 후보 | 설명 | 장점 | 리스크 | 판단 |
| --- | --- | --- | --- | --- |
| 후보 A: 공중·우주 지도형 상황판 | 항적·위성·날씨·뉴스를 지도와 타임라인에 표시 | 직관적이고 데모가 쉽다 | “그냥 지도 대시보드”로 보일 수 있다 | 보조 요소 |
| 후보 B: 분석관 검토 큐형 코파일럿 | 여러 출처를 Fusion Event로 묶고 신뢰도·출처·검토 상태를 제공 | Maven-style 의미가 가장 잘 드러난다 | UI 설명을 명확히 해야 한다 | **추천** |
| 후보 C: 출처·신뢰도 검증 시스템 | 공개 OSINT의 환각·오탐·좌표 오류 방지에 집중 | 안전성과 실전성이 강하다 | 시각적 임팩트가 약할 수 있다 | 차별점으로 흡수 |

### 최종 선택

**후보 B: 분석관 검토 큐형 코파일럿**

선택 이유:

- 평가 기준의 문제 적합성, 군 적용 가능성, 기술 구현, 창의성을 가장 균형 있게 만족한다.
- 단순 지도나 챗봇보다 “분석관의 시간을 줄인다”는 사용자 가치가 명확하다.
- Project Maven의 “분석가 증강” 개념을 안전하게 재해석할 수 있다.
- citation, confidence, source health로 OSINT 과제의 핵심 요구를 방어할 수 있다.

---

## 10. 3분 발표 구조

### 0:00–0:25 문제 제기

> 공중·우주 상황 인식은 항적, 위성궤도, 기상, 뉴스가 흩어져 있어 분석관이 수작업으로 교차확인해야 합니다. 문제는 데이터가 없는 것이 아니라, 흩어진 데이터를 빠르게 연결하지 못한다는 점입니다.

### 0:25–1:20 라이브 데모

1. AOI 선택: **수도권 상공** 또는 **대만해협**
2. 자연어 질의 입력:
   - “현재 이 지역의 공중·우주 공개 신호와 검토할 이상징후를 요약해줘.”
3. 지도, 타임라인, Fusion Event 표시
4. 출처·신뢰도·데이터 공백을 함께 보여줌

### 1:20–2:10 핵심 차별점

Fusion Event 하나를 클릭해서 보여준다.

- 관련 항적
- 관련 OSINT 기사
- 기상 조건
- 위성/공역 맥락
- 신뢰도
- 출처
- 데이터 공백
- 분석관 검토 상태

설명 문장:

> AirMaven은 항적 하나, 기사 하나를 따로 보여주는 것이 아니라, 시간·공간·출처 기준으로 관련 신호를 하나의 검토 이벤트로 묶습니다.

### 2:10–2:40 군 적용성

> 현재는 공개 API로 구현했지만, 구조적으로는 군 내부 레이더, EO/IR, Link-16 개념 메시지, 위성 데이터, 작전 로그를 같은 어댑터 구조로 연결할 수 있습니다.

### 2:40–3:00 마무리

> AirMaven은 판단을 자동화하지 않습니다. 분석관이 더 빨리, 더 근거 있게 판단하도록 돕습니다.

---

## 11. 발표에서 반복할 핵심 문장

1. **“더 많은 데이터를 보여주는 것이 아니라, 분석관이 먼저 봐야 할 신호를 출처와 신뢰도로 정리합니다.”**
2. **“위협 확정이 아니라 human-in-the-loop 검토 큐입니다.”**
3. **“공개 데이터 MVP지만, 군 내부 센서와 작전 데이터로 확장 가능한 구조입니다.”**
4. **“표적 지정, 타격 추천, 자동 교전 판단은 하지 않습니다.”**
5. **“데이터 공백과 레이트리밋도 숨기지 않고 source health로 표시합니다.”**

---

## 12. 데모 Golden Path

### 추천 시나리오 A: 수도권/KADIZ

장점:

- 한국 심사위원에게 맥락이 직관적이다.
- KADIZ, 수도권, 공중 상황 인식이 바로 이해된다.
- OSINT 기사와 항적·기상·공역 맥락을 연결하기 좋다.

데모 흐름:

1. AOI를 “수도권 상공”으로 선택
2. 자연어 질의 실행
3. 공개 항적과 OSINT citation 확인
4. Fusion Event 카드 표시
5. 신뢰도와 source health 설명

### 추천 시나리오 B: 대만해협

장점:

- APAC 안보 환경과 글로벌 확장성이 강하다.
- 공중·해상·우주 다영역 상황 인식 스토리에 적합하다.

데모 흐름:

1. AOI를 “대만해협”으로 선택
2. 항적·위성·기상·OSINT 레이어 확인
3. 이상징후/검토 큐 표시
4. 결선용 글로벌 확장성 메시지로 연결

---

## 13. Q&A 대비

### Q1. 이게 그냥 GPT+지도 아닌가요?

아닙니다. 일반 GPT는 소스 상태, 데이터 신선도, 지리적 맥락, 항적·기상·OSINT 상관관계를 구조화하지 못합니다. AirMaven은 모든 답변을 Fusion Event, citation, confidence factor, source health로 남깁니다.

### Q2. 공개 항적은 군용기가 빠질 수 있지 않나요?

맞습니다. 그래서 전체 공중상황이라고 주장하지 않습니다. 공개 데이터에서 관측 가능한 신호를 분석관 검토 큐로 올리고, 누락 가능성을 source caveat로 표시합니다.

### Q3. 군 적용성은 무엇인가요?

현재는 공개 데이터 어댑터지만, 같은 구조에 레이더, EO/IR, 군 내부 항적, Link-16 개념 메시지, 위성 데이터를 연결할 수 있습니다. MVP는 공개 데이터로 검증하고, 실제 운용 환경에서는 내부 센서 어댑터를 추가하는 구조입니다.

### Q4. Maven과 뭐가 다른가요?

Maven의 “다중 ISR 융합과 분석가 증강” 아이디어를 따르되, 이 프로젝트는 공개 데이터 기반이고 표적 지정·타격·자동 교전은 하지 않습니다.

### Q5. OSINT 기사 위치는 정확한 사건 위치인가요?

아닙니다. 좌표가 검증되지 않은 뉴스는 정확한 지도 이벤트로 찍지 않습니다. AirMaven은 이를 데이터 품질 정책으로 명시하고, 좌표 없는 신호는 검토 카드와 citation 중심으로 처리합니다.

### Q6. 실시간 시스템인가요?

해커톤 데모에서는 API 스냅샷과 캐시 기반으로 안정성을 확보했습니다. 일부 소스는 live, cached, rate-limited, unavailable 상태가 구분되며, 이 상태를 UI에 표시합니다.

---

## 14. 남은 시간 작업 우선순위

### P0 — 제출 전 반드시 확인

- [ ] Golden Path AOI 하나 고정
- [ ] 데모용 public/data/live-scenarios.json 상태 확인
- [ ] `npm test -- --run` 통과 확인
- [ ] `npm run build` 통과 확인
- [ ] 발표 첫 30초 문제 설명 암기
- [ ] 안전 경계 문구 슬라이드/README에 명시
- [ ] source health와 citation이 화면에서 보이는지 확인

### P1 — 가능하면 보강

- [ ] Fusion Event 카드의 “왜 검토해야 하는가” 문구 개선
- [ ] confidence factor 설명을 짧게 정리
- [ ] 데이터 공백/레이트리밋 상태를 약점이 아니라 신뢰성 기능으로 설명
- [ ] 수도권/KADIZ 또는 대만해협용 스크린샷 준비

### P2 — 하지 말 것

- [ ] 새 대형 API 추가 금지
- [ ] 실제 표적화처럼 보이는 UI 추가 금지
- [ ] 근거 없는 위협도 산정 금지
- [ ] 좌표 없는 뉴스 이벤트를 정확한 위치처럼 표시 금지
- [ ] Palantir/Maven과 동일하다고 주장 금지

---

## 15. 제출/발표 제목 후보

### 추천 제목

**AirMaven Lite: 출처와 신뢰도를 갖춘 공중·우주 ISR 검토 큐**

### 영문 부제

**Public air tracks, orbital data, weather, and OSINT fused into human-reviewed intelligence events.**

### 대안 제목

1. **AirMaven Lite: Human-in-the-loop Air ISR Fusion Copilot**
2. **AirMaven: Citation-first Public ISR Fusion for Air & Space Awareness**
3. **AirMaven Lite: 공개 공중·우주 신호를 분석관 검토 이벤트로 바꾸는 코파일럿**

---

## 16. 제출용 짧은 소개문

AirMaven Lite는 공개 항적, 위성궤도, 기상, 뉴스/OSINT, 공항·FIR 맥락을 융합해 특정 AOI의 공중·우주 상황을 요약하고 분석관이 검토해야 할 이상징후를 제시하는 ISR Fusion Copilot입니다. 단순 지도나 챗봇이 아니라, 각 이벤트에 citation, confidence factor, source health, analyst review state를 함께 제공하여 공개 데이터의 한계와 근거를 명확히 남깁니다. 표적 지정, 타격 추천, 자동 교전 판단은 제외하며, human-in-the-loop 분석 보조에 집중합니다.

---

## 17. 검증 상태

로컬 기준 검증 결과:

```text
npm test -- --run
→ 8개 테스트 파일 통과 / 19개 테스트 통과

npm run build
→ TypeScript build 및 Vite production build 성공
```

주의:

- Vite 번들 크기 경고는 존재하나, 해커톤 제출용 기능 동작에는 직접적인 실패 요인이 아니다.
- 실시간 공개 API는 rate limit, 수신 0, 인증 상태에 따라 변동될 수 있으므로 데모는 캐시 기반 Golden Path를 준비한다.

---

## 18. 최종 전략 요약

AirMaven Lite의 승부처는 “Maven처럼 보이는 거대한 군사 AI”가 아니다.

진짜 승부처는 다음이다.

1. **공개 데이터만으로도 공중·우주 ISR 융합 문제를 작동하는 형태로 보여준다.**
2. **출처, 신뢰도, 데이터 공백을 숨기지 않는다.**
3. **AI가 판단을 대체하지 않고 분석관의 검토 우선순위를 정리한다.**
4. **현재 MVP는 공개 API지만, 군 내부 센서·작전 데이터로 확장 가능한 구조를 갖는다.**
5. **3분 안에 문제 → 데모 → 차별점 → 군 적용성을 설명할 수 있다.**

최종 메시지:

> AirMaven Lite는 공개 공중·우주 신호를 “검토 가능한 정보 이벤트”로 바꾸는 Maven-style ISR Fusion Copilot입니다.
