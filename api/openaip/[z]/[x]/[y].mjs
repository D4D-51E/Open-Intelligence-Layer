// Same-origin OpenAIP vector-tile proxy — injects OPENAIP_API_KEY server-side so the
// key is never exposed to the browser. maplibre requests /api/openaip/{z}/{x}/{y}.
export default async function handler(req, res) {
  const key = process.env.OPENAIP_API_KEY;
  if (!key) {
    res.status(500).json({ ok: false, error: 'OPENAIP_API_KEY not set' });
    return;
  }
  const { z, x, y } = req.query;
  if (![z, x, y].every((v) => /^\d{1,3}$/.test(String(v)))) {
    res.status(400).json({ ok: false, error: 'invalid tile coordinate' });
    return;
  }
  const url = `https://api.tiles.openaip.net/api/data/openaip/${z}/${x}/${y}.pbf?apiKey=${key}`;
  try {
    const upstream = await fetch(url);
    if (upstream.status === 204 || upstream.status === 404) {
      res.status(204).end();
      return;
    }
    if (!upstream.ok) {
      res.status(upstream.status).end();
      return;
    }
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('content-type', 'application/x-protobuf');
    res.setHeader('cache-control', 'public, max-age=86400, s-maxage=86400');
    res.setHeader('access-control-allow-origin', '*');
    res.status(200).send(buffer);
  } catch (error) {
    res.status(502).json({ ok: false, error: String(error) });
  }
}
