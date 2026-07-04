import type { Region, Track } from './types';
import { normalizeAdsbList, regionRadiusNm, type AdsbApiResponse } from './adsbCommon';

type FetchAirplanesLiveOpts = {
  region: Region;
  radiusNm?: number;
  signal?: AbortSignal;
  baseUrl?: string;
  rateLimitMs?: number;
};

const apiBaseUrl = 'https://api.airplanes.live/v2';
const defaultRateLimitMs = 1_000;
let nextAllowedRequestAt = 0;

async function enforceRateLimit(rateLimitMs = defaultRateLimitMs) {
  const now = Date.now();
  const waitMs = nextAllowedRequestAt - now;
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  nextAllowedRequestAt = Math.max(now, nextAllowedRequestAt) + rateLimitMs;
}

export function estimateAirplanesRadiusNm(region: Region, overrideRadiusNm?: number) {
  return regionRadiusNm(region, overrideRadiusNm);
}

export async function fetchAirplanesLiveTracks({
  region,
  radiusNm,
  signal,
  baseUrl = apiBaseUrl,
  rateLimitMs = defaultRateLimitMs,
}: FetchAirplanesLiveOpts): Promise<Track[]> {
  if (!region) return [];
  const radius = regionRadiusNm(region, radiusNm);
  const [lat, lon] = region.center;
  const safeBase = String(baseUrl).replace(/\/$/, '');
  const url = `${safeBase}/point/${lat}/${lon}/${radius}`;

  await enforceRateLimit(rateLimitMs);

  const response = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Airplanes.live API ${response.status} ${response.statusText}: ${body.slice(0, 180)}`);
  }

  const payload = await response.json() as AdsbApiResponse;
  if (payload.msg && payload.msg !== 'No error') {
    throw new Error(payload.msg);
  }
  return normalizeAdsbList(payload, region, { idPrefix: 'airplanes-live', sourceLabel: 'Airplanes.live point layer' });
}
