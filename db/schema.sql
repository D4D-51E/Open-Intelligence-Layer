-- AirMaven observation store (Neon Postgres) — Phase 1.
-- Time-series observations for the timeline feature; pgvector prepared for Phase 3 RAG.
-- Idempotent: safe to re-run.

CREATE EXTENSION IF NOT EXISTS vector;

-- ADS-B track observations: one row per aircraft per collection tick.
CREATE TABLE IF NOT EXISTS track_observations (
  id            BIGSERIAL PRIMARY KEY,
  observed_at   TIMESTAMPTZ NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  region_id     TEXT NOT NULL,
  icao24        TEXT,
  callsign      TEXT,
  lat           DOUBLE PRECISION NOT NULL,
  lon           DOUBLE PRECISION NOT NULL,
  altitude_m    INTEGER,
  velocity_ms   DOUBLE PRECISION,
  heading_deg   INTEGER,
  is_military   BOOLEAN NOT NULL DEFAULT false,
  type_code     TEXT,
  registration  TEXT,
  source        TEXT NOT NULL,
  payload       JSONB
);
CREATE INDEX IF NOT EXISTS idx_track_obs_region_time ON track_observations (region_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_track_obs_icao_time   ON track_observations (icao24, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_track_obs_military    ON track_observations (region_id, observed_at DESC) WHERE is_military;

-- AIS vessel observations: one row per vessel per collection tick (AISStream WebSocket).
-- Powers the viewport vessel layer + trails, mirroring track_observations for aircraft.
CREATE TABLE IF NOT EXISTS vessel_observations (
  id            BIGSERIAL PRIMARY KEY,
  observed_at   TIMESTAMPTZ NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  region_id     TEXT NOT NULL,
  mmsi          TEXT NOT NULL,
  name          TEXT,
  vessel_type   TEXT NOT NULL DEFAULT 'unknown',
  lat           DOUBLE PRECISION NOT NULL,
  lon           DOUBLE PRECISION NOT NULL,
  sog_knots     DOUBLE PRECISION,
  cog_deg       INTEGER,
  source        TEXT NOT NULL DEFAULT 'aisstream',
  payload       JSONB
);
CREATE INDEX IF NOT EXISTS idx_vessel_obs_region_time ON vessel_observations (region_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_vessel_obs_mmsi_time   ON vessel_observations (mmsi, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_vessel_obs_time        ON vessel_observations (observed_at DESC);

-- Region weather snapshots.
CREATE TABLE IF NOT EXISTS weather_observations (
  id             BIGSERIAL PRIMARY KEY,
  observed_at    TIMESTAMPTZ NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  region_id      TEXT NOT NULL,
  temperature_c  DOUBLE PRECISION,
  wind_gust_kmh  DOUBLE PRECISION,
  visibility_m   INTEGER,
  cloud_pct      INTEGER,
  precip_mm      DOUBLE PRECISION,
  payload        JSONB
);
CREATE INDEX IF NOT EXISTS idx_weather_obs_region_time ON weather_observations (region_id, observed_at DESC);

-- OSINT items (news/events). natural_key enables idempotent upserts across runs.
-- embedding is nullable until Phase 3 backfills it (dim 1536 = OpenAI text-embedding-3-small; adjustable).
CREATE TABLE IF NOT EXISTS osint_items (
  id            BIGSERIAL PRIMARY KEY,
  observed_at   TIMESTAMPTZ NOT NULL,
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  region_id     TEXT NOT NULL,
  source        TEXT NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'broad',
  title         TEXT NOT NULL,
  url           TEXT,
  summary       TEXT,
  lat           DOUBLE PRECISION,
  lon           DOUBLE PRECISION,
  natural_key   TEXT,
  payload       JSONB,
  embedding     vector(1536)
);
-- Backfill new columns on an already-existing osint_items table (CREATE TABLE IF NOT EXISTS skips them).
ALTER TABLE osint_items ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'broad';
ALTER TABLE osint_items ADD COLUMN IF NOT EXISTS lat  DOUBLE PRECISION;
ALTER TABLE osint_items ADD COLUMN IF NOT EXISTS lon  DOUBLE PRECISION;
CREATE UNIQUE INDEX IF NOT EXISTS uq_osint_natural   ON osint_items (natural_key) WHERE natural_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_osint_region_time     ON osint_items (region_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_osint_geo_time        ON osint_items (observed_at DESC) WHERE lat IS NOT NULL;

-- NOTAM notices (FAA notamSearch), placed by the Q-line coordinate/radius when parseable.
CREATE TABLE IF NOT EXISTS notam_notices (
  id             BIGSERIAL PRIMARY KEY,
  observed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  source         TEXT NOT NULL DEFAULT 'faa',
  icao           TEXT,
  notam_number   TEXT,
  feature        TEXT,
  lat            DOUBLE PRECISION,
  lon            DOUBLE PRECISION,
  radius_km      DOUBLE PRECISION,
  fl_min         INTEGER,
  fl_max         INTEGER,
  start_at       TIMESTAMPTZ,
  end_at         TIMESTAMPTZ,
  text           TEXT,
  natural_key    TEXT,
  payload        JSONB
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notam_natural ON notam_notices (natural_key) WHERE natural_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notam_geo ON notam_notices (observed_at DESC) WHERE lat IS NOT NULL;

-- Telegram OSINT posts (public t.me channels). Persisted by the collector so the feed is
-- historical + deduped and the API serves from Neon instead of re-scraping per request.
CREATE TABLE IF NOT EXISTS telegram_posts (
  id             BIGSERIAL PRIMARY KEY,
  observed_at    TIMESTAMPTZ NOT NULL,
  recorded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel        TEXT NOT NULL,
  channel_label  TEXT NOT NULL,
  color          TEXT,
  post_id        BIGINT,
  text           TEXT NOT NULL,
  url            TEXT,
  natural_key    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_telegram_natural ON telegram_posts (natural_key);
CREATE INDEX IF NOT EXISTS idx_telegram_time ON telegram_posts (observed_at DESC);

-- Ingest run log for observability.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id          BIGSERIAL PRIMARY KEY,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  region_id   TEXT,
  source      TEXT NOT NULL,
  status      TEXT NOT NULL,
  records     INTEGER NOT NULL DEFAULT 0,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_ingest_runs_time ON ingest_runs (started_at DESC);

-- Telegram bot push: subscribers (who receives proactive alerts) + a dedup log so the 5-min
-- poll never re-pushes the same emergency/siren/briefing.
CREATE TABLE IF NOT EXISTS bot_subscribers (
  chat_id     TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bot_push_log (
  dedup_key   TEXT PRIMARY KEY,
  pushed_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bot_push_time ON bot_push_log (pushed_at DESC);
