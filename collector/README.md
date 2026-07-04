# AirMaven AIS Collector (Railway worker)

A single always-on process that holds one AISStream WebSocket (global by default), keeps the
latest position per MMSI, and flushes throttled snapshots into the Neon `vessel_observations`
table. The web app and `/api/history?kind=vessels` are **unchanged** — this just replaces the
5-minute per-AOI cron as the vessel ingestion source, giving worldwide coverage instead of 4
fixed boxes.

Verified locally: a ~45 s run wrote 4,000 vessels spanning lat −54.8…79.8, lon −171.7…177.4
(truly global; density follows AISStream's volunteer receivers — busiest near coasts/lanes).

## Deploy on Railway

**Dashboard**
1. New Project → **Deploy from GitHub repo** → select this repo.
2. Service → **Settings → Root Directory = `collector`** (so Railway builds only this folder).
3. Railway auto-detects Node and runs `npm install` then `npm start`. No port/health check —
   it's a background worker, not a web service.
4. Service → **Variables**, add:
   - `DATABASE_URL` — the same Neon connection string the app uses.
   - `AISSTREAM_API_KEY` — the AISStream key (server-side only).
5. Deploy. Watch logs for `[ais] connected` and `[stat] tracked=… written=…`.

**CLI** (from `collector/`): `railway init` → `railway variables set DATABASE_URL=… AISSTREAM_API_KEY=…` → `railway up`.

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | Neon connection string |
| `AISSTREAM_API_KEY` | — (required) | AISStream WebSocket key |
| `AIS_BBOX` | `[[[-90,-180],[90,180]]]` | Subscription box(es), `[[[minLat,minLon],[maxLat,maxLon]]]`. Narrow to cut volume, e.g. Asia-Pacific `[[[-15,90],[55,150]]]`. |
| `FLUSH_MS` | `30000` | How often snapshots are written |
| `WRITE_THROTTLE_MS` | `180000` | Max one row per MMSI per this window |
| `MAX_ROWS_PER_FLUSH` | `2000` | Cap rows written per flush |
| `PRUNE_HOURS` | `24` | Retention — rows older than this are deleted hourly (frontend queries ~6 h) |

## Volume & cost note

Global AIS is a firehose. `WRITE_THROTTLE_MS` + `MAX_ROWS_PER_FLUSH` bound the write rate and
`PRUNE_HOURS` bounds table size, but true-global on Neon's free tier can still be sizeable —
lower `PRUNE_HOURS` or narrow `AIS_BBOX` if storage is tight. Coverage is limited to AISStream's
receiver network (public data only; no synthetic positions).

## Relationship to the cron

Once this worker is live it supersedes the `.github/workflows/record-vessels.yml` 5-min cron
(which only covered 4 AOIs). Both can run at once harmlessly — the app queries by viewport bbox
regardless of source — but you can disable that workflow to avoid redundant writes.
