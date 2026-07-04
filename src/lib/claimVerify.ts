// Claim verification / reliability scoring — ported & adapted from IRONSIGHT's ClaimVerifyPanel.
// Cross-checks each geolocated Telegram claim against independent corroboration and produces a
// verdict + a 0–100 confidence + an evidence ledger. AirMaven has no GeoConfirmed feed, so the
// two independent source types here are THERMAL (NASA FIRMS) and CROSS-SOURCE (other channels
// reporting the same place & time). TRUE requires ≥2 independent types; a single source caps at
// LIKELY; FALSE is reserved for an extraordinary claim with the expected signal absent (never
// mere absence of data).
import type { ThermalAnomaly } from './types';

export type Verdict = 'TRUE' | 'LIKELY' | 'NOT LIKELY' | 'FALSE';

export const VERDICT_COLOR: Record<Verdict, string> = {
  TRUE: '#22cc66',
  LIKELY: '#ffcc33',
  'NOT LIKELY': '#ff8833',
  FALSE: '#ff3355',
};

export type LedgerItem = { label: string; detail: string; points: number };

export type TelegramLike = { channelLabel: string; color: string; text: string; date: string; url?: string };

export type AssessedClaim = {
  key: string;
  channel: string;
  color: string;
  text: string;
  date: string;
  url?: string;
  place: string;
  verdict: Verdict;
  confidence: number;
  evidence: string;
  ledger: LedgerItem[];
};

// Conflict-region gazetteer (Middle East + Ukraine/Russia) matched against claim text.
const PLACES: Array<[string, number, number]> = [
  ['tel aviv', 32.09, 34.78], ['jerusalem', 31.77, 35.21], ['haifa', 32.79, 34.99], ['ashkelon', 31.67, 34.57],
  ['ashdod', 31.80, 34.66], ['beersheba', 31.25, 34.79], ['beer sheva', 31.25, 34.79], ['eilat', 29.56, 34.95],
  ['sderot', 31.52, 34.60], ['dimona', 31.07, 35.03], ['nahariya', 33.01, 35.09], ['tiberias', 32.79, 35.53],
  ['gaza', 31.42, 34.36], ['rafah', 31.29, 34.24], ['khan yunis', 31.34, 34.30], ['khan younis', 31.34, 34.30],
  ['jabalia', 31.53, 34.48], ['deir al-balah', 31.42, 34.35], ['beit lahia', 31.55, 34.50],
  ['beirut', 33.89, 35.50], ['dahiyeh', 33.85, 35.50], ['tyre', 33.27, 35.20], ['sidon', 33.56, 35.37],
  ['nabatieh', 33.38, 35.48], ['baalbek', 34.00, 36.21], ['yater', 33.15, 35.33], ['bint jbeil', 33.12, 35.43],
  ['south lebanon', 33.27, 35.20], ['naqoura', 33.11, 35.13],
  ['damascus', 33.51, 36.29], ['aleppo', 36.20, 37.16], ['homs', 34.73, 36.71], ['latakia', 35.53, 35.79],
  ['tehran', 35.69, 51.39], ['isfahan', 32.65, 51.67], ['natanz', 33.72, 51.90], ['fordow', 34.88, 50.99],
  ['bushehr', 28.97, 50.84], ['bandar abbas', 27.19, 56.28], ['tabriz', 38.08, 46.29], ['shiraz', 29.59, 52.58],
  ['baghdad', 33.31, 44.36], ['erbil', 36.19, 44.01], ['mosul', 36.34, 43.13],
  ["sana'a", 15.37, 44.19], ['sanaa', 15.37, 44.19], ['hodeidah', 14.80, 42.95], ['saada', 16.94, 43.76],
  ['red sea', 20.0, 38.0], ['bab al-mandeb', 12.6, 43.4], ['hormuz', 26.57, 56.25],
  ['kyiv', 50.45, 30.52], ['kiev', 50.45, 30.52], ['kharkiv', 49.99, 36.23], ['kharkov', 49.99, 36.23],
  ['dnipro', 48.46, 35.05], ['zaporizhzhia', 47.84, 35.14], ['zaporozhye', 47.84, 35.14],
  ['kherson', 46.64, 32.61], ['odesa', 46.48, 30.72], ['odessa', 46.48, 30.72], ['mykolaiv', 46.98, 31.99],
  ['lviv', 49.84, 24.03], ['donetsk', 48.02, 37.80], ['bakhmut', 48.60, 38.00], ['pokrovsk', 48.28, 37.18],
  ['avdiivka', 48.14, 37.75], ['kramatorsk', 48.72, 37.55], ['sloviansk', 48.85, 37.61], ['mariupol', 47.10, 37.55],
  ['sumy', 50.91, 34.80], ['chernihiv', 51.49, 31.29], ['sevastopol', 44.62, 33.53], ['crimea', 45.3, 34.4],
  ['belgorod', 50.60, 36.59], ['kursk', 51.73, 36.19], ['bryansk', 53.25, 34.37],
];

