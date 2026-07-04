import { useEffect, useRef } from 'react';
import type { AirportContext, AirRoute, AirspaceContext, AirspaceNotice, Anomaly, OsintMapEvent, ReferenceLine, Region, RegionId, SatellitePass, ShipTrack, Track, WatchZone } from '../lib/types';
import { MapRegionSwitcher } from './MapRegionSwitcher';

type SituationGlobeProps = {
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

type Projection = {
  cx: number;
  cy: number;
  radius: number;
  centerLat: number;
  centerLon: number;
  sweepLon: number;
  pitchOffset: number;
};

type ProjectedPoint = {
  x: number;
  y: number;
  z: number;
  visible: boolean;
};

type LabelCandidate = {
  x: number;
  y: number;
  z: number;
  text: string;
  color: string;
  align?: CanvasTextAlign;
};

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

const continentHints: Array<[number, number][]> = [
  [[72, -168], [65, -128], [53, -104], [44, -78], [27, -82], [17, -100], [24, -124], [47, -126], [60, -150]],
  [[15, -82], [7, -76], [-5, -80], [-18, -70], [-38, -62], [-55, -68], [-47, -43], [-20, -36], [4, -50]],
  [[70, -12], [64, 34], [58, 78], [52, 124], [37, 145], [18, 115], [8, 78], [26, 46], [36, 15], [46, -10]],
  [[33, -18], [30, 28], [12, 45], [-10, 40], [-34, 21], [-34, -18], [-4, -15], [13, -8]],
  [[8, 95], [18, 108], [7, 122], [-9, 116], [-8, 96]],
  [[-11, 113], [-18, 141], [-34, 153], [-43, 129], [-30, 113]],
  [[80, -52], [73, -24], [61, -38], [66, -62]],
];

function normalizeDeltaLon(lon: number, centerLon: number, sweepLon: number) {
  let delta = lon - centerLon + sweepLon;
  while (delta < -180) delta += 360;
  while (delta > 180) delta -= 360;
  return delta;
}

function project(lat: number, lon: number, projection: Projection): ProjectedPoint {
  const phi = lat * DEG;
  const lambda = normalizeDeltaLon(lon, projection.centerLon, projection.sweepLon) * DEG;
  const phi0 = Math.max(-72, Math.min(72, projection.centerLat + projection.pitchOffset)) * DEG;

  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const sinPhi0 = Math.sin(phi0);
  const cosPhi0 = Math.cos(phi0);
  const cosLambda = Math.cos(lambda);
  const z = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosLambda;

  return {
    x: projection.cx + projection.radius * cosPhi * Math.sin(lambda),
    y: projection.cy - projection.radius * (cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosLambda),
    z,
    visible: z > -0.02,
  };
}

function clear(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.clearRect(0, 0, width, height);
  const background = ctx.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, Math.max(width, height) * 0.7);
  background.addColorStop(0, '#031110');
  background.addColorStop(0.52, '#010706');
  background.addColorStop(1, '#000000');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
}

function drawScreenGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.save();
  ctx.strokeStyle = 'rgba(125, 249, 255, 0.045)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= width; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  ctx.restore();
}

function clipGlobe(ctx: CanvasRenderingContext2D, projection: Projection) {
  ctx.beginPath();
  ctx.arc(projection.cx, projection.cy, projection.radius, 0, TWO_PI);
  ctx.clip();
}

