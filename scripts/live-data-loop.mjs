import { spawn } from 'node:child_process';
import path from 'node:path';

const defaultIntervalMs = 5 * 60 * 1000;
const minIntervalMs = 60 * 1000;
const fetchScript = path.resolve('scripts/fetch-live-data.mjs');

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const requestedIntervalMs = numberFromEnv('LIVE_FETCH_INTERVAL_MS', defaultIntervalMs);
const intervalMs = Math.max(requestedIntervalMs, minIntervalMs);
const retryIntervalMs = numberFromEnv('LIVE_FETCH_RETRY_INTERVAL_MS', minIntervalMs);
const initialDelayMs = numberFromEnv('LIVE_FETCH_INITIAL_DELAY_MS', 0);
const dryRun = process.env.LIVE_FETCH_LOOP_DRY_RUN === 'true';
let activeChild = null;
let stopping = false;

function log(message) {
  console.log(`[live-loop] ${new Date().toISOString()} ${message}`);
}

function runFetchCycle(cycle) {
  if (dryRun) {
    log(`dry-run cycle ${cycle}; would execute ${fetchScript}`);
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    log(`cycle ${cycle} start`);
    activeChild = spawn(process.execPath, [fetchScript], {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
    });

    activeChild.on('exit', (code, signal) => {
      const ok = code === 0;
      log(`cycle ${cycle} ${ok ? 'complete' : 'failed'} code=${code ?? 'null'} signal=${signal ?? 'none'}`);
      activeChild = null;
      resolve(ok);
    });

    activeChild.on('error', (error) => {
      log(`cycle ${cycle} spawn error: ${error.message}`);
      activeChild = null;
      resolve(false);
    });
  });
}

async function stop(signal) {
  if (stopping) return;
  stopping = true;
  log(`received ${signal}; stopping`);
  if (activeChild) activeChild.kill(signal);
}

process.on('SIGINT', () => { void stop('SIGINT'); });
process.on('SIGTERM', () => { void stop('SIGTERM'); });

async function main() {
  log(`starting; interval=${intervalMs}ms retry=${retryIntervalMs}ms initialDelay=${initialDelayMs}ms`);
  log('public API cadence is intentionally slower than browser polling to avoid rate-limit pressure');

  if (dryRun) {
    await runFetchCycle(1);
    log('dry-run complete');
    return;
  }

  if (initialDelayMs > 0) await sleep(initialDelayMs);

  let cycle = 1;
  while (!stopping) {
    const startedAt = Date.now();
    const ok = await runFetchCycle(cycle);
    cycle += 1;
    if (stopping) break;

    const elapsedMs = Date.now() - startedAt;
    const targetWaitMs = ok ? intervalMs : retryIntervalMs;
    const waitMs = Math.max(5_000, targetWaitMs - elapsedMs);
    log(`next cycle in ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
  }

  log('stopped');
}

main().catch((error) => {
  console.error(`[live-loop] fatal: ${error.message}`);
  process.exit(1);
});
