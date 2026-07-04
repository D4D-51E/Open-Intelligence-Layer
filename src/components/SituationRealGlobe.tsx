import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type MapMouseEvent, type StyleSpecification } from 'maplibre-gl';
import { useEffect, useMemo, useRef } from 'react';
import type { AirportContext, AirRoute, AirspaceContext, AirspaceNotice, Anomaly, OsintMapEvent, ReferenceLine, Region, RegionId, SatellitePass, ShipTrack, Track, WatchZone } from '../lib/types';
import { VERDICT_COLOR, type AssessedClaim } from '../lib/claimVerify';
import type { SeismicEvent } from '../lib/seismicApi';
import type { AirAlert } from '../lib/airAlertApi';
import { safeExternalUrl } from '../lib/safeLinks';
import { MapRegionSwitcher } from './MapRegionSwitcher';

type SituationRealGlobeProps = {
  region: Region;
  selectableRegions?: Region[];
  onRegionSelect?: (regionId: RegionId) => void;
  tracks: Track[];
  ships: ShipTrack[];
  zones: WatchZone[];
  referenceLines: ReferenceLine[];
  satellites: SatellitePass[];
  airports: AirportContext[];
  airRoutes: AirRoute[];
  notices: AirspaceNotice[];
  airspaceContexts: AirspaceContext[];
  osintEvents: OsintMapEvent[];
  claims: AssessedClaim[];
  seismic: SeismicEvent[];
  airAlerts: AirAlert[];
  anomalies: Anomaly[];
  onViewportChange?: (viewport: { bbox: [number, number, number, number]; zoom: number; center: [number, number] }) => void;
  focusTrack?: { id: string; lat: number; lon: number; html: string } | null;
  onFocusClose?: () => void;
  onSelectTrack?: (trackId: string) => void;
  onSelectShip?: (shipId: string) => void;
  showAirspace?: boolean;
  showAirways?: boolean;
};

type Coordinate = [number, number];
type PointGeometry = { type: 'Point'; coordinates: Coordinate };
type LineStringGeometry = { type: 'LineString'; coordinates: Coordinate[] };
type PolygonGeometry = { type: 'Polygon'; coordinates: Coordinate[][] };
type Geometry = PointGeometry | LineStringGeometry | PolygonGeometry;
type Properties = Record<string, string | number | boolean | null>;
type Feature = { type: 'Feature'; id?: string | number; properties: Properties; geometry: Geometry };
type FeatureCollection = { type: 'FeatureCollection'; features: Feature[] };

type OverlayCollections = {
  polygons: FeatureCollection;
  lines: FeatureCollection;
  points: FeatureCollection;
  labels: FeatureCollection;
};

declare global {
  interface Window {
    __airmavenMap?: MapLibreMap;
  }
}

const sourceIds = ['airmaven-polygons', 'airmaven-lines', 'airmaven-points', 'airmaven-labels'] as const;
const openFreeMapDarkStyle = 'https://tiles.openfreemap.org/styles/dark';

