// Viewport-driven fetch strategy: at low zoom the map shows the whole globe, so we pull
// the cheap global military-only feed; once the user zooms into a region we switch to a
// point/radius feed scoped to the visible bounds (see adsbLolApi.ts / airplanesLiveApi.ts).

export type Viewport = {
  bbox: [number, number, number, number]; // [minLon, minLat, maxLon, maxLat]
  center: [number, number]; // [lat, lon]
  zoom: number;
};

export const VIEWPORT_ZOOM_THRESHOLD = 3.2;

const EARTH_RADIUS_NM = 3440.065;
const CORNER_PADDING_FACTOR = 1.12;
const MIN_RADIUS_NM = 6;
const MAX_RADIUS_NM = 250;

function degToRad(value: number) {
  return (value * Math.PI) / 180;
}

function haversineNm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = degToRad(bLat - aLat);
  const dLon = degToRad(bLon - aLon);
  const lat1 = degToRad(aLat);
  const lat2 = degToRad(bLat);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
  const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  return EARTH_RADIUS_NM * c;
}

export function fetchStrategyForZoom(zoom: number): 'global-mil' | 'viewport' {
  return zoom < VIEWPORT_ZOOM_THRESHOLD ? 'global-mil' : 'viewport';
}

export function boundsToViewport(
  bounds: { west: number; south: number; east: number; north: number },
  zoom: number,
): Viewport {
  const { west, south, east, north } = bounds;
  return {
    bbox: [west, south, east, north],
    center: [(south + north) / 2, (west + east) / 2],
    zoom,
  };
}

export function viewportRadiusNm(bbox: [number, number, number, number], center: [number, number]): number {
  const [minLon, minLat, maxLon, maxLat] = bbox;
  const [centerLat, centerLon] = center;
  const cornerDistances = [
    haversineNm(centerLat, centerLon, minLat, minLon),
    haversineNm(centerLat, centerLon, minLat, maxLon),
    haversineNm(centerLat, centerLon, maxLat, minLon),
    haversineNm(centerLat, centerLon, maxLat, maxLon),
  ];
  const maxCornerNm = Math.max(...cornerDistances);
  const padded = maxCornerNm * CORNER_PADDING_FACTOR;
  return Math.min(MAX_RADIUS_NM, Math.max(MIN_RADIUS_NM, padded));
}