function drawSphere(ctx: CanvasRenderingContext2D, projection: Projection) {
  const { cx, cy, radius } = projection;
  ctx.save();
  ctx.shadowColor = 'rgba(125, 249, 255, 0.45)';
  ctx.shadowBlur = 32;
  ctx.strokeStyle = 'rgba(125, 249, 255, 0.42)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  const fill = ctx.createRadialGradient(cx - radius * 0.36, cy - radius * 0.34, radius * 0.05, cx, cy, radius * 1.08);
  fill.addColorStop(0, 'rgba(61, 120, 122, 0.38)');
  fill.addColorStop(0.38, 'rgba(6, 29, 30, 0.82)');
  fill.addColorStop(0.74, 'rgba(0, 5, 6, 0.98)');
  fill.addColorStop(1, 'rgba(0, 0, 0, 1)');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

function drawProjectedPolyline(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  projection: Projection,
  color: string,
  width: number,
  alpha = 1,
  dash: number[] = [],
) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (let i = 1; i < points.length; i += 1) {
    const a = project(points[i - 1][0], points[i - 1][1], projection);
    const b = project(points[i][0], points[i][1], projection);
    if (!a.visible || !b.visible) continue;
    ctx.globalAlpha = alpha * Math.max(0.18, Math.min(1, (a.z + b.z) / 2));
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawProjectedPolygon(
  ctx: CanvasRenderingContext2D,
  points: [number, number][],
  projection: Projection,
  stroke: string,
  fill: string,
  width = 1.5,
) {
  if (points.length < 3) return;
  const projected = points.map(([lat, lon]) => project(lat, lon, projection)).filter((point) => point.visible);
  if (projected.length < 3) return;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(projected[0].x, projected[0].y);
  for (const point of projected.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawGraticule(ctx: CanvasRenderingContext2D, projection: Projection) {
  ctx.save();
  clipGlobe(ctx, projection);
  for (let lat = -75; lat <= 75; lat += 15) {
    const points: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 4) points.push([lat, lon]);
    drawProjectedPolyline(ctx, points, projection, 'rgba(180, 244, 255, 0.18)', lat === 0 ? 1.4 : 0.75, lat === 0 ? 0.75 : 0.55);
  }
  for (let lon = -180; lon < 180; lon += 15) {
    const points: [number, number][] = [];
    for (let lat = -86; lat <= 86; lat += 4) points.push([lat, lon]);
    drawProjectedPolyline(ctx, points, projection, 'rgba(180, 244, 255, 0.16)', lon === 0 ? 1.4 : 0.75, lon === 0 ? 0.7 : 0.48);
  }
  ctx.restore();
}

function drawContinentHints(ctx: CanvasRenderingContext2D, projection: Projection) {
  ctx.save();
  clipGlobe(ctx, projection);
  for (const polygon of continentHints) {
    drawProjectedPolygon(ctx, polygon, projection, 'rgba(216, 231, 226, 0.18)', 'rgba(210, 230, 226, 0.075)', 1);
    drawProjectedPolyline(ctx, [...polygon, polygon[0]], projection, 'rgba(238, 248, 242, 0.18)', 0.9, 0.72);
  }

  ctx.fillStyle = 'rgba(230, 250, 246, 0.16)';
  for (let lat = -62; lat <= 72; lat += 4) {
    for (let lon = -180; lon < 180; lon += 6) {
      const pseudoLand = Math.sin((lat * 2.7 + lon * 1.3) * DEG) + Math.cos((lat * 1.9 - lon * 0.6) * DEG);
      if (pseudoLand < 0.65) continue;
      const point = project(lat, lon, projection);
      if (!point.visible) continue;
      ctx.globalAlpha = Math.max(0.08, Math.min(0.22, point.z * 0.2));
      ctx.fillRect(point.x, point.y, 1.05, 1.05);
    }
  }
  ctx.restore();
}

function bboxPolygon(region: Region): [number, number][] {
  const [minLon, minLat, maxLon, maxLat] = region.bbox;
  return [
    [minLat, minLon],
    [minLat, maxLon],
    [maxLat, maxLon],
    [maxLat, minLon],
  ];
}

function circlePoints(lat: number, lon: number, radiusKm: number): [number, number][] {
  const points: [number, number][] = [];
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / Math.max(30, 111 * Math.cos(lat * DEG));
  for (let angle = 0; angle <= 360; angle += 8) {
    const rad = angle * DEG;
    points.push([lat + Math.sin(rad) * latDelta, lon + Math.cos(rad) * lonDelta]);
  }
  return points;
}

function trackSeverity(track: Track, anomalies: Anomaly[]) {
  const related = anomalies.filter((anomaly) => anomaly.relatedTrackIds.includes(track.id));
  if (related.some((item) => item.severity === 'warning')) return 'warning';
  if (related.some((item) => item.severity === 'watch')) return 'watch';
  return 'normal';
}

function drawPoint(
  ctx: CanvasRenderingContext2D,
  projection: Projection,
  lat: number,
  lon: number,
  color: string,
  radius: number,
  label?: string,
  labels?: LabelCandidate[],
) {
  const point = project(lat, lon, projection);
  if (!point.visible) return;
  const scale = Math.max(0.58, Math.min(1.18, 0.65 + point.z * 0.52));

  ctx.save();
  ctx.globalAlpha = Math.max(0.18, Math.min(1, point.z));
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius * scale, 0, TWO_PI);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  if (label && labels && point.z > 0.2) {
    labels.push({ x: point.x, y: point.y - radius * scale - 6, z: point.z, text: label, color });
  }
}

function drawLabels(ctx: CanvasRenderingContext2D, labels: LabelCandidate[], maxLabels = 14) {
  ctx.save();
  ctx.font = '11px SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace';
  ctx.textBaseline = 'middle';
  const sorted = [...labels].sort((a, b) => b.z - a.z).slice(0, maxLabels);
  for (const label of sorted) {
    ctx.textAlign = label.align ?? 'center';
    const metrics = ctx.measureText(label.text);
    const padding = 5;
    const height = 17;
    const x = label.x - metrics.width / 2 - padding;
    const y = label.y - height / 2;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
    ctx.strokeStyle = 'rgba(125, 249, 255, 0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.rect(x, y, metrics.width + padding * 2, height);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = label.color;
    ctx.fillText(label.text, label.x, label.y + 0.5);
  }
  ctx.restore();
}

function drawAoiOverlays(ctx: CanvasRenderingContext2D, projection: Projection, props: SituationGlobeProps) {
  ctx.save();
  clipGlobe(ctx, projection);

  drawProjectedPolygon(ctx, bboxPolygon(props.region), projection, 'rgba(56, 189, 248, 0.92)', 'rgba(56, 189, 248, 0.12)', 2.2);
  drawProjectedPolyline(ctx, [...bboxPolygon(props.region), bboxPolygon(props.region)[0]], projection, 'rgba(125, 249, 255, 0.86)', 2.2, 1, [7, 6]);

  for (const zone of props.zones) {
    const color = zone.severity === 'warning' ? 'rgba(255, 93, 71, 0.9)' : 'rgba(255, 178, 56, 0.88)';
    drawProjectedPolygon(ctx, zone.polygon, projection, color, zone.severity === 'warning' ? 'rgba(255, 93, 71, 0.12)' : 'rgba(255, 178, 56, 0.12)', 1.6);
  }
  for (const line of props.referenceLines) drawProjectedPolyline(ctx, line.points, projection, 'rgba(196, 181, 253, 0.9)', 2.1, 0.95, [8, 8]);
  for (const route of props.airRoutes) drawProjectedPolyline(ctx, route.points, projection, 'rgba(241, 184, 75, 0.82)', 1.5, 0.85, [9, 8]);
  for (const notice of props.notices) {
    const color = notice.severity === 'warning' ? 'rgba(255, 93, 71, 0.86)' : notice.severity === 'watch' ? 'rgba(255, 178, 56, 0.8)' : 'rgba(148, 163, 184, 0.62)';
    drawProjectedPolyline(ctx, circlePoints(notice.lat, notice.lon, notice.radiusKm), projection, color, 1.2, 0.72, [4, 5]);
  }
  ctx.restore();
}

function drawTrackLayers(ctx: CanvasRenderingContext2D, projection: Projection, props: SituationGlobeProps, labels: LabelCandidate[]) {
  ctx.save();
  clipGlobe(ctx, projection);

  for (const sat of props.satellites) {
    if (sat.groundTrack && sat.groundTrack.length > 1) drawProjectedPolyline(ctx, sat.groundTrack, projection, 'rgba(196, 181, 253, 0.72)', 1.2, 0.72, [2, 7]);
  }

  for (const ship of props.ships) {
    if (!ship.points.length) continue;
    const positions = ship.points.map((point) => [point.lat, point.lon] as [number, number]);
    drawProjectedPolyline(ctx, positions, projection, 'rgba(34, 211, 238, 0.78)', 1.6, 0.82, [3, 5]);
    const last = ship.points[ship.points.length - 1];
    drawPoint(ctx, projection, last.lat, last.lon, '#67e8f9', 3.5, ship.name, labels);
  }

  for (const track of props.tracks) {
    if (!track.points.length) continue;
    const severity = trackSeverity(track, props.anomalies);
    const color = severity === 'warning' ? '#ff5d47' : severity === 'watch' ? '#ffb238' : '#7df9ff';
    const positions = track.points.map((point) => [point.lat, point.lon] as [number, number]);
    drawProjectedPolyline(ctx, positions, projection, color, severity === 'normal' ? 2 : 2.8, 0.9);
    for (const point of track.points.slice(0, -1)) drawPoint(ctx, projection, point.lat, point.lon, 'rgba(224, 242, 254, 0.78)', 1.8);
    const last = track.points[track.points.length - 1];
    drawPoint(ctx, projection, last.lat, last.lon, color, severity === 'normal' ? 4.5 : 5.6, track.callsign.trim() || track.id, labels);
  }

  for (const airport of props.airports) drawPoint(ctx, projection, airport.lat, airport.lon, '#c4b5fd', 3.2, airport.ident, labels);
  for (const context of props.airspaceContexts) drawPoint(ctx, projection, context.lat, context.lon, '#f1b84b', 3.5, context.icaoCode, labels);
  for (const event of props.osintEvents) {
    const color = event.source === 'nasa-firms-match' || event.tags.includes('nasa-firms-match') || event.tags.includes('thermal')
      ? '#ff8a50'
      : event.source === 'osint-cluster-review' || event.tags.includes('osint-cluster-review') || event.tags.includes('osint-cluster')
        ? '#7dd3fc'
        : event.source === 'claim-review-cache' && event.tags.includes('claim-track-match')
          ? '#38f6ff'
          : '#ff7a35';
    const label = event.source === 'nasa-firms-match' || event.tags.includes('thermal')
      ? 'FIRMS'
      : event.source === 'osint-cluster-review' || event.tags.includes('osint-cluster')
        ? '클러스터'
        : event.source === 'claim-review-cache' && event.tags.includes('claim-track-match')
          ? '항적'
          : 'OSINT';
    drawPoint(ctx, projection, event.lat, event.lon, color, 4.2, label, labels);
  }
  for (const sat of props.satellites) drawPoint(ctx, projection, sat.lat, sat.lon, '#bda9ff', 4.4, sat.name, labels);

  ctx.restore();
}

function drawReticle(ctx: CanvasRenderingContext2D, projection: Projection) {
  const { cx, cy, radius } = projection;
  ctx.save();
  ctx.strokeStyle = 'rgba(125, 249, 255, 0.15)';
  ctx.lineWidth = 1;
  for (const scale of [0.44, 0.62, 0.82, 1.08]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * scale, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(125, 249, 255, 0.18)';
  ctx.beginPath();
  ctx.moveTo(cx - radius * 1.3, cy);
  ctx.lineTo(cx + radius * 1.3, cy);
  ctx.moveTo(cx, cy - radius * 1.3);
  ctx.lineTo(cx, cy + radius * 1.3);
  ctx.stroke();
  ctx.restore();
}

function drawSweep(ctx: CanvasRenderingContext2D, projection: Projection, time: number, reducedMotion: boolean) {
  if (reducedMotion) return;
  const { cx, cy, radius } = projection;
  const angle = (time / 2800) % TWO_PI;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius * 1.04, angle - 0.34, angle + 0.015);
  ctx.closePath();
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.04);
  gradient.addColorStop(0, 'rgba(125, 249, 255, 0.13)');
  gradient.addColorStop(1, 'rgba(125, 249, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.restore();
}

function drawCanvas(ctx: CanvasRenderingContext2D, width: number, height: number, props: SituationGlobeProps, time: number, reducedMotion: boolean) {
  const baseRadius = Math.min(width, height) * 0.38;
  const projection: Projection = {
    cx: width * 0.5,
    cy: height * 0.54,
    radius: Math.max(170, baseRadius),
    centerLat: props.region.center[0],
    centerLon: props.region.center[1],
    sweepLon: reducedMotion ? 0 : Math.sin(time / 7200) * 8,
    pitchOffset: reducedMotion ? 0 : Math.sin(time / 9400) * 3,
  };
  const labels: LabelCandidate[] = [];

  clear(ctx, width, height);
  drawScreenGrid(ctx, width, height);
  drawReticle(ctx, projection);
  drawSphere(ctx, projection);
  drawGraticule(ctx, projection);
  drawContinentHints(ctx, projection);
  drawAoiOverlays(ctx, projection, props);
  drawTrackLayers(ctx, projection, props, labels);
  drawSweep(ctx, projection, time, reducedMotion);
  drawLabels(ctx, labels);
}

export function SituationGlobe(props: SituationGlobeProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let animationFrame = 0;
    let disposed = false;

    const resizeAndDraw = (time = 0) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const scaledWidth = Math.round(width * dpr);
      const scaledHeight = Math.round(height * dpr);
      if (canvas.width !== scaledWidth || canvas.height !== scaledHeight) {
        canvas.width = scaledWidth;
        canvas.height = scaledHeight;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCanvas(ctx, width, height, props, time, reducedMotion);
    };

    const observer = new ResizeObserver(() => resizeAndDraw(performance.now()));
    observer.observe(canvas);

    const tick = (time: number) => {
      if (disposed) return;
      resizeAndDraw(time);
      if (!reducedMotion) animationFrame = requestAnimationFrame(tick);
    };
    animationFrame = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(animationFrame);
    };
  }, [props]);

  return (
    <div className="situation-map-shell situation-map-shell--globe situation-globe-shell" role="img" aria-label={`${props.region.shortName} 3D 지구본 상황도`}>
      <canvas ref={canvasRef} className="situation-globe-canvas" />
      <MapRegionSwitcher
        regions={props.selectableRegions ?? []}
        currentRegionId={props.region.id}
        onRegionSelect={props.onRegionSelect}
      />
      <div className="globe-readout globe-readout--left" aria-hidden="true">
        <strong>ORTHO GLOBE</strong>
        <span>LAT {props.region.center[0].toFixed(2)} · LON {props.region.center[1].toFixed(2)}</span>
      </div>
      <div className="globe-readout globe-readout--right" aria-hidden="true">
        <span>TRK {props.tracks.length}</span>
        <span>SHIP {props.ships.length}</span>
        <span>OSINT {props.osintEvents.length}</span>
        <span>SAT {props.satellites.length}</span>
      </div>
      <div className="map-basemap-note">
        <strong>3D Globe HUD</strong>
        <span>지도 타일 요청 없이 공개/캐시 좌표를 정사투영 지구본에 표시합니다. 회전은 AOI 중심을 유지하는 레이더 스윕입니다.</span>
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
