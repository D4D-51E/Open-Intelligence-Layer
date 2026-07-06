# Open Intelligence Layer

**A real-time OSINT fusion engine that _adjudicates_ claims instead of just collecting them — public aircraft, ships, satellites, and Telegram reports on one live 3D globe, each strike claim scored with a verdict, a confidence number, and an evidence ledger.**

> **Project Maven** finds targets from classified sensor video.
> **Open Intelligence Layer does the inverse:** it fuses **19 public data sources** and adjudicates *whether a claim is actually true* — cross-checking every Telegram "we hit X" against independent signals (NASA thermal anomalies, other channels, seismic, air-raid sirens) before it ever reaches an analyst.
>
> *Open · Verifiable · Non-targeting · a situation room in your pocket.*

<p>
<img alt="Status" src="https://img.shields.io/badge/status-open--source-2c974b">
<img alt="Sources" src="https://img.shields.io/badge/data%20sources-19%20public-1f6feb">
<img alt="Adjudication" src="https://img.shields.io/badge/aggregation-%E2%86%92%20adjudication-8957e5">
<img alt="Tests" src="https://img.shields.io/badge/tests-61%20passing-2c974b">
<img alt="Non-targeting" src="https://img.shields.io/badge/design-non--targeting-d29922">
</p>

🌐 **Live demo:** https://d4d.n2f.site · 🇰🇷 **한국어 README:** [docs/README.ko.md](./docs/README.ko.md) · 👥 Team 오일이 · *D4D Hackathon* · *(dev name: AirMaven)*

