# AirMaven Lite

D4D T2 **Maven-style Air ISR Fusion Copilot** hackathon prototype.

AirMaven Lite fuses public API aircraft tracks, weather context, OSINT/news source cards, public orbital-awareness layers, and public airport context into a map/timeline/briefing interface for analyst triage.

> Safety boundary: this is **analyst decision-support only**. It does not perform target designation, strike recommendation, or automated engagement logic.

## Features

- Default **Ops 4-up · team mode** dashboard:
  - fused situation map
  - metrics + analyst-review cues
  - citation briefing
  - timeline + terminal-style ingest log
- Optional **Narrative · scroll report** mode for source matrix / report-style walkthrough
- AOI preset selector: 대만해협, 수도권 상공, 남중국해, 서해/NLL 인근
- Data mode is fixed to `API 스냅샷`: `public/data/live-scenarios.json`
- Leaflet common operating picture map
  - 기본값: OSM tile basemap for visual background only
  - 예비 옵션: `오프라인` basemap selector 또는 `?basemap=offline`
- Aircraft tracks from OpenSky live/cache state vectors
- Aircraft display filters: platform class, minimum altitude, minimum speed
- Open-Meteo live weather snapshot
- GDELT or Google News RSS live OSINT citation cards
- CelesTrak satellite/orbital layer with computed ground-track projection when CelesTrak is reachable
- OurAirports public airport markers and airport-axis reference routes
- ICAO `fir-by-location` context for the selected AOI center, TTL-cached to avoid burning calls
- AISStream layer uses a server-side WebSocket when `AISSTREAM_API_KEY` is configured
- ICAO NOTAM layer calls a configured ICAO API Data Service endpoint when `ICAO_API_KEY` and `ICAO_NOTAM_ENDPOINT` are configured
- Missing or failed sources are shown as `사용 불가` and produce empty layers; the app does not generate placeholder data to fill gaps
- Rule-based anomaly engine:
  - route deviation / abrupt heading change
  - weather-risk cue
  - OSINT/activity correlation
- Deterministic briefing with citations and caveats

- Fusion Copilot panel:
  - Korean natural-language demo presets select AOI/module intent deterministically in the browser
  - Fusion Event cards combine aircraft, AIS, FIR, weather, satellite, and OSINT signals only when public/cache evidence exists
  - each event shows confidence factors, citations, safety notes, and local analyst review states (`대기`, `검토 필요`, `확인됨`, `보류/무시`)
- Optional server-side OpenAI briefing precompute script that never exposes the key to the browser

## Setup

```bash
npm install
npm run dev
```

`npm run dev` starts both the Vite app and the background public-data refresh loop by default. Open the local Vite URL, usually <http://localhost:5173>.

If you intentionally want the browser app only, without automatic public API refresh, run:

```bash
npm run dev:vite
```

The default map is OSM tile mode. OSM requests are only for visual map tiles; all situation data is loaded from the local `API 스냅샷` cache. If network access is unavailable for map tiles, switch **지도 → 오프라인** or open:

```text
http://localhost:5173/?basemap=offline
```

## Public live data cache

Fetch current public API snapshots:

```bash
npm run fetch:live
```

This writes:

```text
public/data/live-scenarios.json
```

The browser app loads this file by default. If a source fails or returns no usable records, that layer stays empty and its source status becomes `사용 불가`.

Useful URL:

```text
http://localhost:5173/?view=ops
```

`view=ops` is the default and shows the terminal Team-mode style 4-panel screen. Use `view=narrative` when you want the longer source-matrix report view.

Current live-cache sources:

