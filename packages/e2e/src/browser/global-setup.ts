import { buildWebApp, bundleWorker } from '../build.ts';

/** Builds what ships (the Worker and the setup page); the worker processes read the paths from the environment. */
export default function globalSetup(): void {
  process.env.E2E_BUNDLE_DIR = bundleWorker();
  process.env.E2E_WEB_DIR = buildWebApp();
}
