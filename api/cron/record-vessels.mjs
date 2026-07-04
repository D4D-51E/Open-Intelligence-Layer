// Vercel Cron function: collects AIS vessel positions on its own schedule, separate from
// the main observation writer (api/cron/record.mjs). AIS uses a short-lived WebSocket window
// with a different timing profile, so it runs independently to keep both under the fn limit.
// Protected by CRON_SECRET — the GitHub Actions scheduler injects `Authorization: Bearer …`.
import { getSql } from '../../db/client.mjs';
import { collectVessels } from '../../db/aisIngest.mjs';
import { regions } from '../../db/ingest.mjs';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const summary = await collectVessels(getSql(), { regions });
    res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
}
