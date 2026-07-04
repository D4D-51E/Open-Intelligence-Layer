// FAA NOTAM collector. Fetches active NOTAMs per ICAO location from the public
// notamSearch endpoint, parses the ICAO Q-line for coordinates/radius/altitude
// limits, and appends rows to Neon. Used by scripts/collect-notam.mjs (local)
// and api/cron/notam.mjs (Vercel Cron).

const FAA_URL = 'https://notams.aim.faa.gov/notamSearch/search';
const FAA_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  referer: 'https://notams.aim.faa.gov/notamSearch/nsapp.html',
  'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
};

const LOCATIONS = [
  'RKSI', 'RKSS', 'RKPC', 'RCTP', 'RCKH', 'RJTT', 'RJAA', 'VVTS', 'WSSS', 'RPLL',
  'KJFK', 'KLAX', 'EGLL', 'LFPG', 'EDDF',
];

const NM_TO_KM = 1.852;

// Q-line coord+radius token, e.g. `4038N07346W005`.
const Q_COORD_RE = /^(\d{2})(\d{2})([NS])(\d{3})(\d{2})([EW])(\d{3})$/;

function parseQLine(icaoMessage) {
  const line = String(icaoMessage ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('Q)'));
  if (!line) return null;
  const fields = line.slice(2).split('/').map((f) => f.trim());
  if (fields.length < 3) return null;
  const coordToken = fields[fields.length - 1];
  const match = Q_COORD_RE.exec(coordToken);
  if (!match) return null;
  const [, latDeg, latMin, latHem, lonDeg, lonMin, lonHem, radiusNm] = match;
  const lat = (Number(latDeg) + Number(latMin) / 60) * (latHem === 'S' ? -1 : 1);
  const lon = (Number(lonDeg) + Number(lonMin) / 60) * (lonHem === 'W' ? -1 : 1);
  const radiusKm = Number(radiusNm) * NM_TO_KM;

  let flMin = null;
  let flMax = null;
  const lower = Number.parseInt(fields[fields.length - 3], 10);
  const upper = Number.parseInt(fields[fields.length - 2], 10);
  if (Number.isFinite(lower)) flMin = lower;
  if (Number.isFinite(upper)) flMax = upper;

  return { lat, lon, radiusKm, flMin, flMax };
}

// FAA dates look like `MM/DD/YYYY HHMM`; treated as UTC. 'PERM'/unparseable -> null.
function parseFaaDate(value) {
  const str = String(value ?? '').trim();
  const match = /^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{4})$/.exec(str);
  if (!match) return null;
  const [, mm, dd, yyyy, hhmm] = match;
  const hh = hhmm.slice(0, 2);
  const min = hhmm.slice(2, 4);
  const ms = Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

async function fetchNotams(icao, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = new URLSearchParams({
      searchType: '0',
      designatorsForLocation: icao,
      offset: '0',
      notamsOnly: 'false',
      length: '30',
    });
    const res = await fetch(FAA_URL, { method: 'POST', headers: FAA_HEADERS, body: body.toString(), signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const json = await res.json();
    return json.notamList ?? [];
  } finally {
    clearTimeout(timer);
  }
}

function buildNotamInsert(sql, icao, notam) {
  const coords = parseQLine(notam.icaoMessage);
  const naturalKey = `${notam.facilityDesignator ?? icao}:${notam.notamNumber ?? ''}`;
  const startAt = parseFaaDate(notam.startDate);
  const endAt = parseFaaDate(notam.endDate);
  return sql`
    INSERT INTO notam_notices
      (icao, notam_number, feature, lat, lon, radius_km, fl_min, fl_max, start_at, end_at, text, natural_key, payload)
    VALUES (
      ${notam.facilityDesignator ?? icao}, ${notam.notamNumber ?? null}, ${notam.featureName ?? null},
      ${coords?.lat ?? null}, ${coords?.lon ?? null}, ${coords?.radiusKm ?? null},
      ${coords?.flMin ?? null}, ${coords?.flMax ?? null},
      ${startAt}, ${endAt}, ${notam.icaoMessage ?? null}, ${naturalKey},
      ${JSON.stringify(notam)}::jsonb
    )
    ON CONFLICT (natural_key) WHERE natural_key IS NOT NULL DO NOTHING
    RETURNING id
  `;
}

// Fetches one location and batch-inserts all its NOTAMs in a single transaction
// (was one round-trip per NOTAM). Returns the inserted count.
async function collectLocation(sql, icao, log) {
  try {
    const notamList = await fetchNotams(icao);
    const stmts = notamList.map((notam) => buildNotamInsert(sql, icao, notam));
    const results = stmts.length ? await sql.transaction(stmts) : [];
    const inserted = results.reduce((sum, rows) => sum + (rows.length ?? 0), 0);
    log?.(`${icao} fetched=${notamList.length} inserted=${inserted}`);
    return inserted;
  } catch (error) {
    log?.(`${icao} FAILED: ${String(error)}`);
    return 0;
  }
}

// Bounded-concurrency map so we don't fire all locations at the FAA endpoint at once.
async function mapPool(items, limit, fn) {
  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      results[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Collects NOTAMs for a fixed set of ICAO locations and appends new rows to Neon.
// Locations are fetched with bounded concurrency (FAA endpoint is unauthenticated/public).
export async function collectNotam(sql, { concurrency = 5, log } = {}) {
  const counts = await mapPool(LOCATIONS, concurrency, (icao) => collectLocation(sql, icao, log));
  return { inserted: counts.reduce((sum, n) => sum + n, 0) };
}
