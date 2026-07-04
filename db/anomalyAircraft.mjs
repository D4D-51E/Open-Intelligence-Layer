// Anomalous-aircraft detection for the bot's rapid push: emergency squawks (7700 general
// emergency, 7600 radio failure, 7500 hijack) + high-value military assets (AWACS, ISR/recon,
// tankers, bombers) by ICAO type code. Source: adsb.lol (keyless, public ADS-B). Non-targeting.
const ADSB = 'https://api.adsb.lol/v2';

const SQUAWK_LABEL = { 7700: '비상(General Emergency)', 7600: '무선두절(Radio Failure)', 7500: '하이재킹(Hijack)' };

// High-value asset classes by ICAO type designator. ANCHORED (^…$) so near-miss codes like H60
// (Black Hawk helicopter, not the H6 bomber), B190/B738, etc. don't false-positive. Matched only
// within /mil results, so ambiguous civil-derived frames (A332/A310) read as their military role.
const HVA_CLASSES = [
  { label: 'AWACS 조기경보', re: /^(E3(TF|CF|DF)?|E7|E767|E763|A50U?|E2C?D?|KJ\d*)$/ },
  { label: 'ISR 정찰', re: /^(RC135|RC13|U2S?|RQ4A?|Q4|EP3E?|E6B?|E11A?|P8A?|P3C?)$/ },
  { label: '공중급유기', re: /^(KC135|K35R|KC10|DC10|KC46A?|KC30|A310|A332|VC10|KE3)$/ },
  { label: '폭격기', re: /^(B52H?|B1B?|B2A?|T95|TU95|T160|TU160|T22M?|TU22M?|H6K?)$/ },
];

function classifyHva(typeCode) {
  const t = String(typeCode ?? '').toUpperCase();
  if (!t) return null;
  for (const c of HVA_CLASSES) if (c.re.test(t)) return c.label;
  return null;
}

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

async function fetchJson(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(9000), headers: { accept: 'application/json', 'user-agent': 'AirMaven/0.1' } });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function normalize(ac) {
  const altFt = num(ac.alt_baro) ?? num(ac.alt_geom);
  const knots = num(ac.gs);
  return {
    hex: String(ac.hex ?? '').trim().toLowerCase() || null,
    callsign: String(ac.flight ?? '').trim() || String(ac.r ?? '').trim() || null,
    type: String(ac.t ?? '').trim() || null,
    lat: num(ac.lat),
    lon: num(ac.lon),
    altFt: altFt == null ? null : Math.round(altFt),
    gsKn: knots == null ? null : Math.round(knots),
  };
}

// Returns { emergencies: [...], hva: [...] } — deduped by hex within each group.
export async function fetchAnomalies() {
  const emergencies = new Map();
  for (const sq of [7700, 7600, 7500]) {
    const j = await fetchJson(`${ADSB}/squawk/${sq}`);
    for (const ac of j?.ac ?? []) {
      const n = normalize(ac);
      if (!n.hex) continue;
      emergencies.set(n.hex, { ...n, squawk: sq, label: SQUAWK_LABEL[sq] });
    }
  }
  const hva = new Map();
  const mil = await fetchJson(`${ADSB}/mil`);
  for (const ac of mil?.ac ?? []) {
    const asset = classifyHva(ac.t);
    if (!asset) continue;
    const n = normalize(ac);
    if (!n.hex) continue;
    hva.set(n.hex, { ...n, asset });
  }
  return { emergencies: [...emergencies.values()], hva: [...hva.values()] };
}
