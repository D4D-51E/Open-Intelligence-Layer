# AirMaven 피벗: 실시간 항적 · 다중소스 융합

> 2026-07-04 · D4D 해커톤 · 상태: 승인됨 → 구현(ralph)

## 0. 요약

기존 **주장 검증 코파일럿**(claim → evidence → verdict)을 걷어내고,
이미 구현되어 있으나 잠자던 **실시간 항적 노출 + 항적·궤도·기상·OSINT 다중소스 융합** 레이어를 제품 전면으로 승격한다.

- hero = **실시간 항적** (테이블/상세), 융합은 보조.
- 융합 보조 = **둘 다**: AOI 지역 융합 요약(상시) + 선택 항적별 융합 컨텍스트(선택 시).
- **군용기 강조 표시** 적용(메트릭 + 테이블).
- 안전 경계 유지: 공개/캐시 데이터만, 합성 이벤트 없음, 표적화·타격권고·자동교전 없음.

## 1. 삭제 범위 (완전 삭제)

- `src/lib/claims.ts`
- `src/lib/verify.ts`, `src/lib/verify.test.ts`
- `src/components/ClaimQueuePanel.tsx`, `src/components/VerificationPanel.tsx`
- `src/lib/types.ts`의 claim/verification 타입 블록: `ClaimType`, `VerificationVerdictLabel`,
  `EvidenceCategory`, `EvidenceStance`, `VerificationClaim`, `EvidenceItem`,
  `VerificationVerdict`, `VerificationCase`, 그리고 사문 리터럴
  (`TimelineEvent.type`의 `'claim' | 'evidence'`, `OsintMapEvent.source`의 `'claim-review-cache' | 'osint-cluster-review'`).
- `src/App.tsx`의 claim 상태/메트릭/탭/내러티브 배선 전부
  (`activeClaimId`, `verificationCases`, `buildVerificationCases/buildClaimMapEvents/buildVerificationTimeline`,
  `verdict*` 헬퍼, `evidenceCountsFor`, `verificationBriefingLists`).

**유지**: `fusion.ts`, `airplanesLiveApi.ts`, `liveTrackHistory.ts`, `anomaly.ts`,
`osintSources.ts`(소스 매트릭스), `liveData.ts`, `baselineData.ts`,
`SituationMap`, `Timeline`, `IngestLogPanel`, `MetricCard`.

## 2. 신규 로직 — `src/lib/trackFusion.ts` (항적별 융합)

순수 함수. 선택 항적의 최신점(`points.at(-1)`)을 기준으로 **실데이터만** 결합.
데이터 없으면 합성하지 않고 gap으로 표기. 각 축은 `Citation`(출처·최신성·신뢰도) 동반.

```ts
export type TrackFusionAxis =
  | { kind: 'weather'; present: boolean; label: string; detail: string; citation?: Citation }
  | { kind: 'satellite'; ... }
  | { kind: 'airspace'; ... }
  | { kind: 'osint'; ... }
  | { kind: 'anomaly'; ... };

export type TrackFusionContext = {
  trackId: string;
  axes: TrackFusionAxis[];
  citations: Citation[];
  gaps: string[];       // 결합할 실데이터가 없는 축 사유
};

export function buildTrackFusionContext(track: Track, scenario: Scenario, anomalies: Anomaly[]): TrackFusionContext;
```

| 축 | 소스 | 결합 방식 |
|---|---|---|
| 기상 | `scenario.weather`(지역) | 운량·돌풍·가시거리 + 관측성(`isClearWindow`류) 판정 |
| 위성 | `scenario.satellites`, `satelliteScenes` | 항적 좌표 최근접 pass(haversine) + 시간창, scene bbox 포함 여부 |
| 공역 | `scenario.airspaceContexts`(FIR) + `notices`(NOTAM) | 포함/최근접 FIR + 반경 내 공지 |
| OSINT | `scenario.osintEvents` + `osint` | 항적 반경 내 map event + 시간창 내 항목 |
| 이상 | `anomaly.ts` 결과 | `relatedTrackIds`에 항적 포함된 anomaly |

