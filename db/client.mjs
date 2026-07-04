import { neon } from '@neondatabase/serverless';

// Single Neon HTTP SQL client. Works in Node scripts and Vercel serverless functions.
// DATABASE_URL is provided via `node --env-file=.env` locally or Vercel env in production.
export function getSql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return neon(url);
}
