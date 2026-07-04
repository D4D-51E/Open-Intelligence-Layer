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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

async function fetchNotams(icao) {
  const body = new URLSearchParams({
    searchType: '0',
    designatorsForLocation: icao,
    offset: '0',
    notamsOnly: 'false',
    length: '30',
  });
  const res = await fetch(FAA_URL, { method: 'POST', headers: FAA_HEADERS, body: body.toString() });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const json = await res.json();
  return json.notamList ?? [];
}

async function insertNotam(sql, icao, notam) {
  const coords = parseQLine(notam.icaoMessage);
  const naturalKey = `${notam.facilityDesignator ?? icao}:${notam.notamNumber ?? ''}`;
  const startAt = parseFaaDate(notam.startDate);
  const endAt = parseFaaDate(notam.endDate);
  const rows = await sql`
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
  return { inserted: rows.length > 0, hasCoords: coords != null };
}

// Collects NOTAMs for a fixed set of ICAO locations and appends new rows to Neon.
// `opts.paceMs` throttles requests between locations (FAA endpoint is unauthenticated/public).
export async function collectNotam(sql, { paceMs = 400, log } = {}) {
  let inserted = 0;
  let withCoords = 0;
  const byIcao = {};
  for (const icao of LOCATIONS) {
    await sleep(paceMs);
    try {
      const notamList = await fetchNotams(icao);
      let icaoInserted = 0;
      for (const notam of notamList) {
        const result = await insertNotam(sql, icao, notam);
        if (result.inserted) {
          icaoInserted += 1;
          inserted += 1;
          if (result.hasCoords) withCoords += 1;
        }
      }
      byIcao[icao] = icaoInserted;
      log?.(`${icao} fetched=${notamList.length} inserted=${icaoInserted}`);
    } catch (error) {
      byIcao[icao] = 0;
      log?.(`${icao} FAILED: ${String(error)}`);
    }
  }
  return { inserted, withCoords, byIcao };
}
