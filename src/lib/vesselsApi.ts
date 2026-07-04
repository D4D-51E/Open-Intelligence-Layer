// Client for `/api/history?kind=vessels`, which replays recorded AIS vessel observations
// (see db/aisIngest.mjs) for the viewport ship layer. Read-only, best-effort: any failure
// resolves to an empty list rather than throwing. Rows are aggregated by MMSI into
// multi-point ShipTracks so vessels render with trails (항적), like aircraft tracks.
import type { ShipTrack } from './types';

export type VesselObsRow = {
  observed_at: string;
  region_id: string;
  mmsi: string;
  name: string | null;
  vessel_type: string;
  lat: number;
  lon: number;
  sog_knots: number | null;
  cog_deg: number | null;
};

export type VesselQuery = {
  bbox?: [number, number, number, number];
  region?: string;
  from?: string;
  to?: string;
  limit?: number;
  baseUrl?: string;
  signal?: AbortSignal;
};

function buildUrl(query: VesselQuery): string {
  const base = query.baseUrl ?? '';
  const params = new URLSearchParams({ kind: 'vessels' });
  if (query.bbox) params.set('bbox', query.bbox.join(','));
  if (query.region) params.set('region', query.region);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  return `${base}/api/history?${params.toString()}`;
}

const VESSEL_TYPES: ReadonlySet<ShipTrack['vesselType']> = new Set(['cargo', 'tanker', 'fishing', 'unknown']);
function toVesselType(value: string): ShipTrack['vesselType'] {
  return VESSEL_TYPES.has(value as ShipTrack['vesselType']) ? (value as ShipTrack['vesselType']) : 'unknown';
}

// Group observation rows by MMSI, sort each vessel's points by time → one ShipTrack per vessel.
export function buildVesselTracks(rows: VesselObsRow[]): ShipTrack[] {
  const byMmsi = new Map<string, VesselObsRow[]>();
  for (const row of rows) {
    const existing = byMmsi.get(row.mmsi);
    if (existing) existing.push(row);
    else byMmsi.set(row.mmsi, [row]);
  }
  return [...byMmsi].map(([mmsi, group]) => {
    const sorted = [...group].sort((a, b) => a.observed_at.localeCompare(b.observed_at));
    const latest = sorted[sorted.length - 1];
    return {
      id: `ais-${mmsi}`,
      source: 'ais-cache',
      name: latest.name ?? `MMSI ${mmsi}`,
      mmsi,
      vesselType: toVesselType(latest.vessel_type),
      notes: 'AISStream 관측 (공개 수신기 커버리지는 불완전).',
      points: sorted.map((row) => ({
        lat: row.lat,
        lon: row.lon,
        speedKnots: row.sog_knots ?? 0,
        courseDeg: row.cog_deg ?? 0,
        observedAt: row.observed_at,
      })),
    };
  });
}

export async function fetchVesselTracks(query: VesselQuery): Promise<ShipTrack[]> {
  try {
    const response = await fetch(buildUrl(query), { signal: query.signal });
    if (!response.ok) return [];
    const payload = await response.json() as { ok: boolean; rows?: VesselObsRow[] };
    if (!payload.ok) return [];
    return buildVesselTracks(payload.rows ?? []);
  } catch {
    return [];
  }
}