> **⚠️ Live-data notice — the hosted database and collector were shut down after the hackathon.**
> The demo still loads, and the **live-external layers work in real time: aircraft (ADS-B), satellites, seismic, and air-raid alerts.** The layers that read from the recorded database — **timeline, vessels (AIS), Telegram OSINT, news feed, and NOTAM** — come back **empty** (no crash, just empty layers). To see the full system, **run it locally with your own Postgres + cron** — see [Self-hosting](#self-hosting).

---

## Why this exists

Situational awareness in a conflict or contested airspace depends on public data that is **scattered across a dozen tabs** — and on Telegram "strike claims" that get **consumed as fact without verification**. An analyst has to open ADS-B, AIS, Telegram, air-raid feeds, satellites, seismic, and NOTAM separately and reconcile them by hand.

Open Intelligence Layer does two things about that:

1. **Fusion** — every domain on one real-time 3D globe, filtered by what's in your viewport.
2. **Adjudication, not aggregation** — the hard part. When a channel claims a strike, the system geolocates it and asks *independent* signals whether it's real, then returns a **verdict + 0–100 confidence + the evidence it used**. Weak evidence does not get inflated into a strong score.

![Multi-domain fusion globe — airspace, air routes, live tracks, satellites](./docs/screenshots/01-fusion-globe.jpg)
<sub>Multi-domain fusion globe — airspace polygons, ROK air routes, live ADS-B tracks, and SGP4-propagated satellites in one view.</sub>

## Aggregation → Adjudication (the core loop)

```mermaid
flowchart TB
    P["Telegram posts<br/>(84 public channels)"] --> F{"war-result<br/>keyword?"}
    F -->|no| X["drop (noise / off-topic)"]
    F -->|yes| G["geolocate (gazetteer)"]
    G --> TH["thermal axis<br/>NASA FIRMS proximity + causal time window"]
    G --> XC["cross-source axis<br/>other channels, same place & time"]
    G --> RG["regional heat activity<br/>(weak context)"]
    TH --> S["confidence 0–100 + evidence ledger"]
    XC --> S
    RG --> S
    S --> V{"verdict"}
    V -->|"≥2 independent axes · ≥65"| V1["✅ CONFIRMED"]
    V -->|"≥30"| V2["🟡 LIKELY"]
    V -->|"no corroboration"| V3["🟠 UNVERIFIED"]
    V -->|"strong claim · signal absent"| V4["🔴 FALSE"]
    classDef good fill:#123,stroke:#2c6
    class V1 good
```

> "There's a fire in the region" ≠ "this specific strike is confirmed." The scorer separates the two with **causal time-and-distance windows**, and the exact same logic (`db/claimAssess.mjs`) runs on both the web verdict panel and the Telegram bot.

## Features

- **Real-time fusion globe** — global aircraft (ADS-B), ships (AIS), and satellites (TLE) on a MapLibre 3D globe, viewport/zoom filtered. Click any track for a popup that follows it (ID, speed, heading, altitude, coordinates).
- **OSINT verdict engine** — 84 channels → war-result filter → geolocate → **CONFIRMED / LIKELY / UNVERIFIED / FALSE + confidence + evidence ledger**, cross-checked against **live NASA FIRMS thermal anomalies** and corroborating sources.
- **Early-warning layers** — Ukraine air-raid alerts (`@air_alert_ua`), EMSC shallow-hypocenter ("blast-type") quakes, ROK special airspace (KADIZ · P-73) and air routes, OpenAIP global airspace, FAA NOTAM.
- **In-browser satellite propagation** — Celestrak TLE + SGP4 computed client-side (`satellite.js`), no server round-trip per frame.
- **AI copilot** — OpenAI-backed regional summary, rule-based anomaly assessment, multi-turn chat. Grounded strictly in the provided data, with inline source tags.
- **Telegram bot** — mobile queries (`/status` `/mil` `/verify <place>` `/ai <question>`) plus active pushes: 6-hour conflict briefing, anomalous-aircraft alerts (emergency squawk, AWACS/ISR/tanker/bomber), and air-raid/interception sirens.
- **Timeline replay** — scrub the last 6 hours of aircraft, vessel, and satellite movement.

## Screenshots

<table>
<tr>
<td width="50%"><img src="./docs/screenshots/02-airspace-notam.jpg" width="100%"><br><sub><b>Airspace + NOTAM</b> — class-colored airspace polygons and NOTAM control zones.</sub></td>
<td width="50%"><img src="./docs/screenshots/03-satellites.jpg" width="100%"><br><sub><b>Live satellites</b> — Celestrak TLE propagated in-browser with SGP4.</sub></td>
</tr>
<tr>
<td width="50%"><img src="./docs/screenshots/04-verification.jpg" width="100%"><br><sub><b>OSINT verdict</b> — verdict + confidence % + evidence panel.</sub></td>
<td width="50%"><img src="./docs/screenshots/05-osint-claim.jpg" width="100%"><br><sub><b>Claim node popup</b> — per-claim verdict, evidence, and link to the source post.</sub></td>
</tr>
<tr>
<td width="50%"><img src="./docs/screenshots/06-telegram-bot.jpg" width="100%"><br><sub><b>Telegram bot</b> — mobile queries + briefing / anomaly / air-raid pushes.</sub></td>
<td width="50%"><img src="./docs/screenshots/07-track-popup.jpg" width="100%"><br><sub><b>Track popup</b> — aircraft ID, altitude, speed, fused context.</sub></td>
</tr>
</table>

<sub>Captured from a live session — content varies by time and region.</sub>

## Architecture

```mermaid
flowchart LR
    SRC["19 public sources<br/>adsb · AIS · TLE · FIRMS · Telegram · …"]
    COL["Collector (Docker worker)<br/>AIS WebSocket + ADS-B polling"]
    CRON["Scheduler (cron)<br/>ingest 15m · briefing 6h · alerts 5m"]
    API["Serverless functions /api<br/>read · cron · bot(webhook+push)"]
    DB[("Postgres<br/>time-series")]
    WEB["Browser SPA<br/>React · MapLibre 3D · SGP4"]
    BOT["Telegram bot<br/>query · active push"]
    SRC --> COL --> DB
    SRC --> API
    CRON --> API
    API <--> DB
    API --> WEB
    API --> BOT
```

**Design principles:** separate ingest from read (collectors write time-series to Postgres; the frontend and bot read it back, never re-scrape per request) · hide keys (any keyed source is only touched server-side) · viewport-scope heavy layers (vessels, satellites, airspace render only for the current view). Full detail → [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Tech stack

| Area | Tech |
|---|---|
| Frontend | Vite · React 18 · TypeScript · MapLibre GL (3D globe) · satellite.js (SGP4) |
| Serverless API | Vercel Functions (Node) — 12 endpoints |
| Database | Postgres (Neon HTTP driver, `@neondatabase/serverless`) |
| Collector | Containerized worker — AISStream WebSocket + adsb.lol polling |
| Scheduling | Cron (GitHub Actions) |
| AI · bot | OpenAI (default `gpt-5.4-mini`) · Telegram Bot API (webhook + push) |
| Gates | vitest (61 tests) · `tsc` · `vite build` |

## Data sources (19, all public)

Chosen keyless wherever possible; any keyed source is server-side only and never shipped to the browser.

| Category | Sources |
|---|---|
| Tracks & position | **adsb.lol** (ADS-B, emergency squawks, military/high-value) · **AISStream** (global AIS) · **Celestrak** (TLE) |
| Threat & events | **NASA FIRMS** (thermal) · **EMSC** (seismic) · **@air_alert_ua** (UA air-raid) · **Tzeva Adom** (IL siren mirror) · **FAA NOTAM** |
| Airspace & geo | **OpenAIP** (global airspace tiles) · **data.go.kr** (ROK air routes) · **ROK AIP** (KADIZ · P-73) · **BigDataCloud** (reverse geocode) |
| OSINT & text | **84 public Telegram channels** · **GDELT** · defense/intl **RSS** (USNI, Defense News, Breaking Defense, TWZ, DoD, Al Jazeera, BBC, Yonhap) · **Open-Meteo** · **Google Translate** (keyless) |
| AI | **OpenAI** (copilot, briefing) · **Telegram Bot API** |

Full table with endpoints → [`docs/DATA-SOURCES.md`](./docs/DATA-SOURCES.md).

## Quickstart

```bash
npm install
npm run dev          # Vite app + public-data refresh loop
npm run build        # tsc -b && vite build
npm test             # vitest run (61 tests)
```

The live-external layers (ADS-B, satellites, seismic, air-raid alerts) work with **no keys and no database** — clone and `npm run dev` and the globe is live.

## Self-hosting

The database-backed layers (**timeline · vessels · Telegram OSINT · news feed · NOTAM**) need your own Postgres and an ingest run. Reproducing them is three steps:

**1. Postgres with `pgvector`** — `db/schema.sql` uses `CREATE EXTENSION vector`.
- Neon (free): `neonctl projects create`, or provision via the Vercel Marketplace, then copy the connection string.
- Any Postgres 15+ that can `CREATE EXTENSION vector;`.

**2. Configure `.env`** (see [`.env.example`](./.env.example)):
```bash
DATABASE_URL=postgres://user:pass@host/db?sslmode=require
```
> The driver is Neon HTTP (`@neondatabase/serverless`, `db/client.mjs`). For a non-Neon Postgres, swap `db/client.mjs` to `pg` (`Pool`).

**3. Migrate + ingest:**
```bash
npm run db:migrate   # idempotent — creates the 9 time-series tables
npm run record       # one-shot ingest (ADS-B · weather · OSINT · NOTAM · Telegram → Postgres)
```

For continuous AIS + ADS-B, the always-on collector (`collector/`) ships as a `Dockerfile` for any container host. **It writes 24/7**, so tune before running it: `PRUNE_HOURS` (retention; the frontend only reads ~6h), `WRITE_THROTTLE_MS` (min write interval per vessel MMSI), and set `AISSTREAM_API_KEY` (skips vessel ingest if absent). For a demo, a few `npm run record` runs are enough — you do not need the collector.

## Deploy

- **Web + API** — Vercel: `npx vercel --prod` (`dist/` static + `api/` serverless functions).
- **Collector** — any container host: root `Dockerfile` runs `collector/` (AIS WebSocket + ADS-B polling).
- **Scheduler** — GitHub Actions cron (currently `workflow_dispatch`-only; see the live-data notice above).
- **Secrets** — all server-side only, never in the browser bundle or git. Summary → [`docs/DATA-SOURCES.md`](./docs/DATA-SOURCES.md).

## Why it deploys straight to the field

- **100% open data → runs at UNCLASS immediately.** Strong exactly where classified sharing can't happen — **coalition / allied** situational awareness.
- **Decision support and I&W, not targeting** → lower legal/ROE threshold, faster to field. Emergency-squawk, high-value-asset, and air-raid pushes feed force protection, the air picture, and ISR cueing directly.
- **Portable** — serverless + containerized collector, so it re-hosts to on-prem, air-gapped, or government cloud with no SaaS lock-in. The bot transport is an adapter — swap Telegram for an approved messenger.
- **ROK-tuned** — KADIZ · P-73 · ROK air routes + a Korean-language AI copilot.

## Safety — non-targeting by design

- **Decision support and situational awareness — not identification, targeting, or engagement.** Military markers are public ADS-B flags, not identity resolution.
- **No synthetic or fabricated data** — public sources only, live-verified real data only. Channels must pass a live-reachability check.
- **Honest confidence** — weak evidence is never inflated into a high score.
- Secrets stay server-side, out of the browser and git.

## Honest limitations

- Public ADS-B/AIS is incomplete (sensitive aircraft, receiver coverage). Satellites are **TLE-computed** positions, not live telemetry.
- Israel alerts use the **Tzeva Adom mirror** of the official siren data (oref.org.il blocks foreign IPs).
- Cron-based ingest means "instant" is a ~5–15 min approximation; a resident worker tightens this in a real deployment.
- Telegram is not an approved secure channel — the transport is meant to be swapped for production.

## Docs

| Doc | Contents |
|---|---|
| [`docs/PROJECT.md`](./docs/PROJECT.md) | Submission overview · anti-Maven positioning · scoring map |
| [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) | Architecture · services · full feature list |
| [`docs/DATA-SOURCES.md`](./docs/DATA-SOURCES.md) | 19 external sources · endpoints · env vars |
| [`docs/AI-AND-BOT.md`](./docs/AI-AND-BOT.md) | AI copilot & Telegram bot internals |
| [`docs/README.ko.md`](./docs/README.ko.md) | 🇰🇷 한국어 README |

---

**Team 오일이** · D4D Hackathon · Open source, non-targeting, and honest about its own confidence.