| Layer | API | Runtime behavior |
|---|---|---|
| Aircraft tracks | OpenSky `/states/all` bbox query | Live/cache public ADS-B state vectors, capped per AOI |
| Weather | Open-Meteo forecast/current API | Live temperature, wind, gust, cloud, precipitation, visibility |
| News/OSINT | GDELT DOC 2.0 ArtList JSON + Google News RSS | GDELT 우선, 429 시 backoff 후 Google News RSS 대체 |
| Satellite/orbital | CelesTrak GP JSON `GROUP=stations` | Public GP metadata and computed ground track when reachable |
| Airport context | OurAirports CSV | Public airport markers and derived airport-axis route context |
| FIR context | ICAO API Data Service `fir-by-location` | AOI center FIR lookup, 24h TTL cache by default |
| AIS maritime | AISStream WebSocket `wss://stream.aisstream.io/v0/stream` | Server-side live collection; 수신 0건이면 상태 사유 표시, 직전 캐시가 신선하면 유지 |
| NOTAM notices | ICAO API Data Service endpoint from account portal | Calls `ICAO_NOTAM_ENDPOINT` when configured; empty if endpoint is missing or response has no geocoded NOTAM records |

Optional OpenSky OAuth2 credentials can be added to `.env` for better rate limits:

```bash
OPENSKY_CLIENT_ID=
OPENSKY_CLIENT_SECRET=
```

OpenSky is rate-limit aware. The fetcher reuses the previous aircraft cache and backs off when OpenSky returns HTTP 429. Anonymous mode uses a safer default OpenSky TTL instead of calling every 5 minutes:

```bash
OPENSKY_FETCH_ENABLED=true
OPENSKY_MIN_FETCH_INTERVAL_MS=1800000
OPENSKY_MAX_TRACKS_PER_REGION=50
GDELT_BACKOFF_MS=1800000
```

Optional AISStream credentials:

```bash
AISSTREAM_API_KEY=
AISSTREAM_FETCH_ENABLED=true
AISSTREAM_FETCH_MS=20000
AISSTREAM_MAX_SHIPS_PER_REGION=30
AISSTREAM_CACHE_TTL_MS=1800000
```

AISStream is consumed only by the Node fetch loop. The browser never connects directly to AISStream because the provider documents that browser/CORS use is unsupported and would expose the API key. If a WebSocket connection succeeds but no vessel message arrives during `AISSTREAM_FETCH_MS`, the UI shows `연결됨 · 수신 0`; if a recent ship cache exists, it shows `캐시 정상` and keeps the last known public AIS positions.

Optional ICAO NOTAM credentials:

```bash
ICAO_API_KEY=
ICAO_API_BASE_URL=https://dataservices.icao.int/api
ICAO_FIR_FETCH_ENABLED=true
ICAO_FIR_MIN_FETCH_INTERVAL_MS=86400000
ICAO_NOTAM_ENDPOINT=
ICAO_API_KEY_AUTH=query       # query | header | bearer
ICAO_API_KEY_PARAM=api_key
ICAO_API_KEY_HEADER=x-api-key
ICAO_NOTAM_MAX_LOCATIONS_PER_REGION=2
ICAO_NOTAM_MAX_PER_REGION=8
```

`ICAO_API_KEY` is enough for `fir-by-location` because the endpoint is visible in the account table. It is not enough for NOTAM in the current account table: the listed services do not include Realtime/Stored NOTAMS. If your ICAO portal later exposes a NOTAM endpoint, set `ICAO_NOTAM_ENDPOINT` from the portal. Endpoint templates may include `{location}`, `{icao}`, `{regionId}`, `{minLat}`, `{minLon}`, `{maxLat}`, `{maxLon}`, and `{apiKey}`.

Do not treat the live cache as authoritative intelligence. It is public, incomplete, rate-limited, and intended for analyst-support review only.

## Vercel deployment

This project can be shared as a Vercel-hosted static dashboard. Vercel runs `npm run build` and serves the generated `dist/` directory; this is pinned in [`vercel.json`](./vercel.json).

```bash
# Optional: refresh the public API snapshot before deploying.
npm run fetch:live

npm run build
npx vercel --prod
```

The deployed dashboard reads `public/data/live-scenarios.json` as a snapshot. Vercel will not keep `npm run dev`, `npm run dev:live`, or `scripts/live-data-loop.mjs` running as a background process after deployment. If you need continuously refreshed shared data, add a separate scheduled backend/storage path instead of relying on the Vite static app alone.

