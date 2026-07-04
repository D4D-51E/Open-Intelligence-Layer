import { Circle, CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, Rectangle, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Fragment, useEffect } from 'react';
import type { AirportContext, AirRoute, AirspaceContext, AirspaceNotice, Anomaly, OsintMapEvent, ReferenceLine, Region, RegionId, SatellitePass, ShipTrack, Track, WatchZone } from '../lib/types';
import { platformTypeLabel, roleHintLabel, vesselTypeLabel } from '../lib/display';
import { SituationGlobe } from './SituationGlobe';
import { SituationRealGlobe } from './SituationRealGlobe';
import { MapRegionSwitcher } from './MapRegionSwitcher';

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const aircraftIcon = (callsign: string, severity: 'normal' | 'watch' | 'warning', headingDeg = 0, isMilitary = false) => {
  const color = isMilitary || severity === 'warning' ? '#ff5d47' : severity === 'watch' ? '#ffb238' : '#7df9ff';
  const plane = `<svg class="aircraft-glyph" width="24" height="24" viewBox="0 0 24 24" style="transform:rotate(${Math.round(headingDeg)}deg)" aria-hidden="true"><path d="M12 2 L12.9 9.6 L22 13.6 L12.9 13.6 L12.7 18.8 L15.6 21.4 L12 19.7 L8.4 21.4 L11.3 18.8 L11.1 13.6 L2 13.6 L11.1 9.6 Z" fill="${color}" stroke="#020403" stroke-width="0.7"/></svg>`;
  return L.divIcon({
    className: `aircraft-icon aircraft-icon--${severity}${isMilitary ? ' aircraft-icon--military' : ''}`,
    html: `${plane}<small>${escapeHtml(callsign)}</small>`,
    iconSize: [72, 42],
    iconAnchor: [36, 21],
  });
};

