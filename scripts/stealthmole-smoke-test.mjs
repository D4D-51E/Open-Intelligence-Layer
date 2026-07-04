#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const defaultBaseUrl = 'https://hackathon.stealthmole.com';
const userAgent = 'AirMaven-Lite-Hackathon/0.1 stealthmole-smoke-test';

function parseArgs(argv) {
  const options = {
    endpoint: 'quotas',
    limit: 1,
    cursor: 0,
    order: 'desc',
    includeGps: false,
    dryRun: false,
  };
  for (const arg of argv) {
    if (arg === '--quotas') options.endpoint = 'quotas';
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--include-gps') options.includeGps = true;
    else if (arg.startsWith('--endpoint=')) options.endpoint = arg.slice('--endpoint='.length).trim();
    else if (arg.startsWith('--query=')) options.query = arg.slice('--query='.length).trim();
    else if (arg.startsWith('--limit=')) options.limit = Number.parseInt(arg.slice('--limit='.length), 10);
    else if (arg.startsWith('--cursor=')) options.cursor = Number.parseInt(arg.slice('--cursor='.length), 10);
    else if (arg.startsWith('--base-url=')) options.baseUrl = arg.slice('--base-url='.length).trim();
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function usage() {
  return `StealthMole smoke tester (safe output only)

Usage:
  npm run test:stealthmole -- --quotas
  npm run test:stealthmole -- --endpoint=rm --query="domain:example.com" --limit=1
  npm run test:stealthmole -- --endpoint=lm --query="airport" --limit=1
  npm run test:stealthmole -- --endpoint=cds --query="domain:example.com" --limit=1 --include-gps

Environment:
  STEALTHMOLE_ACCESS_KEY   required
  STEALTHMOLE_SECRET_KEY   required
  STEALTHMOLE_BASE_URL     optional, default ${defaultBaseUrl}

Notes:
  - The script creates a new HS256 JWT per request; tokens and keys are never printed.
  - Credential-style endpoints are redacted: password/user/email values are not printed.
  - .env is loaded if present, but should remain gitignored.
`;
}

async function readEnvFile(filePath = path.resolve('.env')) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!/^[A-Z0-9_]+$/i.test(key)) continue;
      const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (process.env[key] == null) process.env[key] = value;
    }
  } catch {
    // .env is optional.
  }
}

function requireConfig(options) {
  const accessKey = process.env.STEALTHMOLE_ACCESS_KEY;
  const secretKey = process.env.STEALTHMOLE_SECRET_KEY;
  const baseUrl = (options.baseUrl || process.env.STEALTHMOLE_BASE_URL || defaultBaseUrl).replace(/\/+$/, '');
  const missing = [];
  if (!accessKey) missing.push('STEALTHMOLE_ACCESS_KEY');
  if (!secretKey) missing.push('STEALTHMOLE_SECRET_KEY');
  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(', ')}. Add them to local .env or export them in your shell.`);
  }
  return { accessKey, secretKey, baseUrl };
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createJwt({ accessKey, secretKey }) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    access_key: accessKey,
    nonce: crypto.randomUUID(),
    iat: Math.floor(Date.now() / 1000),
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = crypto.createHmac('sha256', secretKey).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

async function requestStealthMole(config, pathname, params = {}) {
  const url = new URL(pathname, `${config.baseUrl}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${createJwt(config)}`,
        'user-agent': userAgent,
      },
    });
    const text = await response.text();
    const payload = parseBody(text);
    const contentType = response.headers.get('content-type') || '';
    const looksLikeHtml = /^\s*</.test(text) || /text\/html/i.test(contentType);
    if (!response.ok) {
      const detail = typeof payload?.detail === 'string' ? payload.detail : response.statusText;
      const error = new Error(`StealthMole ${response.status}: ${detail}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    if (looksLikeHtml || !payload || typeof payload !== 'object' || Object.hasOwn(payload, 'text')) {
      const error = new Error(`StealthMole ${response.status}: expected JSON API response but received ${contentType || 'non-JSON body'}`);
      error.status = response.status;
      throw error;
    }
    return { payload, urlPath: `${url.pathname}${url.search}` };
  } finally {
    clearTimeout(timer);
  }
}

function parseBody(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return JSON.parse(trimmed);
  return { text: trimmed.slice(0, 500) };
}

function asFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function summarizeQuotas(payload) {
  const modules = {};
  for (const [moduleName, quota] of Object.entries(payload ?? {})) {
    const allowed = asFiniteNumber(quota?.allowed);
    const used = asFiniteNumber(quota?.used);
    modules[moduleName] = {
      allowed,
      used,
      remaining: allowed == null || used == null ? null : Math.max(0, allowed - used),
    };
  }
  return modules;
}

