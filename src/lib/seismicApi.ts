// Client for /api/seismic — EMSC seismic events with an explosion-like (near-surface) flag.
// Best-effort: any failure resolves to an empty list rather than throwing.

export type SeismicEvent = {
  id: string;
  lat: number;
  lon: number;
  mag: number | null;
  magType: string | null;
  depthKm: number | null;
  region: string;
  time: string | null;
  evtype: string | null;
  explosionLike: boolean;
};

type SeismicResponse = { ok: boolean; events?: SeismicEvent[] };

export async function fetchSeismic(
  bbox: [number, number, number, number] | undefined,
  hours = 24,
  signal?: AbortSignal,
): Promise<SeismicEvent[]> {
  try {
    const params = new URLSearchParams({ hours: String(hours) });
    if (bbox) params.set('bbox', bbox.join(','));
    const res = await fetch(`/api/seismic?${params.toString()}`, { signal });
    if (!res.ok) return [];
    const payload = await res.json() as SeismicResponse;
    if (!payload.ok) return [];
    return payload.events ?? [];
  } catch {
    return [];
  }
}