function isViteDevRuntime() {
  return Boolean((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function lonLat(lat: number, lon: number): Coordinate {
  return [lon, lat];
}

function closeRing(points: Coordinate[]) {
  if (points.length === 0) return points;
  const first = points[0];
  const last = points[points.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return points;
  return [...points, first];
}

function circleRing(lat: number, lon: number, radiusKm: number): Coordinate[] {
  const coordinates: Coordinate[] = [];
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / Math.max(30, 111 * Math.cos(lat * Math.PI / 180));
  for (let angle = 0; angle <= 360; angle += 8) {
    const rad = angle * Math.PI / 180;
    coordinates.push([lon + Math.cos(rad) * lonDelta, lat + Math.sin(rad) * latDelta]);
  }
  return closeRing(coordinates);
}

function trackSeverity(track: Track, anomalies: Anomaly[]) {
  const related = anomalies.filter((anomaly) => anomaly.relatedTrackIds.includes(track.id));
  if (related.some((item) => item.severity === 'warning')) return 'warning';
  if (related.some((item) => item.severity === 'watch')) return 'watch';
  return 'normal';
}

function lineFeature(id: string, coordinates: Coordinate[], properties: Properties): Feature | null {
  if (coordinates.length < 2) return null;
  return { type: 'Feature', id, properties, geometry: { type: 'LineString', coordinates } };
}

function pointFeature(id: string, lat: number, lon: number, properties: Properties): Feature {
  return { type: 'Feature', id, properties, geometry: { type: 'Point', coordinates: lonLat(lat, lon) } };
}

function overlayCollections(props: SituationRealGlobeProps): OverlayCollections {
  // Viewport-driven global globe: no fixed-AOI box, region label, or preset-switch markers.
  const polygons: Feature[] = [];
  const lines: Feature[] = [];
  const points: Feature[] = [];
  const labels: Feature[] = [];

  for (const zone of props.zones) {
    polygons.push({
      type: 'Feature',
      id: zone.id,
      properties: { kind: 'zone', title: zone.name, severity: zone.severity },
      geometry: { type: 'Polygon', coordinates: [closeRing(zone.polygon.map(([lat, lon]) => lonLat(lat, lon)))] },
    });
  }

  for (const notice of props.notices) {
    polygons.push({
      type: 'Feature',
      id: notice.id,
      properties: { kind: 'notice', title: notice.title, severity: notice.severity },
      geometry: { type: 'Polygon', coordinates: [circleRing(notice.lat, notice.lon, notice.radiusKm)] },
    });
    points.push(pointFeature(`notice-point-${notice.id}`, notice.lat, notice.lon, { kind: 'notice', title: notice.title, severity: notice.severity }));
  }

  for (const referenceLine of props.referenceLines) {
    const feature = lineFeature(referenceLine.id, referenceLine.points.map(([lat, lon]) => lonLat(lat, lon)), {
      kind: 'reference',
      title: referenceLine.name,
      severity: 'info',
    });
    if (feature) lines.push(feature);
  }

  for (const route of props.airRoutes) {
    const feature = lineFeature(route.id, route.points.map(([lat, lon]) => lonLat(lat, lon)), {
      kind: 'route',
      title: route.name,
      severity: 'info',
    });
    if (feature) lines.push(feature);
  }

  for (const track of props.tracks) {
    if (!track.points.length) continue;
    const severity = trackSeverity(track, props.anomalies);
    const coordinates = track.points.map((point) => lonLat(point.lat, point.lon));
    const feature = lineFeature(track.id, coordinates, { kind: 'track', title: track.callsign.trim() || track.id, severity });
    if (feature) lines.push(feature);
    const last = track.points[track.points.length - 1];
    const title = track.callsign.trim() || track.id;
    points.push(pointFeature(`track-last-${track.id}`, last.lat, last.lon, {
      kind: 'track',
      title,
      severity,
      trackId: track.id,
      altitudeM: last.altitudeM,
      speedMs: last.velocityMs,
      heading: last.headingDeg,
      isMilitary: Boolean(track.isMilitary),
    }));
    labels.push(pointFeature(`track-label-${track.id}`, last.lat, last.lon, { kind: 'track-label', title, color: severity === 'warning' ? '#ff5d47' : severity === 'watch' ? '#ffb238' : '#7df9ff' }));
  }

  for (const ship of props.ships) {
    if (!ship.points.length) continue;
    const feature = lineFeature(ship.id, ship.points.map((point) => lonLat(point.lat, point.lon)), { kind: 'ship', title: ship.name, severity: 'info' });
    if (feature) lines.push(feature);
    const last = ship.points[ship.points.length - 1];
    points.push(pointFeature(`ship-last-${ship.id}`, last.lat, last.lon, {
      kind: 'ship',
      title: ship.name,
      severity: 'info',
      heading: last.courseDeg,
      shipId: ship.id,
    }));
    labels.push(pointFeature(`ship-label-${ship.id}`, last.lat, last.lon, { kind: 'ship-label', title: ship.name, color: '#67e8f9' }));
  }

  // Geolocated Telegram claims render as OSINT markers (orange). Clicking one opens a popup with
  // the verification-panel scoring (verdict · confidence · evidence) and a link to the source post.
  for (const claim of props.claims) {
    points.push(pointFeature(`claim-${claim.key}`, claim.lat, claim.lon, {
      kind: 'osint',
      reviewKind: 'osint-news',
      title: claim.place,
      source: `Telegram · ${claim.channel}`,
      severity: 'info',
      claimVerdict: claim.verdict,
      claimConfidence: claim.confidence,
      claimEvidence: claim.evidence,
      claimText: claim.text.slice(0, 240),
      channel: claim.channel,
      url: claim.url ?? null,
    }));
    labels.push(pointFeature(`claim-label-${claim.key}`, claim.lat, claim.lon, { kind: 'osint-label', title: claim.place, color: '#ff7a35' }));
  }

  // Explosion-like seismic events (EMSC, shallow ≤2km) — red markers with a magnitude label.
  for (const eq of props.seismic) {
    const mag = eq.mag != null ? `M${eq.mag}` : 'M?';
    const depth = eq.depthKm != null ? ` · ${eq.depthKm.toFixed(0)}km` : '';
    points.push(pointFeature(`seismic-${eq.id}`, eq.lat, eq.lon, {
      kind: 'seismic',
      title: `${mag}${depth}${eq.region ? ` · ${eq.region}` : ''}`.slice(0, 60),
      severity: 'info',
      color: '#ff3355',
    }));
    labels.push(pointFeature(`seismic-label-${eq.id}`, eq.lat, eq.lon, { kind: 'seismic-label', title: mag, color: '#ff3355' }));
  }

  // Ukrainian air-raid alerts (@air_alert_ua) — active-alert oblasts as red markers. Distinct
  // from strike-claims (imminent-threat alerts, not verified results).
  for (const alert of props.airAlerts) {
    points.push(pointFeature(`airalert-${alert.key}`, alert.lat, alert.lon, {
      kind: 'airalert',
      title: `${alert.oblast} 공습경보`,
      source: 'air_alert_ua',
      severity: 'warning',
      color: '#ff2d55',
    }));
    labels.push(pointFeature(`airalert-label-${alert.key}`, alert.lat, alert.lon, { kind: 'airalert-label', title: alert.oblast, color: '#ff6688' }));
  }

  for (const airport of props.airports) {
    points.push(pointFeature(airport.id, airport.lat, airport.lon, { kind: 'airport', title: airport.ident, severity: 'info' }));
    labels.push(pointFeature(`airport-label-${airport.id}`, airport.lat, airport.lon, { kind: 'airport-label', title: airport.ident, color: '#c4b5fd' }));
  }

  for (const context of props.airspaceContexts) {
    points.push(pointFeature(context.id, context.lat, context.lon, { kind: 'airspace', title: context.icaoCode, severity: 'info' }));
    labels.push(pointFeature(`airspace-label-${context.id}`, context.lat, context.lon, { kind: 'airspace-label', title: context.icaoCode, color: '#f1b84b' }));
  }

  for (const event of props.osintEvents) {
    const reviewKind = event.source === 'nasa-firms-match' || event.tags.includes('nasa-firms-match')
      ? 'nasa-firms'
      : event.source === 'osint-cluster-review' || event.tags.includes('osint-cluster-review') || event.tags.includes('osint-cluster')
        ? 'osint-cluster'
        : event.source === 'claim-review-cache' && event.tags.includes('claim-track-match')
          ? 'claim-track'
          : 'osint-news';

    const labelColor = reviewKind === 'nasa-firms'
      ? '#ff8a50'
      : reviewKind === 'osint-cluster'
        ? '#7dd3fc'
        : reviewKind === 'claim-track'
          ? '#38f6ff'
          : '#ff7a35';

    points.push(pointFeature(event.id, event.lat, event.lon, {
      kind: 'osint',
      title: event.title,
      reviewKind,
      source: event.domain ?? event.source,
      severity: 'watch',
      confidence: event.confidence,
      url: event.url ?? null,
      positionNote: event.tags.includes('not-geocoded') ? '검토 포인트 · 정확 좌표 아님' : null,
    }));
    labels.push(pointFeature(`osint-label-${event.id}`, event.lat, event.lon, {
      kind: 'osint-label',
      title: reviewKind === 'nasa-firms' ? 'FIRMS' : reviewKind === 'osint-cluster' ? 'CLUSTER' : reviewKind === 'claim-track' ? 'TRACK' : 'OSINT',
      color: labelColor,
    }));
  }

  for (const satellite of props.satellites) {
    if (satellite.groundTrack && satellite.groundTrack.length > 1) {
      const feature = lineFeature(`sat-track-${satellite.id}`, satellite.groundTrack.map(([lat, lon]) => lonLat(lat, lon)), {
        kind: 'satellite-track',
        title: satellite.name,
        severity: 'info',
      });
      if (feature) lines.push(feature);
    }
    points.push(pointFeature(satellite.id, satellite.lat, satellite.lon, { kind: 'satellite', title: satellite.name, severity: 'info', altitudeKm: satellite.altitudeKm }));
  }

  return {
    polygons: { type: 'FeatureCollection', features: polygons },
    lines: { type: 'FeatureCollection', features: lines },
    points: { type: 'FeatureCollection', features: points },
    labels: { type: 'FeatureCollection', features: labels },
  };
}

const VERDICT_KO: Record<string, string> = { TRUE: '확인', LIKELY: '가능성', 'NOT LIKELY': '미확인', FALSE: '허위' };

// Rich popup for a geolocated Telegram claim — mirrors the Claim Verification panel row: verdict
// badge + confidence + evidence + a link to the original Telegram post.
function claimPopupHtml(properties: Properties): string {
  const place = escapeHtml(String(properties.title ?? '주장'));
  const channel = escapeHtml(String(properties.channel ?? ''));
  const verdict = String(properties.claimVerdict);
  const color = VERDICT_COLOR[verdict as keyof typeof VERDICT_COLOR] ?? '#8aa';
  const label = VERDICT_KO[verdict] ?? verdict;
  const conf = typeof properties.claimConfidence === 'number' ? Math.round(properties.claimConfidence) : null;
  const evidence = properties.claimEvidence ? escapeHtml(String(properties.claimEvidence)) : '';
  const text = properties.claimText ? escapeHtml(String(properties.claimText)) : '';
  const safeUrl = typeof properties.url === 'string' ? safeExternalUrl(properties.url) : null;
  return `
    <div class="maplibre-hud-popup maplibre-hud-popup--claim">
      <div class="claim-popup__head">
        <span class="claim-popup__badge" style="color:${color};border-color:${color}88;background:${color}22">${escapeHtml(label)}${conf != null ? ` ${conf}%` : ''}</span>
        <strong>${place}</strong>
      </div>
      <span class="claim-popup__channel">텔레그램 · ${channel}</span>
      ${text ? `<p class="claim-popup__text">${text}</p>` : ''}
      ${evidence ? `<span class="claim-popup__evidence">근거 · ${evidence}</span>` : ''}
      ${safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">원문 텔레그램 열기 ↗</a>` : '<span class="claim-popup__nolink">원문 링크 없음</span>'}
      <span class="claim-popup__safe">공개 텔레그램 × NASA FIRMS 열적 × 교차출처 · 비표적화</span>
    </div>
  `;
}

function popupHtml(properties: Properties) {
  if (typeof properties.claimVerdict === 'string') return claimPopupHtml(properties);
  const title = escapeHtml(String(properties.title ?? 'OSINT'));
  const kind = escapeHtml(String(properties.kind ?? 'point'));
  const source = properties.source ? escapeHtml(String(properties.source)) : null;
  const positionNote = properties.positionNote ? escapeHtml(String(properties.positionNote)) : null;
  const confidence = typeof properties.confidence === 'number'
    ? `${Math.round(properties.confidence * 100)}%`
    : null;
  const safeUrl = typeof properties.url === 'string' ? safeExternalUrl(properties.url) : null;
  return `
    <div class="maplibre-hud-popup">
    <strong>${title}</strong>
    <span>${kind}${properties.reviewKind ? ` · ${escapeHtml(String(properties.reviewKind))}` : ''}${source ? ` · ${source}` : ''}${confidence ? ` · 신뢰도 ${confidence}` : ''}</span>
      ${positionNote ? `<span>${positionNote}</span>` : ''}
      ${safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">공개 출처 열기</a>` : ''}
    </div>
  `;
}

type PopupCallbacks = Pick<SituationRealGlobeProps, 'onRegionSelect' | 'onSelectTrack' | 'onSelectShip'>;

function bindPointPopup(map: MapLibreMap, getCallbacks: () => PopupCallbacks) {
  const selectRegionFromProperties = (properties: Properties) => {
    if ((properties.kind === 'region-switch' || properties.kind === 'region-switch-label') && typeof properties.targetRegionId === 'string') {
      getCallbacks().onRegionSelect?.(properties.targetRegionId as RegionId);
      return true;
    }
    return false;
  };

  const interactiveFeaturesAt = (point: MapMouseEvent['point']) => map
    .queryRenderedFeatures([[point.x - 12, point.y - 12], [point.x + 12, point.y + 12]], { layers: ['airmaven-points', 'airmaven-labels'] });

  const interactiveFeatureAt = (point: MapMouseEvent['point']) => interactiveFeaturesAt(point)
    .find((feature) => {
      const kind = feature.properties?.kind;
      return kind === 'region-switch' || kind === 'region-switch-label' || feature.layer.id === 'airmaven-points';
    });

  map.on('click', (event: MapMouseEvent) => {
    const features = interactiveFeaturesAt(event.point);
    const regionFeature = features.find((feature) => {
      const kind = feature.properties?.kind;
      return kind === 'region-switch' || kind === 'region-switch-label';
    });
    if (regionFeature?.properties && selectRegionFromProperties(regionFeature.properties as Properties)) return;

    const feature = features.find((item) => item.layer.id === 'airmaven-points');
    if (!feature?.properties) return;
    const properties = feature.properties as Properties;
    // Tracks and ships select into the parent so a map click gives the same rich focus
    // popup + fly-to as choosing them from the side panel (not a basic map-only popup).
    const cbs = getCallbacks();
    if (properties.kind === 'track' && typeof properties.trackId === 'string') { cbs.onSelectTrack?.(properties.trackId); return; }
    if (properties.kind === 'ship' && typeof properties.shipId === 'string') { cbs.onSelectShip?.(properties.shipId); return; }
    const coordinates = feature.geometry.type === 'Point'
      ? feature.geometry.coordinates as [number, number]
      : event.lngLat.toArray() as [number, number];
    new maplibregl.Popup({
      closeButton: true,
      closeOnClick: true,
      className: 'maplibre-hud-popup-shell',
    })
      .setLngLat(coordinates)
      .setHTML(popupHtml(properties))
      .addTo(map);
  });

  map.on('mousemove', (event: MapMouseEvent) => {
    map.getCanvas().style.cursor = interactiveFeatureAt(event.point) ? 'pointer' : '';
  });
}

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] };
}

function createAircraftIcon(size = 44): ImageData | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  const c = size / 2;
  // top-view airplane silhouette, nose pointing up (north) so icon-rotate=heading aligns
  ctx.beginPath();
  ctx.moveTo(c, size * 0.08);
  ctx.lineTo(c + size * 0.06, size * 0.40);
  ctx.lineTo(size * 0.94, size * 0.60);
  ctx.lineTo(c + size * 0.06, size * 0.62);
  ctx.lineTo(c + size * 0.05, size * 0.80);
  ctx.lineTo(c + size * 0.17, size * 0.93);
  ctx.lineTo(c, size * 0.85);
  ctx.lineTo(c - size * 0.17, size * 0.93);
  ctx.lineTo(c - size * 0.05, size * 0.80);
  ctx.lineTo(c - size * 0.06, size * 0.62);
  ctx.lineTo(size * 0.06, size * 0.60);
  ctx.lineTo(c - size * 0.06, size * 0.40);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function ensureAircraftIcon(map: MapLibreMap) {
  if (map.hasImage('airmaven-aircraft')) return;
  const icon = createAircraftIcon();
  if (!icon) return;
  try {
    map.addImage('airmaven-aircraft', icon, { sdf: true });
  } catch {
    // image already registered by a concurrent call; safe to ignore
  }
}

function createShipIcon(size = 44): ImageData | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#ffffff';
  const c = size / 2;
  // boat hull, bow pointing up (north) so icon-rotate=course aligns
  ctx.beginPath();
  ctx.moveTo(c, size * 0.12);
  ctx.lineTo(c + size * 0.19, size * 0.44);
  ctx.lineTo(c + size * 0.19, size * 0.84);
  ctx.lineTo(c - size * 0.19, size * 0.84);
  ctx.lineTo(c - size * 0.19, size * 0.44);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

function ensureShipIcon(map: MapLibreMap) {
  if (map.hasImage('airmaven-ship')) return;
  const icon = createShipIcon();
  if (!icon) return;
  try {
    map.addImage('airmaven-ship', icon, { sdf: true });
  } catch {
    // image already registered by a concurrent call; safe to ignore
  }
}

function setOrAddGeoJsonSource(map: MapLibreMap, id: string, data: FeatureCollection) {
  const existing = map.getSource(id) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
    return;
  }
  map.addSource(id, { type: 'geojson', data });
}

// OpenAIP airspace vector tiles (proxied same-origin via /api/openaip to hide the key).
// Rendered beneath the track/point layers so aircraft stay on top. Coloured by OpenAIP
// classification: the tiles carry `type` and `icao_class` as lowercase STRINGS (matching
// OpenAIP's own map style — e.g. 'prohibited', 'restricted', 'adiz', 'ctr', class 'a'..'g'),
// NOT integers. Special-use zones (prohibited/restricted/danger/military/ADIZ) are
// emphasised; controlled airspace falls back to an icao_class colour ramp. Keep this
// palette in sync with the HUD legend in App.tsx (AIRSPACE_LEGEND).
function ensureAirspaceLayers(map: MapLibreMap, visible: boolean) {
  if (!map.getSource('openaip')) {
    map.addSource('openaip', {
      type: 'vector',
      tiles: [`${window.location.origin}/api/openaip/{z}/{x}/{y}`],
      minzoom: 2,
      maxzoom: 11,
    });
  }
  const classColor: maplibregl.ExpressionSpecification = [
    'match', ['get', 'icao_class'],
    ['a', 'b'], '#5fd08a',
    ['c', 'd'], '#5cc8ff',
    'e', '#8ab4ff',
    'f', '#9aa8c7',
    'g', '#7c8aa5',
    '#6f7d94',
  ];
  const airspaceColor: maplibregl.ExpressionSpecification = [
    'match', ['get', 'type'],
    'prohibited', '#ff2d55',
    ['restricted', 'danger'], '#ff8a3d',
    ['tsa', 'tra', 'tfr', 'tfa'], '#ffb238',
    'adiz', '#e15dff',
    ['mtr', 'mta', 'mrt', 'matz'], '#ff7a6b',
    ['alert', 'warning', 'protected'], '#ffe14a',
    'ctr', '#5cc8ff',
    ['tma', 'cta'], '#7dd3fc',
    ['tmz', 'rmz', 'tiz', 'tia', 'trp'], '#8ab4ff',
    ['fir', 'uir', 'acc_sector', 'fis_sector'], '#6b8fb5',
    'awy', '#67e8f9',
    ['gliding_sector', 'vfr_sector', 'aerial_sporting_recreational', 'lta', 'uta', 'overflight_restriction', 'htz', 'atz'], '#8fce9e',
    classColor,
  ];
  const visibility = visible ? 'visible' : 'none';
  // Only render airspace once zoomed into a detail view — at low zoom the tiles are huge
  // (whole continents) and airspace is too dense to read, so we skip them for performance.
  const AIRSPACE_MIN_ZOOM = 5;
  if (!map.getLayer('openaip-airspace-fill')) {
    map.addLayer({
      id: 'openaip-airspace-fill',
      type: 'fill',
      source: 'openaip',
      'source-layer': 'airspaces',
      minzoom: AIRSPACE_MIN_ZOOM,
      layout: { visibility },
      paint: { 'fill-color': airspaceColor, 'fill-opacity': 0.15 },
    });
  }
  if (!map.getLayer('openaip-airspace-line')) {
    map.addLayer({
      id: 'openaip-airspace-line',
      type: 'line',
      source: 'openaip',
      'source-layer': 'airspaces',
      minzoom: AIRSPACE_MIN_ZOOM,
      layout: { visibility, 'line-join': 'round' },
      paint: { 'line-color': airspaceColor, 'line-width': 1.2, 'line-opacity': 0.75 },
    });
  }

  // Supplementary South Korean airspace (KADIZ, P-73) from the ROK AIP — OpenAIP carries no
  // country=KR polygons. Static GeoJSON in public/data; coloured by the same `type` palette.
  // No minzoom: KADIZ is a large boundary that should read even when zoomed out.
  if (!map.getSource('kr-airspace')) {
    map.addSource('kr-airspace', { type: 'geojson', data: `${window.location.origin}/data/kr-airspace.json` });
  }
  if (!map.getLayer('kr-airspace-fill')) {
    map.addLayer({
      id: 'kr-airspace-fill',
      type: 'fill',
      source: 'kr-airspace',
      layout: { visibility },
      paint: { 'fill-color': airspaceColor, 'fill-opacity': 0.14 },
    });
  }
  if (!map.getLayer('kr-airspace-line')) {
    map.addLayer({
      id: 'kr-airspace-line',
      type: 'line',
      source: 'kr-airspace',
      layout: { visibility, 'line-join': 'round' },
      paint: { 'line-color': airspaceColor, 'line-width': 1.4, 'line-opacity': 0.85 },
    });
  }
}

function setAirspaceVisibility(map: MapLibreMap, visible: boolean) {
  const visibility = visible ? 'visible' : 'none';
  for (const id of ['openaip-airspace-fill', 'openaip-airspace-line', 'kr-airspace-fill', 'kr-airspace-line']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
  }
}

// South Korean enroute airways (ROK AIP ENR, 국토교통부 항공교통본부 via data.go.kr). The odcloud
// dataset lists airway segments by named fixes only; fixes were resolved to coordinates offline
// into static GeoJSON (public/data/kr-airways.json, one MultiLineString per airway). Dashed violet
// lines distinguish route structure from solid airspace boundaries; labelled with the airway name.
function ensureAirwayLayers(map: MapLibreMap, visible: boolean) {
  const visibility = visible ? 'visible' : 'none';
  const AIRWAY_MIN_ZOOM = 4;
  if (!map.getSource('kr-airways')) {
    map.addSource('kr-airways', { type: 'geojson', data: `${window.location.origin}/data/kr-airways.json` });
  }
  if (!map.getLayer('kr-airway-line')) {
    map.addLayer({
      id: 'kr-airway-line',
      type: 'line',
      source: 'kr-airways',
      minzoom: AIRWAY_MIN_ZOOM,
      layout: { visibility, 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#c084fc', 'line-width': 1.1, 'line-opacity': 0.7, 'line-dasharray': [2, 2] },
    });
  }
  if (!map.getLayer('kr-airway-label')) {
    map.addLayer({
      id: 'kr-airway-label',
      type: 'symbol',
      source: 'kr-airways',
      minzoom: 6,
      layout: {
        visibility,
        'symbol-placement': 'line',
        'text-field': ['get', 'airway'],
        'text-size': 10,
        'text-letter-spacing': 0.05,
        'symbol-spacing': 220,
      },
      paint: { 'text-color': '#d8b4fe', 'text-halo-color': '#0a0e14', 'text-halo-width': 1.4 },
    });
  }
}

function setAirwayVisibility(map: MapLibreMap, visible: boolean) {
  const visibility = visible ? 'visible' : 'none';
  for (const id of ['kr-airway-line', 'kr-airway-label']) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visibility);
  }
}

function ensureOverlayLayers(map: MapLibreMap, collections: OverlayCollections) {
  setOrAddGeoJsonSource(map, 'airmaven-polygons', collections.polygons);
  setOrAddGeoJsonSource(map, 'airmaven-lines', collections.lines);
  setOrAddGeoJsonSource(map, 'airmaven-points', collections.points);
  setOrAddGeoJsonSource(map, 'airmaven-labels', collections.labels);

  if (!map.getLayer('airmaven-aoi-fill')) {
    map.addLayer({
      id: 'airmaven-aoi-fill',
      type: 'fill',
      source: 'airmaven-polygons',
      paint: {
        'fill-color': [
          'match', ['get', 'severity'],
          'warning', '#ff5d47',
          'watch', '#ffb238',
          '#38bdf8',
        ],
        'fill-opacity': [
          'match', ['get', 'kind'],
          'aoi', 0.12,
          'global-aoi', 0.025,
          'notice', 0.08,
          'zone', 0.14,
          0.08,
        ],
      },
    });
  }

  if (!map.getLayer('airmaven-aoi-line')) {
    map.addLayer({
      id: 'airmaven-aoi-line',
      type: 'line',
      source: 'airmaven-polygons',
      paint: {
        'line-color': [
          'match', ['get', 'severity'],
          'warning', '#ff5d47',
          'watch', '#ffb238',
          '#7df9ff',
        ],
        'line-width': ['match', ['get', 'kind'], 'aoi', 2.4, 'global-aoi', 1.2, 1.4],
        'line-opacity': 0.82,
        'line-dasharray': ['match', ['get', 'kind'], 'aoi', ['literal', [2, 1]], 'global-aoi', ['literal', [1, 3]], ['literal', [1, 1]]],
      },
    });
  }

  if (!map.getLayer('airmaven-lines')) {
    map.addLayer({
      id: 'airmaven-lines',
      type: 'line',
      source: 'airmaven-lines',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'kind'],
          'track', ['match', ['get', 'severity'], 'warning', '#ff5d47', 'watch', '#ffb238', '#7df9ff'],
          'ship', '#22d3ee',
          'route', '#f1b84b',
          'reference', '#c4b5fd',
          'satellite-track', '#bda9ff',
          '#7df9ff',
        ],
        'line-width': ['match', ['get', 'kind'], 'track', 3.3, 'ship', 2.2, 'reference', 2.4, 1.7],
        'line-opacity': ['match', ['get', 'kind'], 'satellite-track', 0.62, 0.88],
      },
    });
  }

  if (!map.getLayer('airmaven-points-halo')) {
    map.addLayer({
      id: 'airmaven-points-halo',
      type: 'circle',
      source: 'airmaven-points',
      paint: {
        'circle-radius': ['match', ['get', 'kind'], 'region-switch', 16, 'track', 12, 'osint', 13, 'satellite', 12, 'claim', 12, 'seismic', 12, 'airalert', 14, 9],
        'circle-color': [
          'match', ['get', 'kind'],
          'region-switch', '#7dffcf',
          'track', ['match', ['get', 'severity'], 'warning', '#ff5d47', 'watch', '#ffb238', '#7df9ff'],
          'osint', [
            'match', ['coalesce', ['get', 'reviewKind'], 'osint-news'],
            'nasa-firms', '#ff8a50',
            'osint-cluster', '#7dd3fc',
            'claim-track', '#38f6ff',
            '#ff7a35',
          ],
          'airport', '#c4b5fd',
          'airspace', '#f1b84b',
          'satellite', '#bda9ff',
          'ship', '#67e8f9',
          'claim', ['coalesce', ['get', 'color'], '#22ccbb'],
          'seismic', ['coalesce', ['get', 'color'], '#ff3355'],
          'airalert', ['coalesce', ['get', 'color'], '#ff2d55'],
          '#7df9ff',
        ],
        'circle-opacity': 0.14,
        'circle-blur': 0.7,
      },
    });
  }

  if (!map.getLayer('airmaven-points')) {
    map.addLayer({
      id: 'airmaven-points',
      type: 'circle',
      source: 'airmaven-points',
      paint: {
        'circle-radius': ['match', ['get', 'kind'], 'region-switch', 6.8, 'track', 5.4, 'osint', 5.8, 'satellite', 5.3, 'claim', 5.4, 'airalert', 6.6, 4.2],
        'circle-color': [
          'match', ['get', 'kind'],
          'region-switch', '#7dffcf',
          'track', ['match', ['get', 'severity'], 'warning', '#ff5d47', 'watch', '#ffb238', '#7df9ff'],
          'osint', [
            'match', ['coalesce', ['get', 'reviewKind'], 'osint-news'],
            'nasa-firms', '#ff8a50',
            'osint-cluster', '#7dd3fc',
            'claim-track', '#38f6ff',
            '#ff7a35',
          ],
          'airport', '#c4b5fd',
          'airspace', '#f1b84b',
          'satellite', '#bda9ff',
          'ship', '#67e8f9',
          'claim', ['coalesce', ['get', 'color'], '#22ccbb'],
          'seismic', ['coalesce', ['get', 'color'], '#ff3355'],
          'airalert', ['coalesce', ['get', 'color'], '#ff2d55'],
          '#7df9ff',
        ],
        'circle-stroke-width': ['match', ['get', 'kind'], 'region-switch', 2.2, 1.2],
        'circle-stroke-color': '#020403',
        'circle-opacity': ['match', ['get', 'kind'], 'track', 0.28, 'ship', 0.5, 0.95],
      },
    });
  }

  ensureAircraftIcon(map);
  if (map.hasImage('airmaven-aircraft') && !map.getLayer('airmaven-aircraft-symbols')) {
    map.addLayer({
      id: 'airmaven-aircraft-symbols',
      type: 'symbol',
      source: 'airmaven-points',
      filter: ['==', ['get', 'kind'], 'track'],
      layout: {
        'icon-image': 'airmaven-aircraft',
        'icon-size': ['case', ['coalesce', ['get', 'isMilitary'], false], 0.66, 0.52],
        'icon-rotate': ['coalesce', ['get', 'heading'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': [
          'case', ['coalesce', ['get', 'isMilitary'], false], '#ff5d47',
          ['match', ['get', 'severity'], 'warning', '#ff5d47', 'watch', '#ffb238', '#7df9ff'],
        ],
        'icon-halo-color': '#020403',
        'icon-halo-width': 1.1,
      },
    });
  }

  ensureShipIcon(map);
  if (map.hasImage('airmaven-ship') && !map.getLayer('airmaven-ship-symbols')) {
    map.addLayer({
      id: 'airmaven-ship-symbols',
      type: 'symbol',
      source: 'airmaven-points',
      filter: ['==', ['get', 'kind'], 'ship'],
      layout: {
        'icon-image': 'airmaven-ship',
        'icon-size': 0.5,
        'icon-rotate': ['coalesce', ['get', 'heading'], 0],
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
      paint: {
        'icon-color': '#67e8f9',
        'icon-halo-color': '#020403',
        'icon-halo-width': 1.1,
      },
    });
  }

  if (!map.getLayer('airmaven-labels')) {
    map.addLayer({
      id: 'airmaven-labels',
      type: 'symbol',
      source: 'airmaven-labels',
      layout: {
        'text-field': ['get', 'title'],
        'text-font': ['Noto Sans Regular'],
        'text-size': ['match', ['get', 'kind'], 'region', 16, 'region-switch-label', 12, 11],
        'text-offset': ['match', ['get', 'kind'], 'region', ['literal', [0, -1.35]], 'region-switch-label', ['literal', [0, -1.45]], ['literal', [0, -1.15]]],
        'text-anchor': 'bottom',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': ['coalesce', ['get', 'color'], '#7df9ff'],
        'text-halo-color': 'rgba(0, 0, 0, 0.86)',
        'text-halo-width': 1.4,
      },
    });
  }
}

function updateSources(map: MapLibreMap, collections: OverlayCollections) {
  for (const id of sourceIds) {
    const source = map.getSource(id) as GeoJSONSource | undefined;
    if (!source) continue;
    source.setData(collections[id.replace('airmaven-', '') as keyof OverlayCollections] ?? emptyCollection());
  }
}

function realGlobeStyle(): string | StyleSpecification {
  return openFreeMapDarkStyle;
}

export function SituationRealGlobe(props: SituationRealGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const isLoadedRef = useRef(false);
  const focusPopupRef = useRef<maplibregl.Popup | null>(null);
  const focusedIdRef = useRef<string | null>(null);
  const collections = useMemo(() => overlayCollections(props), [props]);
  const latestRef = useRef<{ collections: OverlayCollections; region: Region; onRegionSelect?: (regionId: RegionId) => void; onSelectTrack?: (trackId: string) => void; onSelectShip?: (shipId: string) => void; onViewportChange?: SituationRealGlobeProps['onViewportChange']; showAirspace?: boolean; showAirways?: boolean }>({
    collections,
    region: props.region,
    onRegionSelect: props.onRegionSelect,
    onSelectTrack: props.onSelectTrack,
    onSelectShip: props.onSelectShip,
    onViewportChange: props.onViewportChange,
    showAirspace: props.showAirspace,
    showAirways: props.showAirways,
  });

  useEffect(() => {
    latestRef.current = { collections, region: props.region, onRegionSelect: props.onRegionSelect, onSelectTrack: props.onSelectTrack, onSelectShip: props.onSelectShip, onViewportChange: props.onViewportChange, showAirspace: props.showAirspace, showAirways: props.showAirways };
  }, [collections, props.onRegionSelect, props.onSelectTrack, props.onSelectShip, props.onViewportChange, props.region, props.showAirspace, props.showAirways]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return undefined;
    const initial = latestRef.current;

    const map = new maplibregl.Map({
      container,
      style: realGlobeStyle(),
      center: [initial.region.center[1], initial.region.center[0]],
      zoom: Math.max(1.1, Math.min(4.2, initial.region.zoom - 4.1)),
      pitch: 0,
      bearing: -8,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    if (isViteDevRuntime() && typeof window !== 'undefined') {
      window.__airmavenMap = map;
    }

    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');
    map.addControl(new maplibregl.GlobeControl(), 'top-left');

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' });
      map.setSky({
        'sky-color': '#020403',
        'horizon-color': '#031817',
        'fog-color': '#020403',
        'fog-ground-blend': 0.5,
      });
      isLoadedRef.current = true;
      const latest = latestRef.current;
      ensureAirspaceLayers(map, Boolean(latest.showAirspace));
      ensureAirwayLayers(map, Boolean(latest.showAirways));
      ensureOverlayLayers(map, latest.collections);
      bindPointPopup(map, () => latestRef.current);
      map.on('moveend', () => {
        const onViewport = latestRef.current.onViewportChange;
        if (!onViewport) return;
        const bounds = map.getBounds();
        const center = map.getCenter();
        onViewport({
          bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()],
          zoom: map.getZoom(),
          center: [center.lat, center.lng],
        });
      });
      map.flyTo({
        center: [latest.region.center[1], latest.region.center[0]],
        zoom: Math.max(1.1, Math.min(4.2, latest.region.zoom - 4.1)),
        bearing: -8,
        duration: 0,
      });
    });

    return () => {
      isLoadedRef.current = false;
      if (isViteDevRuntime() && typeof window !== 'undefined' && window.__airmavenMap === map) {
        delete window.__airmavenMap;
      }
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Refresh overlay data on the map without moving the camera — the user drives pan/zoom.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoadedRef.current) return;
    ensureOverlayLayers(map, collections);
    updateSources(map, collections);
  }, [collections]);

  // Selecting a track/ship (from the panel OR a map click) opens a popup with fusion context.
  // Fly-to happens ONLY when the selection id changes — on the periodic data refresh we just
  // move/refresh the existing popup in place, so the camera never snaps back and the user can
  // freely pan/zoom the globe while a popup is open.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoadedRef.current) return;
    const focus = props.focusTrack;
    if (!focus) {
      if (focusPopupRef.current) { focusPopupRef.current.remove(); focusPopupRef.current = null; }
      focusedIdRef.current = null;
      return;
    }
    if (focus.id !== focusedIdRef.current) {
      focusedIdRef.current = focus.id;
      map.flyTo({ center: [focus.lon, focus.lat], zoom: Math.max(map.getZoom(), 8.5), duration: 900, essential: true });
    }
    if (focusPopupRef.current) {
      focusPopupRef.current.setLngLat([focus.lon, focus.lat]).setHTML(focus.html);
    } else {
      const popup = new maplibregl.Popup({ closeButton: true, closeOnClick: false, maxWidth: '340px', className: 'globe-track-popup' })
        .setLngLat([focus.lon, focus.lat])
        .setHTML(focus.html)
        .addTo(map);
      // The user clicking × clears the selection in the parent (so it doesn't reopen on the
      // next refresh). Only the focus=null branch above ever removes the popup programmatically.
      popup.on('close', () => props.onFocusClose?.());
      focusPopupRef.current = popup;
    }
  }, [props.focusTrack, props.onFocusClose]);

  // Toggle OpenAIP airspace layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoadedRef.current) return;
    setAirspaceVisibility(map, Boolean(props.showAirspace));
  }, [props.showAirspace]);

  // Toggle ROK enroute airway layers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoadedRef.current) return;
    setAirwayVisibility(map, Boolean(props.showAirways));
  }, [props.showAirways]);

  return (
    <div className="situation-map-shell situation-map-shell--real-globe situation-real-globe-shell" role="img" aria-label={`${props.region.shortName} 실제 지도 3D 지구본`}>
      <div ref={containerRef} className="situation-real-globe-map" />
      <MapRegionSwitcher
        regions={props.selectableRegions ?? []}
        currentRegionId={props.region.id}
        onRegionSelect={props.onRegionSelect}
      />
      {props.referenceLines.length > 0 && (
        <div className="map-reference-note">
          <strong>출처 기반 참고 오버레이</strong>
          <span>{props.referenceLines.map((line) => line.name).join(', ')}</span>
        </div>
      )}
    </div>
  );
}
