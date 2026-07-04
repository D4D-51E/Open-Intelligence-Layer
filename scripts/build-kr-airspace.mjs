// Generates public/data/kr-airspace.json — a supplementary GeoJSON of South Korean airspace
// that OpenAIP does not carry (OpenAIP has zero country=KR polygons). All coordinates are
// transcribed VERBATIM from the official Republic of Korea AIP (KOCA / AIM Korea), so this is
// real published aeronautical data, not hand-drawn geometry.
//
//   KADIZ  — ENR 5.2 (Air Defence Identification Zone)   https://aim.koca.go.kr/eaipPub/.../KR-ENR-5.2-en-GB.html
//   P-73   — ENR 5.1 (Prohibited Areas), Seoul            https://aim.koca.go.kr/eaipPub/.../KR-ENR-5.1-en-GB.html
//
// P-518 (DMZ) is intentionally omitted: its published boundary runs "along the Northern Limit
// Line / coastline", which cannot be rendered faithfully without the real NLL/coast geometry —
// straight-line interpolation would misrepresent a sensitive boundary. Re-run per AIRAC cycle.
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

// "DDMM" or "DDMMSS" (+ hemisphere) → decimal degrees. Longitude uses 3 leading degree digits.
function dms(token) {
  const m = /^(\d+)([NSEW])$/.exec(token.trim());
  if (!m) throw new Error(`bad coord token: ${token}`);
  const [, digits, hem] = m;
  const isLon = hem === 'E' || hem === 'W';
  const degLen = isLon ? 3 : 2;
  const deg = Number(digits.slice(0, degLen));
  const min = Number(digits.slice(degLen, degLen + 2));
  const sec = digits.length > degLen + 2 ? Number(digits.slice(degLen + 2)) : 0;
  const value = deg + min / 60 + sec / 3600;
  return hem === 'S' || hem === 'W' ? -value : value;
}
const pt = (lat, lon) => [dms(lon), dms(lat)]; // GeoJSON is [lon, lat]

// KADIZ boundary — ENR 5.2, verbatim vertex order (verified against the live eAIP source).
const kadiz = [
  pt('3900N', '12330E'), pt('3900N', '13300E'), pt('3717N', '13300E'), pt('3600N', '13030E'),
  pt('3513N', '12948E'), pt('3443N', '12909E'), pt('3417N', '12852E'), pt('3230N', '12730E'),
  pt('3230N', '12650E'), pt('3000N', '12525E'), pt('3000N', '12400E'), pt('3700N', '12400E'),
];
kadiz.push(kadiz[0]); // close ring

// P-73 (Seoul) — ENR 5.1: union of two circles, radius 2 NM, about two published centers.
const NM_KM = 1.852;
const P73_RADIUS_KM = 2 * NM_KM;
const p73Centers = [pt('373209N', '1265838E'), pt('373232N', '1265943E')];

// Great-circle destination point (accurate small-radius circle, no equirectangular distortion).
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

const feature = (type, name, source, geometry) => ({ type: 'Feature', properties: { type, name, source }, geometry });

const collection = {
  type: 'FeatureCollection',
  attribution: 'Airspace derived from the Republic of Korea AIP (KOCA / AIM Korea), ENR 5.1 & 5.2.',
  features: [
    feature('adiz', 'KADIZ', 'ROK AIP ENR 5.2', { type: 'Polygon', coordinates: [kadiz] }),
    feature('prohibited', 'P-73 (Seoul)', 'ROK AIP ENR 5.1', {
      type: 'MultiPolygon',
      coordinates: p73Centers.map((c) => [circle(c, P73_RADIUS_KM)]),
    }),
  ],
};

const outPath = path.resolve('public/data/kr-airspace.json');
await writeFile(outPath, `${JSON.stringify(collection, null, 2)}\n`);
console.log(`wrote ${outPath}: ${collection.features.length} features (KADIZ ${kadiz.length} pts, P-73 ${p73Centers.length} circles)`);
