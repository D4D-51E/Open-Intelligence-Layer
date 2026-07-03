export function bboxAreaSqDegrees([minLon, minLat, maxLon, maxLat]) {
  return Math.abs(maxLat - minLat) * Math.abs(maxLon - minLon);
}

export function openSkyStateCreditsForBbox(bbox) {
  const area = bboxAreaSqDegrees(bbox);
  if (area <= 25) return 1;
  if (area <= 100) return 2;
  if (area <= 400) return 3;
  return 4;
}

export function recommendedOpenSkyIntervalMs(regions, dailyCredits = 400, utilization = 0.85) {
  const cycleCredits = regions.reduce((sum, region) => sum + openSkyStateCreditsForBbox(region.bbox), 0);
  if (cycleCredits <= 0) return 24 * 60 * 60 * 1000;
  const usableCredits = Math.max(1, Math.floor(dailyCredits * utilization));
  const cyclesPerDay = Math.max(1, Math.floor(usableCredits / cycleCredits));
  return Math.ceil((24 * 60 * 60 * 1000) / cyclesPerDay);
}

export function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const lower = name.toLowerCase();
  return headers[name] ?? headers[lower] ?? null;
}

export function retryAfterSecondsFromHeaders(headers) {
  const raw = headerValue(headers, 'x-rate-limit-retry-after-seconds') ?? headerValue(headers, 'retry-after');
  if (!raw) return null;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 0) return Math.ceil(numeric);
  const asDate = new Date(raw).getTime();
  if (!Number.isFinite(asDate)) return null;
  return Math.max(0, Math.ceil((asDate - Date.now()) / 1000));
}

export function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

export function publicErrorMessage(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr.trim().split(/\r?\n/).at(-1) : '';
  const message = stderr || error?.message || String(error);
  if (/<!doctype|<html|unexpected token\s*['"]?</i.test(message) || /is not valid json/i.test(message)) {
    return 'Invalid upstream response format (non-JSON)';
  }
  return message
    .replace(/<[^>]*>/g, ' ')
    .replace(/[<>{}"'`]/g, '')
    .replace(/\[/g, '')
    .replace(/\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
