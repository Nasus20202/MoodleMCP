import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(packageDir, '../..');

/** Bundles the real Worker, exactly as `wrangler deploy` would, so the tests run what ships. */
export function bundleWorker(): string {
  const bundleDir = resolve(packageDir, '.wrangler/e2e-bundle');
  mkdirSync(bundleDir, { recursive: true });
  execFileSync(resolve(root, 'node_modules/.bin/wrangler'), ['deploy', '--dry-run', '--outdir', bundleDir], {
    cwd: packageDir,
    stdio: 'pipe',
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  return bundleDir;
}

/** Builds the setup page the way the deploy does and returns the directory the Worker serves as assets. */
export function buildWebApp(): string {
  const webDir = resolve(root, 'packages/web');
  execFileSync(resolve(root, 'node_modules/.bin/vite'), ['build'], { cwd: webDir, stdio: 'pipe' });
  return resolve(webDir, 'dist');
}
