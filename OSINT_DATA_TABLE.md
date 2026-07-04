# OSINT Data Table

_Last updated: 2026-07-04 KST_

This document summarizes the public OSINT stack used by **AirMaven Verify** after the current pivot. It is based on the live schema in `src/lib/types.ts`, fetch pipeline in `scripts/fetch-live-data.mjs`, and the snapshot at `public/data/live-scenarios.json`.

## 1. Current OSINT Layers

| Layer | Dataset key | Source | Purpose | Map behavior | Caveat |
|---|---|---|---|---|---|
| OSINT article signal | `osint` | `google-news-rss-cache` (fallback `gdelt-cache`) | Defense-related press claims, social reposts, and open-source report signals per AOI | Not directly drawn until converted to `osintEvents`/claim clusters | Query-based retrieval, not guaranteed claim-ground truth |
| Claim-cluster evidence | `derived map events` | In-app `buildOsintClusters` | Groups same-topic claims by 시간대/키워드 to separate **중복 확산** vs 분산 독립 보도 | Rendered as blue/orange review markers labeled `OSINT 클러스터` | No semantic geocoding yet; uses AOI review points |
| NASA FIRMS thermal anomalies | `thermalAnomalies` (`nasa-firms-cache`) | NASA FIRMS area CSV (MAP_KEY) | 대형 열/연소 반응 후보 for military strike / missile claim verification | Added as orange thermal markers + evidence rows (`nasa-firms-match`) | Thermal hotspots are auxiliary context only; 오탐/누락 가능 |
| Copernicus scenes | `satelliteScenes` | Copernicus Data Space STAC | AOI/time-window 공개 위성 장면 존재·운량·플랫폼 조회 | Scene meta card shown in evidence list and scenario timeline | Public scenes are metadata only; not 자동 판독 |
| Public tracks | `tracks` | OpenSky | 항적 존재/활동량으로 주장 시공간 정합성 확인 | Flight polylines and latest-track markers | 스텔스기·군용기 미공개 항적은 누락될 수 있음 |
| Airspace context | `airspaceContexts`, `notices` | ICAO FIR/NOTAM | 공역 폐쇄/제한 공지의 주장 검증 보조 | FIR/공지 폴리곤·반경 반영 | API 공개 범위와 포맷에 따라 빈도/품질 편차 |
| Maritime context | `ships` | AISStream | 항모·항공모함 주변 해양 활동 보조 맥락 | AIS 라인+마커 | 군·작전 함정의 AIS 비전송 시 누락 |
| Weather context | `weather` | Open-Meteo | 기상/구름/시정 기반 관측성 보조 | timeline + dashboard text | 현장 기상과 모델 차이 가능 |

## 2. Verification Pipeline: “언론 보도 vs 실제 데이터” 매핑 방식

### 우선순위 규칙

MVP 정합성 비교 및 표시 우선순위:

1. **판정 위험도**: 라벨 `false > likely_false` 항목을 최우선 표시
2. **반박-지지 비율**: `contradicts` 누적 대비 `supports` 누적이 클수록 위로 정렬
3. **AOI Claim priority**: `warning > watch > info`
4. **증거 공백/결측**: 동일한 경우 공백이 큰 경우 하향

1. **보도 수집 (claim-oriented filtering)**
   - Region별 쿼리에 공중군사 키워드(aircraft, KADIZ, base strike 등) 포함.
   - `GDELT`가 정상 동작할 때는 `google-news-rss-cache`를 보완, 실패 시 RSS 결과로 대체.
   - 각 항목은 `publishedAt`, `domain`, `title`, `summary`, `tags`, `confidence` 형태로 저장.

2. **주장 단위 클러스터링**
   - 각 Claim는 `keywords`, `time window`, AOI 중심 좌표를 보유.
   - `claimRelevantOsint = osint[ timeWindow ] + keyword overlap` 로 증거 후보 축소.
   - `buildOsintClusters()`:
     - 제목/요약 문자열 토큰화 후 시간 간격(90분) + 코사인 유사도로 클러스터 생성
     - 클러스터당 `stance`(supports / contradicts / context) 추정 및 가중 점수 산정
     - `publisher diversity`, `recency`, `source reliability` 반영.
   - 결과는 map marker(`osint-cluster-review`)와 evidence cluster 카드로 출력.

3. **실제 데이터 정합성 비교**
   - **항적 비교(trackEvidence):** 마지막 항적 지점의 주장 중심 거리 + 창 내 시점 비교 -> 지지/맥락 점수.
   - **열 이상 비교(thermalEvidence):** NASA FIRMS 히트 점유 FRP와 거리로 `supports` 또는 `gap` 반응 생성.
   - **위성 장면 비교(satelliteEvidence):** Copernicus scene 존재/운량으로 가능성 보완.
   - **공역/NOTAM 비교:** 공역 상태와 폐쇄/경보 공지 존재 시 주장 교차 확인.
   - 모든 결과는 `supports / contradicts / context / gap`로 분류되어 최종 `verdict`의 support/contradict scores에 반영.