## Cloudflare deployment

Cloudflare is configured as a single Worker with static assets, API routes, a Cron Trigger, and Workers KV. The Worker serves `dist/`, exposes `/api/live-scenarios`, and refreshes one AOI per cron run into the `LIVE_SCENARIOS` KV namespace.

```bash
npm run build
npx wrangler kv key put airmaven:live-scenarios --path public/data/live-scenarios.json --binding LIVE_SCENARIOS --remote
npm run deploy:cloudflare
```

The default cron is every 15 minutes. Because the current target is Cloudflare Workers Free, the Worker uses a lightweight rotating-AOI refresh: each scheduled run updates one region's OpenSky, Open-Meteo, and OSINT fields while preserving cached static layers and the other regions. The browser still polls `/api/live-scenarios` every 30 seconds and falls back to `/data/live-scenarios.json` when the API is unavailable.

## Near-real-time refresh mode

Near-real-time refresh is the default development mode:

```bash
npm run dev
```

`npm run dev:live` remains available as an explicit alias for the same combined mode.

This starts:

- Vite dev server
- `scripts/live-data-loop.mjs`, which periodically runs `scripts/fetch-live-data.mjs`
- automatic writes to `public/data/live-scenarios.json`
- frontend polling of `/data/live-scenarios.json` every 30 seconds

Default backend fetch cadence:

```text
LIVE_FETCH_INTERVAL_MS=300000       # 5 minutes
LIVE_FETCH_RETRY_INTERVAL_MS=60000  # 1 minute after failed cycle
```

Override only when you understand public API rate limits:

```bash
LIVE_FETCH_INTERVAL_MS=120000 npm run dev
```

The UI shows:

- cache generated time
- cache age
- last browser check age
- frontend poll cadence
- source-level live/cache/unavailable status
- source-level freshness age when that source was pulled successfully
- terminal-style **Ingest log** panel containing each browser cache-poll result for the selected AOI

The small in-app log is a frontend ingest/poll log, not raw Node stdout. Raw background collection logs still print in the terminal under:

```text
[dev-live]
[live-loop]
```

This is **near-real-time public data refresh**, not true streaming intelligence. The browser polls every 30 seconds, while backend source refresh is intentionally slower to avoid rate-limit pressure.

## Coordinate accuracy policy

The blue AOI rectangle is source-backed rather than hand-drawn.

| AOI | Bbox format `[minLon, minLat, maxLon, maxLat]` | Source |
|---|---:|---|
| 대만해협 | `[118.4271213, 23.4204107, 120.7974216, 25.5523561]` | OpenStreetMap Nominatim result for `Taiwan Strait`, OSM way `1087698081` |
| 수도권 상공 | `[124.3727348, 36.8544193, 127.8481129, 38.2811104]` | Union of OSM/Nominatim admin bboxes for Seoul, Incheon, and Gyeonggi-do |
| 남중국해 | `[102.2384722, -3.2287222, 122.1513056, 25.5672778]` | Marine Regions Gazetteer / IHO sea-area bbox converted from DMS |
| 서해/NLL 인근 | `[123.547708291629, 37.626084840136, 126.688972200141, 38.2047340114075]` | ArcGIS Online public `Korea Northern Limit Line` Feature Service extent |

The purple dashed NLL overlay is rendered from the public ArcGIS LineString coordinates. There are no generated watch cells in the current real-data-only mode.

Detailed source notes and coordinate QA criteria are documented in [`AirMaven_좌표정확도_QA_및_출처.md`](./AirMaven_%EC%A2%8C%ED%91%9C%EC%A0%95%ED%99%95%EB%8F%84_QA_%EB%B0%8F_%EC%B6%9C%EC%B2%98.md).


## Fusion Copilot workflow

The Ops board includes a deterministic Fusion Copilot workflow for hackathon review:

