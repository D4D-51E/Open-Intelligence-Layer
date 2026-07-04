// Generates public/data/kr-airspace.json — supplementary South Korean airspace that OpenAIP
// does not carry (zero country=KR polygons). ALL geometry comes from the official Republic of
// Korea AIP (KOCA / AIM Korea) eAIP, so this is real published aeronautical data, not hand-drawn.
//
//   KADIZ                         — ENR 5.2 (verified against the live eAIP; hardcoded anchor)
//   P-73 (Seoul)                  — ENR 5.1 (two 2 NM circles; hardcoded anchor)
//   Prohibited/Restricted/Danger  — ENR 5.1 (parsed: circles + polygons)
//   TMA / CTA / control sectors   — ENR 2.1 (parsed: polygons)
//
// Conservative parser: only CLEAN circles and CLEAN vertex-list polygons are emitted. Anything
// defined "along the NLL / MDL / coastline", by an arc, or as a composite ("including areas…")
// is SKIPPED and counted — straight-line interpolation of those would misrepresent the boundary.
// AIRAC package date is fixed below; bump it and re-run each cycle.  Run: node scripts/build-kr-airspace.mjs
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const AIRAC = '2024-03-07';
const eaipUrl = (section) => `https://aim.koca.go.kr/eaipPub/Package/${AIRAC}/html/eAIP/KR-ENR-${section}-en-GB.html`;
const NM_KM = 1.852;

// ---- coordinate + geometry helpers -----------------------------------------------------------

// "DDMM[SS[.s]]" (+ hemisphere); longitude uses 3 leading degree digits. → decimal degrees.
function dms(digits, hem) {
  const isLon = hem === 'E' || hem === 'W';
  const degLen = isLon ? 3 : 2;
  const deg = Number(digits.slice(0, degLen));
  const min = Number(digits.slice(degLen, degLen + 2));
  const sec = digits.length > degLen + 2 ? Number(digits.slice(degLen + 2)) : 0;
  const value = deg + min / 60 + sec / 3600;
  return hem === 'S' || hem === 'W' ? -value : value;
}
const pt = (lat, lon) => [dms(lon.slice(0, -1), lon.slice(-1)), dms(lat.slice(0, -1), lat.slice(-1))];

// All "DDMMSS N DDDMMSS E" vertex pairs in a text blob → [[lon, lat], ...].
const COORD_RE = /(\d{4,7}(?:\.\d+)?[NS])\s*[- ]?\s*(\d{5,8}(?:\.\d+)?[EW])/g;
function coordsIn(text) {
  const out = [];
  for (const m of text.matchAll(COORD_RE)) out.push(pt(m[1], m[2]));
  return out;
}

// Great-circle circle ring about [lon, lat].
function circle([lon, lat], radiusKm, steps = 72) {
  const R = 6371;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const δ = radiusKm / R;
  const ring = [];
  for (let i = 0; i <= steps; i += 1) {
    const θ = (i / steps) * 2 * Math.PI;
    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
    const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
    ring.push([(λ2 * 180) / Math.PI, (φ2 * 180) / Math.PI]);
  }
  return ring;
}

