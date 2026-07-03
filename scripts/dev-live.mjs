import { spawn } from 'node:child_process';

const children = new Set();
let stopping = false;

function spawnProcess(name, command, args) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  children.add(child);

  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.log(`[dev-live] ${name} exited code=${code ?? 'null'} signal=${signal ?? 'none'}; stopping remaining processes`);
      stopAll(signal || 'SIGTERM', code ?? 0);
    }
  });

  child.on('error', (error) => {
    children.delete(child);
    console.error(`[dev-live] ${name} failed: ${error.message}`);
    stopAll('SIGTERM', 1);
  });

  return child;
}

function stopAll(signal = 'SIGTERM', exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    child.kill(signal);
  }
  setTimeout(() => process.exit(exitCode), 250);
}

process.on('SIGINT', () => stopAll('SIGINT', 0));
process.on('SIGTERM', () => stopAll('SIGTERM', 0));

console.log('[dev-live] starting Vite dev server and live data refresh loop');
const viteArgs = process.argv.slice(2);
const viteCommand = ['run', 'dev:vite'];
if (viteArgs.length > 0) viteCommand.push('--', ...viteArgs);
spawnProcess('live loop', process.execPath, ['scripts/live-data-loop.mjs']);
spawnProcess('vite', 'npm', viteCommand);
