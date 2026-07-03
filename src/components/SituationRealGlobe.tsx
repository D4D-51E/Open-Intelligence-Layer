import 'maplibre-gl/dist/maplibre-gl.css';
import maplibregl, { type GeoJSONSource, type Map as MapLibreMap, type MapMouseEvent, type StyleSpecification } from 'maplibre-gl';
import { useEffect, useMemo, useRef } from 'react';
import type { AirportContext, AirRoute, AirspaceContext, AirspaceNotice, Anomaly, OsintMapEvent, ReferenceLine, Region, RegionId, SatellitePass, ShipTrack, Track, WatchZone } from '../lib/types';
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
  anomalies: Anomaly[];
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

function bboxFeature(region: Region): Feature {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return {
    type: 'Feature',
    id: `bbox-${region.id}`,
    properties: { kind: region.id === 'global' ? 'global-aoi' : 'aoi', title: `${region.shortName} AOI`, severity: 'info' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ]],
    },
  };
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
  const polygons: Feature[] = [bboxFeature(props.region)];
  const lines: Feature[] = [];
  const points: Feature[] = [];
  const labels: Feature[] = [pointFeature(`label-${props.region.id}`, props.region.center[0], props.region.center[1], {
    kind: 'region',
    title: props.region.shortName,
    color: '#7df9ff',
  })];

  for (const targetRegion of props.selectableRegions ?? []) {
    if (targetRegion.id === props.region.id) continue;
    points.push(pointFeature(`region-switch-${targetRegion.id}`, targetRegion.center[0], targetRegion.center[1], {
      kind: 'region-switch',
      title: `${targetRegion.shortName} 상세 지도`,
      targetRegionId: targetRegion.id,
      severity: 'info',
    }));
    labels.push(pointFeature(`region-switch-label-${targetRegion.id}`, targetRegion.center[0], targetRegion.center[1], {
      kind: 'region-switch-label',
      title: targetRegion.shortName,
      targetRegionId: targetRegion.id,
      color: '#7dffcf',
    }));
  }

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
      altitudeM: last.altitudeM,
      speedMs: last.velocityMs,
    }));
    labels.push(pointFeature(`track-label-${track.id}`, last.lat, last.lon, { kind: 'track-label', title, color: severity === 'warning' ? '#ff5d47' : severity === 'watch' ? '#ffb238' : '#7df9ff' }));
  }

  for (const ship of props.ships) {
    if (!ship.points.length) continue;
    const feature = lineFeature(ship.id, ship.points.map((point) => lonLat(point.lat, point.lon)), { kind: 'ship', title: ship.name, severity: 'info' });
    if (feature) lines.push(feature);
    const last = ship.points[ship.points.length - 1];
    points.push(pointFeature(`ship-last-${ship.id}`, last.lat, last.lon, { kind: 'ship', title: ship.name, severity: 'info' }));
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
    points.push(pointFeature(event.id, event.lat, event.lon, {
      kind: 'osint',
      title: event.title,
      source: event.domain ?? event.source,
      severity: 'watch',
      confidence: event.confidence,
      url: event.url ?? null,
      positionNote: event.tags.includes('not-geocoded') ? '검토 포인트 · 정확 좌표 아님' : null,
    }));
    labels.push(pointFeature(`osint-label-${event.id}`, event.lat, event.lon, {
      kind: 'osint-label',
      title: 'OSINT',
      color: '#ff7a35',
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

function popupHtml(properties: Properties) {
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
      <span>${kind}${source ? ` · ${source}` : ''}${confidence ? ` · 신뢰도 ${confidence}` : ''}</span>
      ${positionNote ? `<span>${positionNote}</span>` : ''}
      ${safeUrl ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer">공개 출처 열기</a>` : ''}
    </div>
  `;
}

function bindPointPopup(map: MapLibreMap, getRegionSelect: () => SituationRealGlobeProps['onRegionSelect']) {
  const selectRegionFromProperties = (properties: Properties) => {
    if ((properties.kind === 'region-switch' || properties.kind === 'region-switch-label') && typeof properties.targetRegionId === 'string') {
      getRegionSelect()?.(properties.targetRegionId as RegionId);
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

function setOrAddGeoJsonSource(map: MapLibreMap, id: string, data: FeatureCollection) {
  const existing = map.getSource(id) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
    return;
  }
  map.addSource(id, { type: 'geojson', data });
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
        'circle-radius': ['match', ['get', 'kind'], 'region-switch', 16, 'track', 12, 'osint', 13, 'satellite', 12, 9],
        'circle-color': [
          'match', ['get', 'kind'],
          'region-switch', '#7dffcf',
          'track', ['match', ['get', 'severity'], 'warning', '#ff5d47', 'watch', '#ffb238', '#7df9ff'],
          'osint', '#ff7a35',
          'airport', '#c4b5fd',
          'airspace', '#f1b84b',
          'satellite', '#bda9ff',
          'ship', '#67e8f9',
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
        'circle-radius': ['match', ['get', 'kind'], 'region-switch', 6.8, 'track', 5.4, 'osint', 5.8, 'satellite', 5.3, 4.2],
        'circle-color': [
          'match', ['get', 'kind'],
          'region-switch', '#7dffcf',
          'track', ['match', ['get', 'severity'], 'warning', '#ff5d47', 'watch', '#ffb238', '#7df9ff'],
          'osint', '#ff7a35',
          'airport', '#c4b5fd',
          'airspace', '#f1b84b',
          'satellite', '#bda9ff',
          'ship', '#67e8f9',
          '#7df9ff',
        ],
        'circle-stroke-width': ['match', ['get', 'kind'], 'region-switch', 2.2, 1.2],
        'circle-stroke-color': '#020403',
        'circle-opacity': 0.95,
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
  const collections = useMemo(() => overlayCollections(props), [props]);
  const latestRef = useRef<{ collections: OverlayCollections; region: Region; onRegionSelect?: (regionId: RegionId) => void }>({
    collections,
    region: props.region,
    onRegionSelect: props.onRegionSelect,
  });

  useEffect(() => {
    latestRef.current = { collections, region: props.region, onRegionSelect: props.onRegionSelect };
  }, [collections, props.onRegionSelect, props.region]);

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
      ensureOverlayLayers(map, latest.collections);
      bindPointPopup(map, () => latestRef.current.onRegionSelect);
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !isLoadedRef.current) return;
    ensureOverlayLayers(map, collections);
    updateSources(map, collections);
    map.easeTo({
      center: [props.region.center[1], props.region.center[0]],
      zoom: Math.max(1.1, Math.min(4.2, props.region.zoom - 4.1)),
      bearing: -8,
      duration: 900,
    });
  }, [collections, props.region.center, props.region.zoom]);

  return (
    <div className="situation-map-shell situation-map-shell--real-globe situation-real-globe-shell" role="img" aria-label={`${props.region.shortName} 실제 지도 3D 지구본`}>
      <div ref={containerRef} className="situation-real-globe-map" />
      <MapRegionSwitcher
        regions={props.selectableRegions ?? []}
        currentRegionId={props.region.id}
        onRegionSelect={props.onRegionSelect}
      />
      <div className="globe-readout globe-readout--left" aria-hidden="true">
        <strong>MAPLIBRE GLOBE</strong>
        <span>OSM VECTOR · LAT {props.region.center[0].toFixed(2)} · LON {props.region.center[1].toFixed(2)}</span>
      </div>
      <div className="globe-readout globe-readout--right" aria-hidden="true">
        <span>TRK {props.tracks.length}</span>
        <span>SHIP {props.ships.length}</span>
        <span>OSINT {props.osintEvents.length}</span>
        <span>SAT {props.satellites.length}</span>
      </div>
      {props.referenceLines.length > 0 && (
        <div className="map-reference-note">
          <strong>출처 기반 참고 오버레이</strong>
          <span>{props.referenceLines.map((line) => line.name).join(', ')}</span>
        </div>
      )}
    </div>
  );
}