4. **결론 로직**
   - 공백(`gap`)은 반대 증거가 아니며, “판단 보류” 또는 “추가 확인 필요”로 반영.
   - `공개 ADS-B 부재`는 사실 부정 증거가 아님(기재되어도 공백·한계로 처리).

## 3. Data Source Status in Current Snapshot

| Source | Status (typical) | Note |
|---|---|---|
| GDELT | `rate-limited` on some windows | 429 backoff 시 RSS 대체 동작 |
| Google News RSS | `live` | Defense press/activity fallback 우선 |
| NASA FIRMS | `live` / `empty` / `disabled` | MAP_KEY 없으면 disabled, key 존재 시 AOI 시간대 열 이상 수집 |
| OpenSky | `live`/`cached`/`standby` | Global AOI는 상세수집 제한(standby) 설계 |
| Copernicus STAC | `live`/`empty`/`standby` | AOI/구간 존재성 확인용 |
| ICAO FIR/NOTAM | `live`/`empty`/`disabled` | ICAO NOTAM endpoint 환경 설정 의존 |

## 4. `osint` Article Schema

| Field | Type | Required | Description | Example |
|---|---|---:|---|---|
| `id` | `string` | Yes | Stable item ID in cache | `live-osint-google-seoul-airspace-1` |
| `source` | `'gdelt-cache' \| 'google-news-rss-cache'` | Yes | Fetch source identifier | `google-news-rss-cache` |
| `regionId` | `RegionId` | Yes | AOI region | `seoul-airspace` |
| `title` | `string` | Yes | News headline / claim headline | `IRGC claimed ...` |
| `url` | `string` | No | Original source link | `https://news.google.com/rss/articles/...` |
| `domain` | `string` | No | Publisher/source label | `The Korea Herald` |
| `publishedAt` | ISO datetime | Yes | Publication/observed time | `2026-07-04T01:10:00.000Z` |
| `summary` | `string` | Yes | Normalized query context | `Live search signal for ...` |
| `tags` | `string[]` | Yes | Topic/source tags | `['news','osint','seoul-airspace']` |
| `confidence` | `number` | Yes | Lightweight quality score | `0.64` |

## 5. `osintEvents` Map Point Schema

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | `string` | Yes | Derived event id | `osint-review-live-osint-google-seoul-airspace-1` |
| `regionId` | `RegionId` | Yes | AOI assignment |
| `source` | `OsintItem['source']` | Yes | Source inherited |
| `title` | `string` | Yes | Usually article title |
| `lat` / `lon` | `number` | Yes | AOI-derived review point (not geocoded claim location) |
| `observedAt` | ISO datetime | Yes | From article publish time |
| `tags` | `string[]` | Yes | Includes `osint-cluster`, `not-geocoded` when aggregated |
| `relatedOsintId` | `string` | Yes | Link to source item |
| `domain`, `url` | `string` | No | Optional provenance fields |

## 6. Important Coordinate Policy

| Policy item | Current rule |
|---|---|
| Article geocoding | Not performed |
| Map marker meaning | AOI review point for analyst judgment |
| Accuracy claim | Never claim exact claim coordinates without explicit geocoding |
| Required marker tag | `not-geocoded` |
| Internal wording | `검토 포인트`, `보도군집`, `열 이상 후보` |

## 7. Source Files

| File | Role |
|---|---|
| `src/lib/verify.ts` | OSINT claim filtering, clustering (`buildOsintClusters`), and verdict synthesis |
| `src/lib/types.ts` | OSINT, track, thermal, satellite data schemas |
| `src/lib/liveData.ts` | Merge cache + build scenario timeline |
| `scripts/fetch-live-data.mjs` | Public source fetch + caching (GDELT, Google News, OpenSky, Copernicus, NASA FIRMS, ICAO, AIS) |
| `worker/index.js` | API worker + cron-based cache refresh |
| `src/App.tsx` | Claim queue/claim-centric evidence rendering, map overlays |
| `src/components/SituationMap.tsx` | `osintEventVisual` and claim/thermal marker render policy |
| `public/data/live-scenarios.json` | Snapshot cache consumed by browser |

## 8. Maintenance Checklist

- [x] Keep `not-geocoded` on derived article/cluster markers unless real geocoding is added and validated.
- [x] Do not expose API keys/JWTs in UI logs, cache, or commits.
- [x] Keep `gap` as “evidence gap” and avoid converting directly to false.
- [x] Re-run `npm run fetch:live` or Worker refresh before demos requiring fresh defense claim OSINT.
- [x] Confirm `sourceStatus`/`sourceReasons` before claiming any source is fully live.
