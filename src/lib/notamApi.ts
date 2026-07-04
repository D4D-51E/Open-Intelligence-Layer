// Client for the live NOTAM feed (Neon-backed /api/notam). Returns raw rows; App maps
// them to AirspaceNotice circles for the globe.
export type NotamRow = {
  observed_at: string;
  icao: string | null;
  notam_number: string | null;
  feature: string | null;
  lat: number;
  lon: number;
  radius_km: number | null;
  fl_min: number | null;
  fl_max: number | null;
  start_at: string | null;
  end_at: string | null;
};

export type NotamQuery = {
  bbox?: [number, number, number, number];
  limit?: number;
  baseUrl?: string;
  signal?: AbortSignal;
};

export async function fetchNotam(query: NotamQuery = {}): Promise<NotamRow[]> {
  const params = new URLSearchParams();
  if (query.bbox) params.set('bbox', query.bbox.join(','));
  params.set('limit', String(query.limit ?? 500));
  try {
    const res = await fetch(`${query.baseUrl ?? ''}/api/notam?${params.toString()}`, { signal: query.signal, cache: 'no-store' });
    if (!res.ok) return [];
    const json = await res.json() as { ok?: boolean; rows?: NotamRow[] };
    return json.ok && Array.isArray(json.rows) ? json.rows : [];
  } catch {
    return [];
  }
}