function hashId(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function domainFromUrlish(value) {
  if (!value) return undefined;
  try {
    const text = String(value);
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
    return new URL(withScheme).hostname.replace(/^www\./, '');
  } catch {
    return String(value).split('/')[0]?.replace(/^www\./, '').slice(0, 80) || undefined;
  }
}

function domainFromIdentity(value) {
  const text = String(value ?? '');
  const at = text.lastIndexOf('@');
  return at >= 0 ? text.slice(at + 1).toLowerCase().slice(0, 80) : undefined;
}

function unixToIso(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  const ms = number > 10_000_000_000 ? number : number * 1000;
  return new Date(ms).toISOString();
}

function summarizeCredentialRecord(record) {
  return {
    idHash: hashId(record?.id),
    hostDomain: domainFromUrlish(record?.host ?? record?.leaked_from),
    userDomain: domainFromIdentity(record?.user ?? record?.email),
    leakedAt: unixToIso(record?.leakeddate) ?? record?.leaked_date ?? undefined,
    hasPassword: Boolean(record?.password),
    hasGeo: Boolean(record?.geo && Number.isFinite(Number(record.geo.lat)) && Number.isFinite(Number(record.geo.lon))),
    geo: record?.geo && Number.isFinite(Number(record.geo.lat)) && Number.isFinite(Number(record.geo.lon))
      ? { lat: Number(record.geo.lat), lon: Number(record.geo.lon) }
      : undefined,
  };
}

function summarizeMonitoringRecord(endpoint, record) {
  return {
    idHash: hashId(record?.id),
    title: String(record?.title ?? record?.victim ?? 'Untitled').replace(/\s+/g, ' ').slice(0, 120),
    attackGroup: record?.attack_group ? String(record.attack_group).slice(0, 80) : undefined,
    country: record?.country ? String(record.country).slice(0, 24) : undefined,
    sector: record?.sector ? String(record.sector).slice(0, 80) : undefined,
    authorHash: endpoint === 'gm' || endpoint === 'lm' ? hashId(record?.author) : undefined,
    detectionAt: unixToIso(record?.detection_datetime),
    proofUrlAvailable: Boolean(record?.proof_url && !/not supported/i.test(String(record.proof_url))),
  };
}


function redactParams(params) {
  return Object.fromEntries(
    Object.entries(params ?? {}).map(([key, value]) => [key, key.toLowerCase() === 'query' && value ? '<redacted>' : value]),
  );
}

function summarizeSearch(endpoint, payload) {
  const data = Array.isArray(payload?.data) ? payload.data : [];
  const credentialEndpoints = new Set(['cl', 'cds', 'cb']);
  const records = data.slice(0, 5).map((record) => (
    credentialEndpoints.has(endpoint)
      ? summarizeCredentialRecord(record)
      : summarizeMonitoringRecord(endpoint, record)
  ));
  return {
    totalCount: asFiniteNumber(payload?.totalCount),
    cursor: payload?.cursor ?? null,
    limit: asFiniteNumber(payload?.limit),
    queryCost: asFiniteNumber(payload?.queryCost),
    returned: data.length,
    records,
  };
}

function buildEndpoint(options) {
  const endpoint = String(options.endpoint || 'quotas').toLowerCase();
  if (endpoint === 'quotas' || endpoint === 'user/quotas') {
    return { endpoint: 'quotas', pathname: '/user/quotas', params: {} };
  }
  const supported = new Set(['rm', 'gm', 'lm', 'cl', 'cds', 'cb']);
  if (!supported.has(endpoint)) {
    throw new Error(`Unsupported endpoint "${endpoint}" for this smoke test. Use quotas, rm, gm, lm, cl, cds, or cb.`);
  }
  const limitMax = ['rm', 'gm', 'lm'].includes(endpoint) ? 50 : 50;
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(limitMax, options.limit)) : 1;
  return {
    endpoint,
    pathname: `/${endpoint}/search`,
    params: {
      query: options.query ?? '',
      limit,
      cursor: Number.isFinite(options.cursor) ? Math.max(0, options.cursor) : 0,
      order: options.order,
      ...(endpoint === 'cds' && options.includeGps ? { includeGps: true } : {}),
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  await readEnvFile();
  const request = buildEndpoint(options);

  if (options.dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      baseUrl: (options.baseUrl || process.env.STEALTHMOLE_BASE_URL || defaultBaseUrl).replace(/\/+$/, ''),
      endpoint: request.endpoint,
      pathname: request.pathname,
      params: redactParams(request.params),
      credentialsConfigured: Boolean(process.env.STEALTHMOLE_ACCESS_KEY && process.env.STEALTHMOLE_SECRET_KEY),
      tokenPrinted: false,
    }, null, 2));
    return;
  }

  const config = requireConfig(options);
  const { payload, urlPath } = await requestStealthMole(config, request.pathname, request.params);
  const output = request.endpoint === 'quotas'
    ? { ok: true, baseUrl: config.baseUrl, endpoint: urlPath, quotas: summarizeQuotas(payload) }
    : { ok: true, baseUrl: config.baseUrl, endpoint: urlPath.replace(/query=[^&]*/i, 'query=<redacted>'), result: summarizeSearch(request.endpoint, payload) };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message,
    status: error.status ?? undefined,
    secretsPrinted: false,
  }, null, 2));
  process.exit(1);
});
