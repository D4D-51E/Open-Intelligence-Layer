// Apply db/schema.sql to Neon (idempotent). Run: node --env-file=.env scripts/db-migrate.mjs
import { readFileSync } from 'node:fs';
import { getSql } from '../db/client.mjs';

const sql = getSql();
const text = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
// Strip comment lines, then split on statement terminators (schema has no ';' inside statements).
const statements = text.replace(/^\s*--.*$/gm, '').split(';').map((s) => s.trim()).filter(Boolean);

for (const stmt of statements) {
  await sql.query(stmt);
}
console.log(`[db:migrate] applied ${statements.length} statements`);