거리/시간 임계값은 상수로. haversine은 `airplanesLiveApi.ts` 패턴 재사용(공용 유틸로 추출 가능).

## 3. UI — Ops 상황판 (hero = 실시간 항적)

### 3.1 메트릭 4장 (교체)
1. **실시간 항적** — count + OpenSky/Airplanes live 상태. 서브: `군용 N기` 강조 배지(있으면 watch 톤).
2. **융합 신뢰도** — AOI `buildFusionEvents` overview confidence + 팩터 요약.
3. **관측 레이어** — 항적/위성/기상 커버리지.
4. **소스 커버리지** — OSINT/공역/선박 소스 수 + 공백 수.

### 3.2 우측 hero 패널 `LiveTrackPanel` (탭 3)
- **항적**: 실시간 항적 테이블 — 호출부호 · 유형 · **군용여부(강조)** · 고도 · 속도 · 최신성.
  기존 필터(유형/고도/속도) 유지, 정렬 지원. 행 선택 → 상세 + **항적별 융합 컨텍스트 카드**(§2).
  군용기 행은 시각적 강조(경고 톤 라벨/아이콘).
- **융합**: **AOI 지역 융합 요약** — `buildFusionEvents` 재활성(overview/이상/데이터공백),
  **읽기전용**(review 트리아지 버튼 제거).
- **이력**: `buildTimelineFromScenario` 기반 시나리오 타임라인.

### 3.3 지도
그대로. `osintEvents = scenario.osintEvents`만(claimMapEvents 제거). 선택 항적 하이라이트 연동(가능 범위).

### 3.4 하단
`IngestLogPanel` 유지.

## 4. 군용기 강조 (교차 절단 요구)

- `airplanesLiveApi.ts`는 이미 `dbFlags & 1`로 군용 플래그를 감지하나 현재 `platformType`을 `'unknown'`으로 뭉갠다.
  → `Track`에 `isMilitary?: boolean`(또는 `platformType: 'military'`) 필드를 추가해 신호 보존.
  (타입 확장 최소화를 위해 `Track.isMilitary?: boolean` 권장.)
- 메트릭 1(실시간 항적)에 `군용 N기` 강조.
- 테이블에서 군용 행 시각 강조 + 유형 필터에 `군용` 옵션 추가.
- 융합/이상 신호에서 군용기 관련이면 우선 정렬(있으면).
- 안전 경계: 군용 표시는 **공개 ADS-B dbFlags 노출**일 뿐, 식별·표적화 아님(문구 명시).

## 5. 내러티브 리포트 & 정리

- 내러티브 뷰: ClaimQueue/Verification → **항적 테이블 + AOI 융합 요약 + 소스 매트릭스(유지)**.
  footer 안전문구를 "표적화 없음 · 공개데이터 노출/융합 보조" 톤으로 갱신.
- **제외(YAGNI)**: 자연어 질의 코파일럿 바 + review 트리아지(queued/needs_review/…) 되살리지 않음.
- **테스트**: `App.test.tsx` 재작성(항적 렌더/선택→융합 컨텍스트/군용 강조),
  `trackFusion.test.ts` 신규, 기존 `fusion.test.ts` 유지.
- **README**: Features/워크플로를 항적·융합 중심으로 재작성, claim 관련 문단 삭제.

## 6. 완료 기준 (ralph verify gate)

- `npm run typecheck` 통과 (claim 타입 잔재 0, 죽은 import 0).
- `npm run lint` 통과(`--max-warnings 0`).
- `npm test` 통과(신규/재작성 테스트 포함).
- `npm run build` 성공.
- 앱 구동 시: 실시간 항적 테이블 표시 → 행 선택 시 항적별 융합 컨텍스트 표시 →
  AOI 융합 요약 카드 표시 → 군용기 강조 노출. claim/verdict UI 흔적 0.
- 합성 데이터 없음, 안전 경계 문구 유지.

## 7. 불변식 / 스타일

- 불변 패턴(새 객체 생성), 파일 200–400줄, 함수 <50줄.
- 합성 인텔리전스 금지 — 없으면 gap.
- console.log 금지, 하드코딩 지양(임계값은 상수).
