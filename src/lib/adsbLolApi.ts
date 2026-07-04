import type { Region, Track } from './types';
import { isWithinRegion, normalizeAdsbList, regionRadiusNm, type AdsbApiResponse } from './adsbCommon';

// A synthetic Region for viewport-driven (non-AOI-preset) fetching. normalizeAdsbList only
// uses region.id (for the track id prefix) and region.bbox (for mil intersection), so a
// lightweight object with a stable id is sufficient.
function viewportRegion(center: [number, number], bbox: [number, number, number, number]): Region {
  return {
    id: 'global',
    name: 'viewport',
    shortName: 'viewport',
    description: '',
    bbox,
    center,
    zoom: 4,
  };
}

// adsb.lol is a free, no-key community ADS-B aggregator with the same readsb JSON
// shape as Airplanes.live. We use two endpoints:
//   - /v2/lat/{lat}/lon/{lon}/dist/{nm}  → regional point feed (redundant coverage)
//   - /v2/mil                            → global military-only feed, intersected with the AOI

type FetchAdsbLolOpts = {
  region: Region;
  radiusNm?: number;
  signal?: AbortSignal;
  baseUrl?: string;
  rateLimitMs?: number;
  includeMilitary?: boolean;
};

// adsb.lol has no CORS headers, so the browser hits it through a same-origin proxy
// (`/adsb-lol` → https://api.adsb.lol via Vite dev proxy / Vercel rewrite).
const apiBaseUrl = '/adsb-lol/v2';
const defaultRateLimitMs = 1_000;
let nextAllowedRequestAt = 0;

async function enforceRateLimit(rateLimitMs = defaultRateLimitMs) {
  const now = Date.now();
  const waitMs = nextAllowedRequestAt - now;
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  nextAllowedRequestAt = Math.max(now, nextAllowedRequestAt) + rateLimitMs;
}

async function fetchAdsbJson(url: string, signal?: AbortSignal): Promise<AdsbApiResponse> {
  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`adsb.lol API ${response.status} ${response.statusText}: ${body.slice(0, 180)}`);
  }
  const payload = await response.json() as AdsbApiResponse;
  if (payload.msg && payload.msg !== 'No error') {
    throw new Error(payload.msg);
  }
  return payload;
}

export function estimateAdsbLolRadiusNm(region: Region, overrideRadiusNm?: number) {
  return regionRadiusNm(region, overrideRadiusNm);
}

export async function fetchAdsbLolTracks({
  region,
  radiusNm,
  signal,
  baseUrl = apiBaseUrl,
  rateLimitMs = defaultRateLimitMs,
  includeMilitary = true,
}: FetchAdsbLolOpts): Promise<Track[]> {
  if (!region) return [];
  const radius = regionRadiusNm(region, radiusNm);
  const [lat, lon] = region.center;
  const safeBase = String(baseUrl).replace(/\/$/, '');

  await enforceRateLimit(rateLimitMs);
  const pointPayload = await fetchAdsbJson(`${safeBase}/lat/${lat}/lon/${lon}/dist/${radius}`, signal);
  const pointTracks = normalizeAdsbList(pointPayload, region, { idPrefix: 'adsb-lol', sourceLabel: 'adsb.lol' });

  let militaryTracks: Track[] = [];
  if (includeMilitary && region.id !== 'global') {
    try {
      await enforceRateLimit(rateLimitMs);
      const milPayload = await fetchAdsbJson(`${safeBase}/mil`, signal);
      militaryTracks = normalizeAdsbList(
        milPayload,
        region,
        { idPrefix: 'adsb-lol', sourceLabel: 'adsb.lol 군용', forceMilitary: true },
        (_aircraft, track) => {
          const last = track.points[0];
          return last ? isWithinRegion(region, last.lat, last.lon) : false;
        },
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      // The global military overlay is best-effort; keep the point feed if it fails.
      militaryTracks = [];
    }
  }

  // Dedupe by stable id (same idPrefix for both feeds). The military-flagged record wins
  // so an aircraft present in both feeds keeps isMilitary=true.
  const merged = new Map<string, Track>();
  for (const track of [...pointTracks, ...militaryTracks]) {
    const existing = merged.get(track.id);
    if (!existing || (track.isMilitary && !existing.isMilitary)) merged.set(track.id, track);
  }
  return [...merged.values()].sort((a, b) => (b.points[0]?.velocityMs ?? 0) - (a.points[0]?.velocityMs ?? 0));
}

// Viewport-driven (zoomed-in) point feed at an arbitrary map center — not an AOI preset.
// Point feed already includes military aircraft (via dbFlags), so the /v2/mil overlay is
// skipped here; worldwide military is fetched separately at low zoom.
export async function fetchAdsbLolViewportTracks(opts: {
  center: [number, number];
  bbox: [number, number, number, number];
  radiusNm: number;
  signal?: AbortSignal;
  baseUrl?: string;
  rateLimitMs?: number;
}): Promise<Track[]> {
  return fetchAdsbLolTracks({
    region: viewportRegion(opts.center, opts.bbox),
    radiusNm: opts.radiusNm,
    signal: opts.signal,
    baseUrl: opts.baseUrl,
    rateLimitMs: opts.rateLimitMs,
    includeMilitary: false,
  });
}

// Worldwide military-only feed (adsb.lol /v2/mil), unfiltered — used when the globe is
// zoomed out to a global view.
export async function fetchAdsbLolGlobalMilitary(opts: { signal?: AbortSignal; baseUrl?: string; rateLimitMs?: number } = {}): Promise<Track[]> {
  const safeBase = String(opts.baseUrl ?? apiBaseUrl).replace(/\/$/, '');
  await enforceRateLimit(opts.rateLimitMs ?? defaultRateLimitMs);
  const payload = await fetchAdsbJson(`${safeBase}/mil`, opts.signal);
  const region = viewportRegion([20, 0], [-180, -85, 180, 85]);
  return normalizeAdsbList(payload, region, { idPrefix: 'adsb-lol-mil', sourceLabel: 'adsb.lol 군용', forceMilitary: true });
}
