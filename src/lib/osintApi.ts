// Client for the live OSINT feed (Neon-backed /api/osint). Returns raw rows; App maps
// them to OsintMapEvent for the globe.
export type OsintRow = {
  observed_at: string;
  region_id: string;
  source: string;
  tier: string;
  title: string;
  url: string | null;
  summary: string | null;
  lat: number | null;
  lon: number | null;
};

export type OsintQuery = {
  from?: string;
  to?: string;
  region?: string;
  tier?: string;
  limit?: number;
  baseUrl?: string;
  signal?: AbortSignal;
};

export async function fetchOsint(query: OsintQuery = {}): Promise<OsintRow[]> {
  const params = new URLSearchParams();
  if (query.region) params.set('region', query.region);
  if (query.tier) params.set('tier', query.tier);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  params.set('limit', String(query.limit ?? 500));
  try {
    const res = await fetch(`${query.baseUrl ?? ''}/api/osint?${params.toString()}`, { signal: query.signal, cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json() as { ok?: boolean; rows?: OsintRow[] };
    return json.ok && Array.isArray(json.rows) ? json.rows : [];
  } catch {
    return [];
  }
}
