// NASA FIRMS live thermal fetch (VIIRS SNPP NRT). Given a set of bounding boxes (e.g. one per
// geolocated claim region), fetches active fire detections and returns them as ThermalAnomaly-like
// objects for the reliability scorer. This fills the thermal axis over the ACTUAL claim regions
// (Middle East / Ukraine), which the static AOI cache doesn't cover — so genuine strikes get
// thermal corroboration and can legitimately score higher. Requires NASA_FIRMS_MAP_KEY. Public data.
const SOURCE = 'VIIRS_SNPP_NRT';
const FIRMS_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';

function toObservedAt(acqDate, acqTime) {
  // acqTime is HHMM without leading zeros (e.g. "24" → 00:24, "1002" → 10:02).
  const t = String(acqTime ?? '').padStart(4, '0');
  const hh = t.slice(0, 2);
  const mm = t.slice(2, 4);
  return `${acqDate}T${hh}:${mm}:00Z`;
}

function parseFirmsCsv(text, seen, out) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return;
  const header = lines[0].split(',');
  const idx = (name) => header.indexOf(name);
  const iLat = idx('latitude');
  const iLon = idx('longitude');
  const iDate = idx('acq_date');
  const iTime = idx('acq_time');
  const iFrp = idx('frp');
  const iBright = idx('bright_ti4');
  const iConf = idx('confidence');
  if (iLat < 0 || iLon < 0) return;
  for (let i = 1; i < lines.length; i += 1) {
    const c = lines[i].split(',');
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const observedAt = toObservedAt(c[iDate], c[iTime]);
    const id = `firms-${lat}-${lon}-${c[iDate]}-${c[iTime]}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const confRaw = c[iConf];
    const confidence = confRaw === 'h' ? 0.9 : confRaw === 'n' ? 0.6 : confRaw === 'l' ? 0.3 : (Number(confRaw) / 100 || null);
    out.push({
      id,
      source: 'nasa-firms-live',
      provider: 'NASA FIRMS',
      lat,
      lon,
      observedAt,
      frpMw: iFrp >= 0 ? Number(c[iFrp]) || 0 : 0,
      brightnessKelvin: iBright >= 0 ? Number(c[iBright]) || null : null,
      confidence,
    });
  }
}

// Fetch FIRMS fires for each bbox ([west, south, east, north]) in parallel. Best-effort: any
// failed/omitted request just contributes no fires. dayRange 1–10 (default 2 ≈ 48h window).
export async function fetchFirms(bboxes, opts = {}) {
  const mapKey = opts.mapKey ?? process.env.NASA_FIRMS_MAP_KEY;
  const dayRange = Math.min(10, Math.max(1, opts.dayRange ?? 2));
  if (!mapKey || !Array.isArray(bboxes) || bboxes.length === 0) return [];
  const seen = new Set();
  const out = [];
  const texts = await Promise.all(bboxes.slice(0, 12).map(async (b) => {
    try {
      const url = `${FIRMS_BASE}/${mapKey}/${SOURCE}/${b.join(',')}/${dayRange}`;
      const res = await fetch(url, { signal: opts.signal ?? AbortSignal.timeout(10_000), headers: { 'user-agent': 'AirMaven/0.1' } });
      return res.ok ? await res.text() : '';
    } catch {
      return '';
    }
  }));
  for (const text of texts) if (text) parseFirmsCsv(text, seen, out);
  return out;
}

// Build a ~110km bbox ([w,s,e,n]) around a point — comfortably covers the scorer's 30km match radius.
export function bboxAround(lat, lon, pad = 0.5) {
  return [lon - pad, lat - pad, lon + pad, lat + pad];
}
