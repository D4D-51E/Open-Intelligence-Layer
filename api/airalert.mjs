// Ukrainian air-raid alert layer endpoint — returns oblasts with a currently-active alert,
// derived from the public @air_alert_ua feed (see db/airAlert.mjs). Distinct from strike-claims:
// these are real-time imminent-threat alerts, not verified results. Public data, non-targeting.
import { fetchActiveAlerts } from '../db/airAlert.mjs';

export const config = { maxDuration: 20 };

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  // Alerts flip quickly; short CDN cache keeps it near-live without hammering t.me.
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=120');
  try {
    const { active, eventCount, scanned } = await fetchActiveAlerts({ pages: 3, maxAgeH: 6 });
    res.status(200).json({ ok: true, active, eventCount, scanned, updated: new Date().toISOString() });
  } catch (error) {
    res.status(200).json({ ok: false, error: String(error), active: [] });
  }
}
