# Cloudflare Worker → Vercel migration for d4d.n2f.site

The Cloudflare Worker deployment path (`worker/index.js`, `wrangler.jsonc`,
`dev:cloudflare`/`deploy:cloudflare` scripts) has been removed from this repo.
The Vercel project `airmaven-d4d` is now the deployment target. The custom
domain `d4d.n2f.site` has been added to the Vercel project, but DNS still
points at Cloudflare, so **the live Cloudflare Worker must stay up** until you
complete the steps below.

## 1. Set the DNS record at your n2f.site DNS provider

Vercel returned this requirement when the domain was added to `airmaven-d4d`:

```
Type:  A
Name:  d4d.n2f.site
Value: 76.76.21.21
```

Set that `A` record with whichever provider hosts DNS for `n2f.site` (this may
or may not be Cloudflare's DNS — check where the zone actually lives before
editing). Do not touch nameservers; the `A` record is the recommended,
lower-risk option (alternative: repoint nameservers to
`ns1.vercel-dns.com` / `ns2.vercel-dns.com`, which is a bigger blast radius and
not recommended here).

Leave the existing Cloudflare Worker route/DNS entry for `d4d.n2f.site` in
place while you do this — don't delete or disable it yet.

## 2. Verify Vercel is serving the domain

After the DNS change propagates (can take minutes to a few hours):

```bash
# Confirm Vercel sees the domain as verified/configured
npx vercel domains inspect d4d.n2f.site

# Confirm it actually resolves to Vercel and serves the app
dig +short d4d.n2f.site
curl -sI https://d4d.n2f.site | head -5
```

`vercel domains inspect` should report the domain as configured (no more
"not configured properly" warning). The `curl` response should come back with
Vercel's edge headers and the app's `index.html`, not the Cloudflare Worker
response.

Only move to step 3 once you've confirmed this in a browser too — load
`https://d4d.n2f.site` and make sure the dashboard renders and live data
loads.

## 3. Decommission the Cloudflare Worker (only after step 2 is verified)

Once DNS is confirmed pointing at Vercel and the site is verified working
there, remove the Cloudflare side:

```bash
# Remove the deployed Worker
npx wrangler delete

# Then in the Cloudflare dashboard: Workers & Pages → the worker →
# Triggers → remove the d4d.n2f.site custom domain / route binding
# (and delete the LIVE_SCENARIOS KV namespace if it's no longer needed).
```

This step is irreversible for the Worker deployment — do not run it until
`d4d.n2f.site` has been confirmed serving from Vercel for a reasonable burn-in
period (recommend at least a few hours of normal traffic).