1. Select a Korean natural-language preset or type a query. The browser parser only maps the query to AOI/module/focus intent; it does not call external LLM APIs or expose keys.
2. `buildFusionEvents` creates source-backed Fusion Event objects from the current scenario. It does not emit an overview card unless at least one real source citation exists.
3. Every card carries citations, confidence factors, freshness, and a safety note. Empty, disabled, unsupported, or rate-limited layers remain visible as source-status-cited data-quality gaps instead of synthetic map events.
4. Analyst review state is local UI state for demo triage only: queued, needs review, confirmed, or dismissed. It is not an automated operational decision.

Safety boundary remains unchanged: public/cache data only, no synthetic geographic events, no target designation, no strike recommendation, and no automated engagement.

## Build verification

```bash
npm run build
npm run lint
npm test
npm run typecheck
npm audit --audit-level=high
```

## Optional environment

Create `.env` from `.env.example` if you want to precompute a server-side briefing status file:

```bash
cp .env.example .env
# edit OPENAI_API_KEY=...
npm run generate:briefing
```

The browser app does **not** read `OPENAI_API_KEY`; `.env` is gitignored. The generated public status file is sanitized: it does not publish key presence, model name, HTTP status, or raw provider errors. If no key is present, the app still works with deterministic public-data-only briefing text.

## Data/API plan

| Layer | Primary source | Current behavior |
|---|---|---|
| Aircraft tracks | OpenSky Network REST API | Live/cache state vectors |
| Weather | Open-Meteo | Visibility, cloud cover, precipitation, wind gust risk |
| News/OSINT | GDELT DOC 2.0 + Google News RSS | Live citation cards and event-volume cues |
| Satellite/orbital | CelesTrak GP/TLE | Public orbital awareness layer + ground-track projection when reachable |
| Airport context | OurAirports | Cached CSV airport markers and route-axis context |
| FIR context | ICAO `fir-by-location` | Official FIR lookup for AOI center |
| AIS maritime | AISStream WebSocket | Server-side live AIS positions when key is configured |
| NOTAM context | ICAO API Data Service | Official NOTAM notices when key + endpoint are configured |

Reference docs are collected in [`Maven_Air_ISR_데이터_API_구현전략.md`](./Maven_Air_ISR_데이터_API_구현전략.md).

## 3-minute walkthrough

1. Run `npm run dev` with network access.
2. Open the Vite URL with `?view=ops`, for example `http://localhost:5173/?view=ops`.
3. Keep **데이터 → API 스냅샷** selected.
4. Select an AOI.
5. Show the 4-up Ops view: map, anomaly cues, briefing, and timeline/ingest log visible in one screen.
6. Point out the terminal-style ingest log as proof that the browser is polling the public live cache.
7. Switch to **Narrative · scroll report** only if you need to show the full source matrix.
8. Close with the caveat: public/live/cached data only; analyst review required; no targeting automation.

## Architecture

```text
public API fetch + public cache
        ↓
scripts/fetch-live-data.mjs writes public/data/live-scenarios.json
        ↓
src/lib/liveData.ts merges API layers without generated placeholders
        ↓
src/lib/anomaly.ts creates review cues
        ↓
src/lib/briefing.ts generates citation briefing
        ↓
React UI: Ops 4-up dashboard or narrative report view
```

## Limitations

- Public ADS-B data is incomplete and may omit sensitive aircraft.
- OpenSky anonymous access is rate-limited and may return sparse regional data.
- GDELT may rate-limit. In that case the UI shows `레이트리밋` and uses Google News RSS as fallback.
- CelesTrak may block or rate-limit repeated downloads; when that happens, the satellite layer is empty.
- AISStream coverage depends on public AIS receivers and the short fetch window; sparse maritime AOIs may legitimately show zero ships.
- ICAO FIR lookup uses a 24h TTL by default because trial keys have limited calls.
- ICAO NOTAM requires the account-specific endpoint configuration; the current endpoint list supplied for this key does not include NOTAM.
- OSINT/news correlation is not confirmation.
- The satellite layer is public orbital awareness, not a claim of ISR collection capability.
