// Client for the `/api/history` endpoint, which replays previously cached track rows for
// the timeline scrubber (see TimelineControls.tsx). Read-only, best-effort: any failure
// (network, non-ok response, malformed payload) resolves to an empty list rather than throwing.

export type HistoryTrackRow = {
  observed_at: string;
  region_id: string;
  icao24: string | null;
  callsign: string | null;
  lat: number;
  lon: number;
  altitude_m: number | null;
  velocity_ms: number | null;
  heading_deg: number | null;
  is_military: boolean;
  type_code: string | null;
};

export type HistoryQuery = {
  region?: string;
  from?: string;
  to?: string;
  military?: boolean;
  limit?: number;
  baseUrl?: string;
  signal?: AbortSignal;
};

type HistoryResponse = {
  ok: boolean;
  rows?: HistoryTrackRow[];
};

function buildHistoryUrl(query: HistoryQuery): string {
  const base = query.baseUrl ?? '';
  const params = new URLSearchParams({ kind: 'tracks' });
  if (query.region) params.set('region', query.region);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.military !== undefined) params.set('military', query.military ? '1' : '0');
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  return `${base}/api/history?${params.toString()}`;
}

export async function fetchHistoryTracks(query: HistoryQuery): Promise<HistoryTrackRow[]> {
  try {
    const response = await fetch(buildHistoryUrl(query), { signal: query.signal });
    if (!response.ok) return [];
    const payload = await response.json() as HistoryResponse;
    if (!payload.ok) return [];
    return payload.rows ?? [];
  } catch {
    return [];
  }
}
