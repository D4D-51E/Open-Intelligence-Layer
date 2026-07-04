// Telegram OSINT read API — serves persisted posts from Neon (populated by the collector in
// db/telegramIngest.mjs, run on the 15-min recorder). Fast + stable vs re-scraping t.me per
// request. Returns the recent strike-result posts; the client geolocates + assesses them.
import { getSql } from '../db/client.mjs';

export default async function handler(req, res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  try {
    const sql = getSql();
    const limit = Math.min(500, Math.max(1, Number.parseInt(String(req.query.limit ?? '300'), 10) || 300));
    const rows = await sql`
      SELECT observed_at, channel, channel_label, color, post_id, text, url
      FROM telegram_posts
      ORDER BY observed_at DESC
      LIMIT ${limit}
    `;
    const posts = rows.map((r) => ({
      channel: r.channel,
      channelLabel: r.channel_label,
      color: r.color,
      postId: Number(r.post_id),
      text: r.text,
      date: r.observed_at,
      url: r.url,
    }));
    res.status(200).json({ ok: true, posts, updated: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: String(error), posts: [] });
  }
}