export function geolocate(text: string): { place: string; lat: number; lon: number } | null {
  const t = text.toLowerCase();
  for (const [name, lat, lon] of PLACES) {
    if (t.includes(name)) return { place: name.replace(/\b\w/g, (c) => c.toUpperCase()), lat, lon };
  }
  return null;
}

export function distKm(aLa: number, aLo: number, bLa: number, bLo: number): number {
  const R = 6371;
  const toR = Math.PI / 180;
  const dLa = (bLa - aLa) * toR;
  const dLo = (bLo - aLo) * toR;
  const s = Math.sin(dLa / 2) ** 2 + Math.cos(aLa * toR) * Math.cos(bLa * toR) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const decay = (x: number, scale: number) => Math.exp(-x / scale);

const TH_SCALE_KM = 12;
const TH_MAX_KM = 30;
const TH_FRP_REF = 60;
const TH_BASE = 25;
const TH_PRE_H = 3;
const TH_POST_H = 36;

const XCH_KM = 25;
const XCH_H = 12;
const XCH_PER = 10;
const XCH_MAX = 30;

const STALE_HOURS = 48;
const MAJOR_CLAIM = /destroy|level(?:ed|led)|wiped?\s?out|completely|obliterat|razed|annihilat|flatten/i;

export type CorpusPost = { channel: string; lat: number; lon: number; t: number };

// Cross-check one geolocated claim against thermal hotspots + independent channels.
export function assess(
  loc: { lat: number; lon: number },
  claimT: number,
  claimText: string,
  selfChannel: string,
  thermals: ThermalAnomaly[],
  corpus: CorpusPost[],
  now: number,
): { verdict: Verdict; confidence: number; evidence: string; ledger: LedgerItem[] } {
  const ledger: LedgerItem[] = [];
  const sources = new Set<string>();
  let confidence = 0;

  // 1) Thermal hotspot — causally gated (hotspot at/after the claimed strike time).
  let bestTh: ThermalAnomaly | null = null;
  let bestThPts = 0;
  let bestThDist = 0;
  let bestThDh = 0;
  for (const h of thermals) {
    const d = distKm(loc.lat, loc.lon, h.lat, h.lon);
    if (d > TH_MAX_KM) continue;
    const ht = new Date(h.observedAt).getTime();
    if (Number.isNaN(ht)) continue;
    const dh = (ht - claimT) / 36e5;
    if (dh < -TH_PRE_H || dh > TH_POST_H) continue;
    const strength = Math.min(1, (h.frpMw ?? 0) / TH_FRP_REF);
    const pts = Math.min(TH_BASE * 1.5, TH_BASE * strength * decay(d, TH_SCALE_KM));
    if (pts > bestThPts) { bestThPts = pts; bestTh = h; bestThDist = d; bestThDh = dh; }
  }
  if (bestTh && bestThPts >= 5) {
    confidence += bestThPts;
    sources.add('thermal');
    ledger.push({ label: 'Thermal', detail: `FRP ${Math.round(bestTh.frpMw ?? 0)}MW · ${bestThDist.toFixed(0)}km · ${bestThDh >= 0 ? '+' : ''}${bestThDh.toFixed(0)}h`, points: Math.round(bestThPts) });
  }

  // 2) Cross-channel corroboration — other independent channels, same place & time.
  const otherCh = new Set<string>();
  for (const o of corpus) {
    if (o.channel === selfChannel) continue;
    if (distKm(loc.lat, loc.lon, o.lat, o.lon) > XCH_KM) continue;
    if (Math.abs(o.t - claimT) / 36e5 > XCH_H) continue;
    otherCh.add(o.channel);
  }
  if (otherCh.size > 0) {
    const pts = Math.min(XCH_MAX, otherCh.size * XCH_PER);
    confidence += pts;
    sources.add('xchan');
    ledger.push({ label: 'Cross-source', detail: `${otherCh.size} other channel${otherCh.size > 1 ? 's' : ''} report same place ±${XCH_H}h`, points: pts });
  }

  confidence = Math.min(100, Math.round(confidence));
  const nTypes = sources.size;
  const ageH = (now - claimT) / 36e5;

  let verdict: Verdict;
  if (confidence >= 65 && nTypes >= 2) verdict = 'TRUE';
  else if (confidence >= 30) verdict = 'LIKELY';
  else if (MAJOR_CLAIM.test(claimText) && !Number.isNaN(ageH) && ageH > STALE_HOURS && confidence < 8) {
    verdict = 'FALSE';
    ledger.push({ label: 'Contradiction', detail: `extraordinary claim, zero thermal/cross signal ${Math.round(ageH / 24)}d later`, points: 0 });
  } else verdict = 'NOT LIKELY';

  if (ledger.length === 0) {
    ledger.push({ label: 'None', detail: `no corroboration in coverage${!Number.isNaN(ageH) && ageH > STALE_HOURS ? ` (${Math.round(ageH / 24)}d old)` : ' (recent)'}`, points: 0 });
  }

  const positive = ledger.filter((l) => l.points > 0);
  const evidence = positive.length ? positive.map((l) => `${l.label}: ${l.detail}`).join('  |  ') : ledger[0].detail;
  return { verdict, confidence, evidence, ledger };
}

// Geolocate + assess a full set of Telegram posts → sorted assessed claims.
export function assessClaims(posts: TelegramLike[], thermals: ThermalAnomaly[], now: number): AssessedClaim[] {
  const geo = posts
    .map((p) => ({ post: p, loc: geolocate(p.text), t: new Date(p.date).getTime() }))
    .filter((g): g is { post: TelegramLike; loc: { place: string; lat: number; lon: number }; t: number } => g.loc != null);
  if (!geo.length) return [];
  const corpus: CorpusPost[] = geo.map((g) => ({ channel: g.post.channelLabel, lat: g.loc.lat, lon: g.loc.lon, t: g.t }));
  const seen = new Set<string>();
  const out: AssessedClaim[] = [];
  for (const g of geo) {
    const key = `${g.post.text.slice(0, 50).toLowerCase()}|${g.loc.place}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const a = assess({ lat: g.loc.lat, lon: g.loc.lon }, g.t, g.post.text, g.post.channelLabel, thermals, corpus, now);
    out.push({ key, channel: g.post.channelLabel, color: g.post.color, text: g.post.text, date: g.post.date, url: g.post.url, place: g.loc.place, ...a });
  }
  const order: Verdict[] = ['TRUE', 'LIKELY', 'NOT LIKELY', 'FALSE'];
  out.sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || b.confidence - a.confidence || new Date(b.date).getTime() - new Date(a.date).getTime());
  return out.slice(0, 40);
}
