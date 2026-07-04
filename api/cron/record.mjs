// Vercel Cron function: runs the observation writer on schedule (see vercel.json crons).
// Protected by CRON_SECRET — Vercel Cron injects `Authorization: Bearer <CRON_SECRET>`.
import { getSql } from '../../db/client.mjs';
import { recordAllObservations } from '../../db/ingest.mjs';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }
  try {
    const summary = await recordAllObservations(getSql());
    res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error) });
  }
}
