import type { TestProject } from 'vitest/node';

import { bundleWorker } from './build.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Directory with the bundled Worker (`worker.js`). */
    bundleDir: string;
  }
}

export default function setup(project: TestProject): void {
  project.provide('bundleDir', bundleWorker());
}
