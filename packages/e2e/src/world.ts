import { afterAll, beforeAll, beforeEach, inject } from 'vitest';

import { ALICE, BOB, OTHER_SITE_URL, OTHER_SITE_USER, SITE_URL } from './mock/data.ts';
import { MockMoodle, MockNetwork } from './mock/moodle.ts';
import { type RunningWorker, startWorker } from './worker.ts';

export interface World {
  worker: RunningWorker;
  network: MockNetwork;
  /** The Worker's default site. */
  moodle: MockMoodle;
  /** A second institution, which callers may select with the site header when the Worker allows it. */
  other: MockMoodle;
}

/**
 * Starts the real Worker with a mock Moodle behind it for the tests of the enclosing `describe`, and
 * resets the mock between tests (and, with `clearLogs`, the Worker's captured log lines). The returned object is filled in once the Worker is up.
 */
export function useWorld(env: Record<string, string> = {}, options: { clearLogs?: boolean } = {}): World {
  const moodle = new MockMoodle({ url: SITE_URL, users: [ALICE, BOB] });
  const other = new MockMoodle({ url: OTHER_SITE_URL, users: [OTHER_SITE_USER] });
  const network = new MockNetwork(moodle, other);
  const world = { network, moodle, other } as World;

  beforeAll(async () => {
    world.worker = await startWorker({ bundleDir: inject('bundleDir'), network, env });
  });
  afterAll(async () => {
    await world.worker.stop();
  });
  beforeEach(async () => {
    network.reset();
    if (options.clearLogs) await world.worker.clearLogs();
  });
  return world;
}