function closeRing(ring) {
  const [a, b] = [ring[0], ring[ring.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? ring : [...ring, a];
}

// ---- eAIP HTML parsing ------------------------------------------------------------------------

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

// Split a section into airspace blocks keyed by their <strong> name; body = text up to next <strong>.
function extractAreas(html) {
  const parts = html.split(/<strong[^>]*>/i).slice(1);
  return parts.map((part) => {
    const nameHtml = part.slice(0, part.indexOf('</strong>'));
    const rest = part.slice(part.indexOf('</strong>') + 9);
    const name = decodeEntities(nameHtml.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')).trim();
    const body = decodeEntities(rest.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')).trim();
    return { name, body };
  });
}

const UNREPRESENTABLE = /along the|arc\b|including areas|remainder|to the beginning[\s\S]*along/i;

// Parse one area's boundary text → GeoJSON geometry, or null if not cleanly representable.
function parseGeometry(body) {
  const head = body.slice(0, 400); // boundary text precedes vertical limits / class / remarks
  if (UNREPRESENTABLE.test(head)) return null;

  const isCircle = /\bcircle\b/i.test(head) || /radius/i.test(head) || /diameter/i.test(head);
  if (isCircle) {
    const nm = head.match(/([\d.]+)\s*N\.?M\.?/i) ?? head.match(/([\d.]+)\s*miles?/i);
    const centers = coordsIn(head);
    if (!nm || centers.length === 0) return null;
    let radiusKm = Number(nm[1]) * NM_KM;
    if (/diameter/i.test(head)) radiusKm /= 2;
    if (!(radiusKm > 0)) return null;
    if (centers.length >= 2 && /center\s*1/i.test(head)) {
      return { type: 'MultiPolygon', coordinates: centers.map((c) => [circle(c, radiusKm)]) };
    }
    return { type: 'Polygon', coordinates: [circle(centers[0], radiusKm)] };
  }

  const verts = coordsIn(head);
  if (verts.length >= 3) return { type: 'Polygon', coordinates: [closeRing(verts)] };
  return null;
}

function classify5_1(name) {
  if (/\bP\s*\d/i.test(name)) return 'prohibited';
  if (/\bR\s*\d/i.test(name)) return 'restricted';
  if (/\bD\s*\d/i.test(name)) return 'danger';
  return null;
}

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'AirMaven/0.1', accept: 'text/html' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ---- verified anchors (hardcoded from ENR 5.2 / 5.1, independent of the parser) ---------------

const feature = (type, name, source, geometry) => ({ type: 'Feature', properties: { type, name, source }, geometry });

const kadiz = [
  pt('3900N', '12330E'), pt('3900N', '13300E'), pt('3717N', '13300E'), pt('3600N', '13030E'),
  pt('3513N', '12948E'), pt('3443N', '12909E'), pt('3417N', '12852E'), pt('3230N', '12730E'),
  pt('3230N', '12650E'), pt('3000N', '12525E'), pt('3000N', '12400E'), pt('3700N', '12400E'),
];
kadiz.push(kadiz[0]);
const p73 = [pt('373209N', '1265838E'), pt('373232N', '1265943E')].map((c) => [circle(c, 2 * NM_KM)]);

const anchors = [
  feature('adiz', 'KADIZ', 'ROK AIP ENR 5.2', { type: 'Polygon', coordinates: [kadiz] }),
  feature('prohibited', 'P-73 (Seoul)', 'ROK AIP ENR 5.1', { type: 'MultiPolygon', coordinates: p73 }),
];

// ---- run --------------------------------------------------------------------------------------

const features = [...anchors];
const stats = { anchors: anchors.length, restricted: 0, danger: 0, prohibited: 0, tma: 0, skipped: 0 };

// ENR 5.1 — Prohibited / Restricted / Danger areas.
for (const area of extractAreas(await fetchHtml(eaipUrl('5.1')))) {
  if (!/^RK\s/i.test(area.name)) continue;
  if (/P\s*73|P\s*518/i.test(area.name)) continue; // covered by anchors / unrepresentable
  const type = classify5_1(area.name);
  if (!type) continue;
  const geometry = parseGeometry(area.body);
  if (!geometry) { stats.skipped += 1; continue; }
  features.push(feature(type, area.name.replace(/^RK\s+/i, ''), 'ROK AIP ENR 5.1', geometry));
  stats[type] += 1;
}

// ENR 2.1 — TMA / CTA / control sectors (polygons only).
for (const area of extractAreas(await fetchHtml(eaipUrl('2.1')))) {
  if (!area.name || /FIR/i.test(area.name)) continue; // FIR follows the NLL → skip
  const geometry = parseGeometry(area.body);
  if (!geometry || geometry.type !== 'Polygon') { if (coordsIn(area.body.slice(0, 400)).length) stats.skipped += 1; continue; }
  features.push(feature('tma', area.name, 'ROK AIP ENR 2.1', geometry));
  stats.tma += 1;
}

const collection = {
  type: 'FeatureCollection',
  attribution: 'Airspace derived from the Republic of Korea AIP (KOCA / AIM Korea), ENR 2.1 / 5.1 / 5.2.',
  airac: AIRAC,
  features,
};

const outPath = path.resolve('public/data/kr-airspace.json');
await writeFile(outPath, `${JSON.stringify(collection, null, 2)}\n`);
console.log(`wrote ${outPath}: ${features.length} features`, JSON.stringify(stats));
