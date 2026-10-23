import type { TestProject } from 'vitest/node';

import { buildWebApp, bundleWorker } from '../build.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Directory with the bundled Worker (`worker.js`). */
    bundleDir: string;
    /** Directory with the built setup page and consent screen, which the Worker's assets would serve. */
    webDir: string;
  }
}

export default function setup(project: TestProject): void {
  project.provide('bundleDir', bundleWorker());
  project.provide('webDir', buildWebApp());
}
