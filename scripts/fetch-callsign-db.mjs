// One-shot reference-data ingest: builds public/data/aircraft-operators.json from the
// Mictronics readsb community operator database (ICAO 3-letter designators -> operator).
// This is DATA-DRIVEN — we do not hand-author callsign->operator mappings. The military
// flag is derived from the operator name/telephony by a keyword classifier over the data.
//
// Run:  node scripts/fetch-callsign-db.mjs
// Output: public/data/aircraft-operators.json  (committed reference data)

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://raw.githubusercontent.com/Mictronics/readsb/master/webapp/src/db/operators.json';
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data/aircraft-operators.json');

// Military/state-aviation keyword classifier applied to `${name} ${telephony}`.
// Sourced from generic organisation naming across languages — not a per-callsign list.
const MILITARY_PATTERNS = [
  /\bair force\b/i, /\bair forces\b/i, /\bnaval?\b/i, /\bnavy\b/i, /\barmy\b/i,
  /\bmilitary\b/i, /\bmarine corps\b/i, /\bcoast guard\b/i, /\bnational guard\b/i,
  /\bair national guard\b/i, /\bair corps\b/i, /\bair command\b/i, /\bair arm\b/i,
  /\bdefen[cs]e force\b/i, /\bgendarmerie\b/i, /\baviation regiment\b/i, /\bair wing\b/i,
  /\barmed forces\b/i, /\bair mobility\b/i, /\bair combat\b/i, /\bair guard\b/i,
  /\bair base\b/i, /\btest pilot school\b/i, /\bmobility command\b/i,
  /\btransport command\b/i, /\bstrategic command\b/i, /\bmateriel command\b/i,
  /fuerza a[eé]rea/i, /for[cç]a a[eé]rea/i, /force a[eé]rienne/i, /arm[eé]e de l/i, /luftwaffe/i,
  /aeronautica militare/i, /marina militare/i, /ej[eé]rcito/i, /воздушно/i,
  /\broyal air\b/i, /\broyal navy\b/i, /\bnato\b/i,
];

function isMilitary(name, telephony, country) {
  const hay = `${name} ${telephony} ${country}`;
  return MILITARY_PATTERNS.some((pattern) => pattern.test(hay));
}

async function main() {
  const response = await fetch(SOURCE_URL, { headers: { accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`operators.json fetch failed: HTTP ${response.status} ${response.statusText}`);
  }
  const raw = await response.json();
  const prefixes = Object.keys(raw);

  const out = {};
  let militaryCount = 0;
  for (const prefix of prefixes) {
    const entry = raw[prefix];
    if (!entry || typeof entry !== 'object') continue;
    const name = String(entry.n ?? '').trim();
    const country = String(entry.c ?? '').trim();
    const telephony = String(entry.r ?? '').trim();
    if (!name) continue;
    const mil = isMilitary(name, telephony, country);
    if (mil) militaryCount += 1;
    out[prefix.toUpperCase()] = { n: name, c: country, r: telephony, m: mil ? 1 : 0 };
  }

  const payload = {
    source: SOURCE_URL,
    generatedAt: new Date().toISOString(),
    count: Object.keys(out).length,
    militaryCount,
    operators: out,
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, JSON.stringify(payload), 'utf8');
  console.log(`[callsign-db] wrote ${payload.count} operators (${militaryCount} military-classified) -> ${OUT_PATH}`);
}

main().catch((error) => {
  console.error('[callsign-db] failed:', error);
  process.exit(1);
});
