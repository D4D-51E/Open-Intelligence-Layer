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
  title         TEXT NOT NULL,
  url           TEXT,
  summary       TEXT,
  natural_key   TEXT,
  payload       JSONB,
  embedding     vector(1536)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_osint_natural   ON osint_items (natural_key) WHERE natural_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_osint_region_time     ON osint_items (region_id, observed_at DESC);

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