const satIcon = L.divIcon({
  className: 'satellite-icon',
  html: '<span>◈</span>',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

const shipIcon = (name: string) => L.divIcon({
  className: 'ship-icon',
  html: `<span>◆</span><small>${escapeHtml(name)}</small>`,
  iconSize: [82, 28],
  iconAnchor: [41, 14],
});

const airportIcon = (ident: string) => L.divIcon({
  className: 'airport-icon',
  html: `<span>⊕</span><small>${escapeHtml(ident)}</small>`,
  iconSize: [64, 28],
  iconAnchor: [32, 14],
});

const airspaceIcon = (code: string) => L.divIcon({
  className: 'airspace-icon',
  html: `<span>FIR</span><small>${escapeHtml(code)}</small>`,
  iconSize: [74, 28],
  iconAnchor: [37, 14],
});

const regionSwitchIcon = (region: Region, active: boolean) => L.divIcon({
  className: `region-switch-icon${active ? ' region-switch-icon--active' : ''}`,
  html: `<span>${active ? '◆' : '◇'}</span><small>${escapeHtml(region.shortName)}</small>`,
  iconSize: [118, 30],
  iconAnchor: [59, 15],
});

function FitRegion({ region }: { region: Region }) {
  const map = useMap();
  useEffect(() => {
    const [minLon, minLat, maxLon, maxLat] = region.bbox;
    map.fitBounds([[minLat, minLon], [maxLat, maxLon]], { padding: [20, 20] });
  }, [map, region]);
  return null;
}

function osintEventVisual(event: OsintMapEvent) {
  if (event.source === 'nasa-firms-match' || event.tags.includes('nasa-firms-match') || event.tags.includes('thermal')) {
    return {
      color: '#ff8a50',
      radius: 8.2,
      kindLabel: '열 이상 후보',
    };
  }
  if (event.source === 'osint-cluster-review' || event.tags.includes('osint-cluster-review') || event.tags.includes('osint-cluster')) {
    return {
      color: '#38bdf8',
      radius: 8.8,
      kindLabel: 'OSINT 클러스터',
    };
  }
  if (event.source === 'claim-review-cache' && event.tags.includes('claim-track-match')) {
    return {
      color: '#7dd3fc',
      radius: 8.5,
      kindLabel: '항적 연계',
    };
  }
  return {
    color: '#f97316',
    radius: 7,
    kindLabel: 'OSINT',
  };
}

function trackSeverity(track: Track, anomalies: Anomaly[]) {
  const related = anomalies.filter((anomaly) => anomaly.relatedTrackIds.includes(track.id));
  if (related.some((item) => item.severity === 'warning')) return 'warning';
  if (related.some((item) => item.severity === 'watch')) return 'watch';
  return 'normal';
}

function buildLocalGrid(region: Region) {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  const steps = 4;
  const latStep = (maxLat - minLat) / steps;
  const lonStep = (maxLon - minLon) / steps;
  const lines: [number, number][][] = [];

  for (let i = 0; i <= steps; i += 1) {
    const lat = minLat + latStep * i;
    const lon = minLon + lonStep * i;
    lines.push([[lat, minLon], [lat, maxLon]]);
    lines.push([[minLat, lon], [maxLat, lon]]);
  }

  return { bounds: [[minLat, minLon], [maxLat, maxLon]] as [[number, number], [number, number]], lines };
}

export function SituationMap({
  region,
  selectableRegions = [],
  onRegionSelect,
  tracks,
  ships,
  zones,
  referenceLines,
  satellites,
  airports,
  airRoutes,
  notices,
  airspaceContexts,
  osintEvents,
  anomalies,
  basemapMode = 'offline',
}: {
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
  basemapMode?: 'globe' | 'hud-globe' | 'offline' | 'live';
}) {
  const localGrid = buildLocalGrid(region);
  const useLiveBasemap = basemapMode === 'live';

  if (basemapMode === 'globe') {
    return (
      <SituationRealGlobe
        region={region}
        tracks={tracks}
        ships={ships}
        zones={zones}
        referenceLines={referenceLines}
        satellites={satellites}
        airports={airports}
        airRoutes={airRoutes}
        notices={notices}
        airspaceContexts={airspaceContexts}
        osintEvents={osintEvents}
        anomalies={anomalies}
        selectableRegions={selectableRegions}
        onRegionSelect={onRegionSelect}
      />
    );
  }

  if (basemapMode === 'hud-globe') {
    return (
      <SituationGlobe
        region={region}
        tracks={tracks}
        ships={ships}
        zones={zones}
        referenceLines={referenceLines}
        satellites={satellites}
        airports={airports}
        airRoutes={airRoutes}
        notices={notices}
        airspaceContexts={airspaceContexts}
        osintEvents={osintEvents}
        anomalies={anomalies}
        selectableRegions={selectableRegions}
        onRegionSelect={onRegionSelect}
      />
    );
  }

  return (
    <div className={`situation-map-shell situation-map-shell--${basemapMode}`}>
      <MapRegionSwitcher
        regions={selectableRegions}
        currentRegionId={region.id}
        onRegionSelect={onRegionSelect}
      />
      <MapContainer center={region.center} zoom={region.zoom} className="situation-map" scrollWheelZoom attributionControl={useLiveBasemap}>
        <FitRegion region={region} />
        {useLiveBasemap && (
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            className="hud-basemap-tile"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
        )}
        <Rectangle
          bounds={localGrid.bounds}
          pathOptions={{ color: '#38bdf8', weight: 2, opacity: 0.68, fillColor: '#0f2742', fillOpacity: useLiveBasemap ? 0.04 : 0.28 }}
        >
          <Popup>
            <strong>{region.shortName} 관심지역 bbox</strong>
            <p>{region.bboxNote ?? '공개 데이터 수집에 쓰는 출처 기반 관심지역 범위입니다.'}</p>
            <small>{region.bbox.join(', ')}</small>
            {region.bboxSource && <p><small>{region.bboxSource}</small></p>}
          </Popup>
        </Rectangle>
        {localGrid.lines.map((line, index) => (
          <Polyline
            key={`grid-${index}`}
            positions={line}
            pathOptions={{ color: '#67e8f9', weight: 1, opacity: useLiveBasemap ? 0.18 : 0.36, dashArray: '4 8' }}
            interactive={false}
          />
        ))}
        {zones.map((zone) => (
          <Polygon
            key={zone.id}
            positions={zone.polygon}
            pathOptions={{ color: zone.severity === 'warning' ? '#f97316' : '#facc15', weight: 3, fillOpacity: 0.18 }}
          >
            <Popup>
              <strong>{zone.name}</strong>
              <p>{zone.description}</p>
              <small>공개/운영 참고 구역입니다.</small>
            </Popup>
          </Polygon>
        ))}
        {referenceLines.map((line) => (
          <Polyline
            key={line.id}
            positions={line.points}
            pathOptions={{ color: '#a78bfa', weight: 4, opacity: 0.95, dashArray: '8 8' }}
          >
            <Popup>
              <strong>{line.name}</strong>
              <p>{line.description}</p>
              <small>{line.source}</small>
            </Popup>
          </Polyline>
        ))}
        {airRoutes.map((route) => (
          <Polyline
            key={route.id}
            positions={route.points}
            pathOptions={{ color: '#d8b463', weight: 2, opacity: 0.82, dashArray: '10 10' }}
          >
            <Popup>
              <strong>{route.name}</strong>
              <p>{route.description}</p>
              <small>{route.source}{route.corridorKm ? ` · corridor ${route.corridorKm}km` : ''}</small>
            </Popup>
          </Polyline>
        ))}
        {notices.map((notice) => (
          <Circle
            key={notice.id}
            center={[notice.lat, notice.lon]}
            radius={notice.radiusKm * 1000}
            pathOptions={{
              color: notice.severity === 'warning' ? '#ef4444' : notice.severity === 'watch' ? '#f59e0b' : '#94a3b8',
              weight: 2,
              dashArray: '4 7',
              fillOpacity: 0.07,
            }}
          >
            <Popup>
              <strong>{notice.title}</strong>
              <p>{notice.description}</p>
              <small>{notice.source} · 반경 {notice.radiusKm}km</small>
            </Popup>
          </Circle>
        ))}
        {airspaceContexts.map((context) => (
          <Marker key={context.id} position={[context.lat, context.lon]} icon={airspaceIcon(context.icaoCode)}>
            <Popup>
              <strong>{context.icaoCode} {context.firName} FIR</strong>
              <p>{context.state ?? 'State unknown'} · {context.icaoRegion ?? 'ICAO region unknown'} · {context.type ?? 'FIR'}</p>
              <small>{context.source} · AOI 중심점 조회</small>
            </Popup>
          </Marker>
        ))}
        {selectableRegions.filter((item) => item.id !== 'global').map((item) => (
          <Marker
            key={`region-switch-${item.id}`}
            position={item.center}
            icon={regionSwitchIcon(item, item.id === region.id)}
            eventHandlers={onRegionSelect ? {
              click: () => onRegionSelect(item.id),
            } : undefined}
          >
            <Popup>
              <strong>{item.shortName} 상세 지도</strong>
              <p>{item.description}</p>
              <small>클릭하면 해당 AOI로 전환합니다.</small>
            </Popup>
          </Marker>
        ))}
        {tracks.map((track) => {
          if (track.points.length === 0) return null;
          const severity = trackSeverity(track, anomalies);
          const positions = track.points.map((point) => [point.lat, point.lon] as [number, number]);
          const last = track.points[track.points.length - 1];
          return (
            <Fragment key={track.id}>
              <Polyline positions={positions} pathOptions={{ color: severity === 'warning' ? '#ef4444' : severity === 'watch' ? '#f59e0b' : '#38bdf8', weight: 4, opacity: 0.92 }} />
              {track.points.map((point, index) => (
                <CircleMarker key={`${track.id}-${point.observedAt}`} center={[point.lat, point.lon]} radius={index === track.points.length - 1 ? 5 : 3} pathOptions={{ color: '#0f172a', fillColor: '#e0f2fe', fillOpacity: 0.96, weight: 1 }} />
              ))}
              <Marker position={[last.lat, last.lon]} icon={aircraftIcon(track.callsign, severity, last.headingDeg, track.isMilitary)}>
                <Popup>
                  <strong>{track.callsign}{track.isMilitary ? ' · 군용(ADS-B)' : ''}</strong>
                  <p>{platformTypeLabel(track.platformType)} · {track.source}{track.typeCode ? ` · ${track.typeCode}` : ''}</p>
                  <p>고도 {last.altitudeM.toLocaleString()}m · 속도 {last.velocityMs}m/s · 방위 {last.headingDeg}°</p>
                  {(track.icao24 || track.registration) && <p>{track.icao24 ? `ICAO24 ${track.icao24}` : ''}{track.icao24 && track.registration ? ' · ' : ''}{track.registration ? `등록 ${track.registration}` : ''}</p>}
                  <small>{track.notes ?? '공개/캐시 상태 벡터입니다.'}</small>
                </Popup>
              </Marker>
            </Fragment>
          );
        })}
        {ships.map((ship) => {
          if (ship.points.length === 0) return null;
          const positions = ship.points.map((point) => [point.lat, point.lon] as [number, number]);
          const last = ship.points[ship.points.length - 1];
          return (
            <Fragment key={ship.id}>
              <Polyline positions={positions} pathOptions={{ color: '#22d3ee', weight: 3, opacity: 0.78, dashArray: '2 6' }} />
              {ship.points.map((point, index) => (
                <CircleMarker key={`${ship.id}-${point.observedAt}`} center={[point.lat, point.lon]} radius={index === ship.points.length - 1 ? 4 : 2.5} pathOptions={{ color: '#083344', fillColor: '#67e8f9', fillOpacity: 0.9, weight: 1 }} />
              ))}
              <Marker position={[last.lat, last.lon]} icon={shipIcon(ship.name)}>
                <Popup>
                  <strong>{ship.name}</strong>
                  <p>{vesselTypeLabel(ship.vesselType)} · {ship.source}</p>
                  <p>속도 {last.speedKnots}kt · 침로 {last.courseDeg}°</p>
                  <small>{ship.notes ?? 'AIS 계열 해상 레이어입니다.'}</small>
                </Popup>
              </Marker>
            </Fragment>
          );
        })}
        {airports.map((airport) => (
          <Marker key={airport.id} position={[airport.lat, airport.lon]} icon={airportIcon(airport.ident)}>
            <Popup>
              <strong>{airport.ident} · {airport.name}</strong>
              <p>{airport.type} · {airport.municipality ?? airport.isoCountry ?? '위치 맥락'}</p>
              <small>{airport.source}{airport.scheduledService ? ' · scheduled service' : ''}</small>
            </Popup>
          </Marker>
        ))}
        {osintEvents.map((event) => {
          const style = osintEventVisual(event);
          return (
          <CircleMarker
            key={event.id}
            center={[event.lat, event.lon]}
            radius={style.radius}
            pathOptions={{
              color: style.color,
              fillColor: style.color,
              fillOpacity: 0.44,
              weight: 2,
            }}
          >
            <Popup>
              <strong>{event.title}</strong>
              <p>{style.kindLabel} · 신뢰도 {Math.round(event.confidence * 100)}%</p>
              {event.tags.includes('not-geocoded') && <p>검토 포인트 · 정확 좌표 아님</p>}
              <small>{event.domain ?? event.source}</small>
            </Popup>
          </CircleMarker>
          );
        })}
        {satellites.map((sat) => (
          <Fragment key={sat.id}>
            {sat.groundTrack && sat.groundTrack.length > 1 && (
              <Polyline
                positions={sat.groundTrack}
                pathOptions={{ color: '#c4b5fd', weight: 2, opacity: 0.76, dashArray: '2 7' }}
              >
                <Popup>
                  <strong>{sat.name} ground track</strong>
                  <p>공개 궤도 데이터로 계산한 지상 투영 궤적입니다.</p>
                  <small>{sat.source}</small>
                </Popup>
              </Polyline>
            )}
            <Marker position={[sat.lat, sat.lon]} icon={satIcon}>
              <Popup>
                <strong>{sat.name}</strong>
                <p>{roleHintLabel(sat.roleHint)} · {sat.altitudeKm}km</p>
                <small>{sat.source}; 방향 {sat.direction}</small>
              </Popup>
            </Marker>
          </Fragment>
        ))}
      </MapContainer>
      <div className="map-basemap-note">
        <strong>{useLiveBasemap ? 'OSM 지도 타일' : '오프라인 벡터 지도'}</strong>
        <span>
          {useLiveBasemap
            ? '배경지도만 외부 타일을 사용합니다. 상황 데이터는 API 스냅샷 캐시에서만 읽습니다.'
            : '외부 지도 타일 요청 없이 관심지역 격자, 항적, 감시 구역만 표시합니다.'}
        </span>
      </div>
      {referenceLines.length > 0 && (
        <div className="map-reference-note">
          <strong>출처 기반 참고 오버레이</strong>
          <span>{referenceLines.map((line) => line.name).join(', ')}</span>
        </div>
      )}
    </div>
  );
}
