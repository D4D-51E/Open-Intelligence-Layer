// Local runner for the observation writer. Run: node --env-file=.env scripts/record-observations.mjs
// Production uses the same logic via the Vercel Cron function api/cron/record.mjs.
import { getSql } from '../db/client.mjs';
import { recordAllObservations } from '../db/ingest.mjs';

const summary = await recordAllObservations(getSql(), { log: (m) => console.log(`[record] ${m}`) });
console.log('[record] done', JSON.stringify({ tracks: summary.totalTracks, weather: summary.totalWeather, mil: summary.militaryFeed }));
