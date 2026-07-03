import type { RegionId, Track, TrackPoint } from './types';

export type LiveTrackHistory = Partial<Record<RegionId, Record<string, Track>>>;

const maxHistoryPoints = 8;
const maxTrackAgeMs = 30 * 60 * 1000;

function pointKey(point: TrackPoint) {
  return [
    point.observedAt,
    point.lat.toFixed(5),
    point.lon.toFixed(5),
    point.altitudeM,
    point.headingDeg,
  ].join('|');
}

function observedAtMs(track: Track) {
  const last = track.points.at(-1);
  if (!last) return 0;
  const value = new Date(last.observedAt).getTime();
  return Number.isFinite(value) ? value : 0;
}

function mergePoints(existing: TrackPoint[], incoming: TrackPoint[]) {
  const byKey = new Map<string, TrackPoint>();
  for (const point of [...existing, ...incoming]) {
    byKey.set(pointKey(point), point);
  }

  return [...byKey.values()]
    .sort((a, b) => new Date(a.observedAt).getTime() - new Date(b.observedAt).getTime())
    .slice(-maxHistoryPoints);
}

function samePoints(a: TrackPoint[], b: TrackPoint[]) {
  if (a.length !== b.length) return false;
  return a.every((point, index) => pointKey(point) === pointKey(b[index]));
}

export function mergeLiveTrackHistory(
  current: LiveTrackHistory,
  regionId: RegionId,
  incomingTracks: Track[],
  nowIso = new Date().toISOString(),
): LiveTrackHistory {
  const now = new Date(nowIso).getTime();
  const existingRegion = current[regionId] ?? {};
  const nextRegion: Record<string, Track> = {};
  let changed = false;

  for (const [trackId, track] of Object.entries(existingRegion)) {
    const ageMs = now - observedAtMs(track);
    if (!Number.isFinite(ageMs) || ageMs <= maxTrackAgeMs) {
      nextRegion[trackId] = track;
    } else {
      changed = true;
    }
  }

  for (const track of incomingTracks) {
    if (track.points.length === 0) continue;
    const existing = nextRegion[track.id];
    const nextPoints = mergePoints(existing?.points ?? [], track.points);
    if (existing && samePoints(existing.points, nextPoints)) continue;

    nextRegion[track.id] = {
      ...track,
      points: nextPoints,
      notes: track.notes
        ? `${track.notes} 최근 수집 상태 벡터를 브라우저에서 누적해 이동 궤적으로 표시합니다.`
        : '최근 수집 상태 벡터를 브라우저에서 누적해 이동 궤적으로 표시합니다.',
    };
    changed = true;
  }

  if (!changed) return current;

  return {
    ...current,
    [regionId]: nextRegion,
  };
}

export function liveTrackHistoryForRegion(history: LiveTrackHistory, regionId: RegionId) {
  return Object.values(history[regionId] ?? {})
    .filter((track) => track.points.length > 0)
    .sort((a, b) => a.callsign.localeCompare(b.callsign));
}
