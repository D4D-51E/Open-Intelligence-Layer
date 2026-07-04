// Client for /api/satellites — fetches public Celestrak TLEs once, then propagates them locally
// with SGP4 (satellite.js) to live sub-point positions. TLEs change ~daily, so we fetch the
// element set once and re-propagate every tick on the client rather than re-fetching.
import { twoline2satrec, propagate, gstime, eciToGeodetic, degreesLat, degreesLong } from 'satellite.js';
import type { SatellitePass } from './types';

export type SatelliteTle = { name: string; l1: string; l2: string; norad: string };
type SatelliteResponse = { ok: boolean; count?: number; satellites?: SatelliteTle[] };

// Cached parsed satrecs keyed by the raw TLE lines, so re-fetching the same catalogue is cheap.
type SatRec = ReturnType<typeof twoline2satrec>;
export type SatelliteModel = SatelliteTle & { satrec: SatRec; roleHint: SatellitePass['roleHint'] };

const COMMS = /STARLINK|ONEWEB|IRIDIUM|GLOBALSTAR|INTELSAT|INMARSAT|SES-|EUTELSAT|VIASAT|O3B/i;
const WEATHER = /NOAA|GOES|METEOR|METOP|HIMAWARI|FENGYUN|FY-|DMSP|GOMS|ELEKTRO/i;
const EO = /LANDSAT|SENTINEL|WORLDVIEW|PLANET|SPOT|KOMPSAT|TERRA|AQUA|GEOEYE|ICEYE|CAPELLA|PLEIADES/i;

function roleFor(name: string): SatellitePass['roleHint'] {
  if (COMMS.test(name)) return 'communications';
  if (WEATHER.test(name)) return 'weather';
  if (EO.test(name)) return 'earth observation';
  return 'public orbital awareness';
}

export async function fetchSatelliteModels(group = 'active', signal?: AbortSignal): Promise<SatelliteModel[]> {
  try {
    const res = await fetch(`/api/satellites?group=${encodeURIComponent(group)}`, { signal });
    if (!res.ok) return [];
    const payload = await res.json() as SatelliteResponse;
    if (!payload.ok || !payload.satellites) return [];
    const models: SatelliteModel[] = [];
    for (const tle of payload.satellites) {
      try {
        const satrec = twoline2satrec(tle.l1, tle.l2);
        models.push({ ...tle, satrec, roleHint: roleFor(tle.name) });
      } catch {
        // Skip malformed element sets rather than aborting the whole catalogue.
      }
    }
    return models;
  } catch {
    return [];
  }
}

// Propagate every model to its current sub-point. Decayed / un-propagatable objects are dropped.
export function propagateSatellites(models: SatelliteModel[], at: Date): SatellitePass[] {
  const gmst = gstime(at);
  const iso = at.toISOString();
  const passes: SatellitePass[] = [];
  for (const model of models) {
    let pv;
    try {
      pv = propagate(model.satrec, at);
    } catch {
      continue;
    }
    if (!pv) continue;
    const position = pv.position;
    if (!position || typeof position === 'boolean') continue;
    const geo = eciToGeodetic(position, gmst);
    const lat = degreesLat(geo.latitude);
    const lon = degreesLong(geo.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const velocity = pv.velocity;
    const direction = typeof velocity === 'object' && velocity ? (velocity.z >= 0 ? '북행(상승)' : '남행(하강)') : '—';
    passes.push({
      id: `sat-${model.norad}`,
      source: 'celestrak-cache',
      name: model.name,
      noradId: model.norad,
      observedAt: iso,
      lat,
      lon,
      altitudeKm: Math.round(geo.height),
      direction,
      roleHint: model.roleHint,
    });
  }
  return passes;
}
