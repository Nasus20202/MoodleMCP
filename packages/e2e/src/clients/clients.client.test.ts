import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { type Stack, startStack } from '../browser/stack.ts';
import { McpClient } from '../mcp.ts';
import { ALICE, COURSE_ALG, FILE_URLS, IDS } from '../mock/data.ts';
import { type ClientDriver, DRIVERS, installed } from './drivers.ts';
import { type FakeModel, startFakeModel, type Step } from './fake-model.ts';
import { approveAuthorization, authorizationUrl } from './oauth.ts';
import { run, type RunResult } from './run.ts';

/*
 * The verification matrix: each coding-agent CLI (rows) is pointed at the real Worker over HTTP, once with the
 * token in its MCP configuration and, where the CLI can sign in without a terminal, once through OAuth. A scripted
 * model (see fake-model.ts) makes the CLI call the tools below, so no model account or login is involved.
 * Each tool is a column: did the call reach Moodle, and did the result come back to the model?
 */

const SITE_INFO = 'core_webservice_get_site_info';

interface ToolCase extends Step {
  /** The Moodle functions the Worker must call; none means the call downloads a file. */
  moodle: string[];
  /** Text the model must get back. */
  returns: string;
  /** Set when the model must also get an image back, not only the description of one. */
  image?: true;
}

const CASES: ToolCase[] = [
  { tool: 'get_site_info', args: {}, moodle: [SITE_INFO], returns: 'Alice Anderson' },
  {
    tool: 'list_courses',
    args: {},
    moodle: [SITE_INFO, 'core_enrol_get_users_courses'],
    returns: 'Databases',
  },
  {
    tool: 'search_courses',
    args: { query: 'DATABASES' },
    moodle: ['core_course_search_courses'],
    returns: 'Databases',
  },
  {
    tool: 'get_course_contents',
    args: { course_id: COURSE_ALG },
    moodle: ['core_course_get_contents'],
    returns: 'notes.txt',
  },
  {
    tool: 'get_quiz_attempts',
    args: { quiz_id: IDS.quiz },
    moodle: [SITE_INFO, 'mod_quiz_get_user_attempts'],
    returns: 'finished',
  },
  { tool: 'read_file', args: { file_url: FILE_URLS.notes }, moodle: [], returns: 'Big-O notes' },
  { tool: 'read_file', args: { file_url: FILE_URLS.pixel }, moodle: [], returns: 'pixel.png', image: true },
];

type Auth = 'token' | 'oauth';
const AUTH_LABEL: Record<Auth, string> = { token: 'token in the config', oauth: 'OAuth sign-in' };

/** `E2E_CLIENTS=codex,claude` runs only those rows (CI runs one per job, each with only its CLI installed). */
const SELECTED = process.env.E2E_CLIENTS?.split(',').map((name) => name.trim());

const MATRIX = DRIVERS.filter((driver) => !SELECTED || SELECTED.includes(driver.command)).flatMap((driver) =>
  (['token', 'oauth'] as const)
    .filter((auth) => auth === 'token' || driver.login)
    .map((auth) => ({ driver, auth, name: `${driver.name}, ${AUTH_LABEL[auth]}` })),
);

/** Set where the CLIs are meant to be installed (CI), so that a missing one fails instead of skipping. */
const REQUIRED = !!process.env.E2E_REQUIRE_CLIENTS;
const RUN_TIMEOUT_MS = 90_000;

const environment = (driver: ClientDriver, setup: Parameters<ClientDriver['env']>[0]) => ({
  PATH: process.env.PATH ?? '',
  ...driver.env(setup),
});

describe.each(MATRIX)('$name', ({ driver, auth }) => {
  const version = installed(driver.command);
  let stack: Stack;
  let model: FakeModel;
  let result: RunResult;
  let signIn: RunResult | undefined;
  let home: string;
  /** What reached Moodle during the run. */
  let moodleCalls: { fn: string | undefined; token: string | undefined }[];
  let downloads: (string | undefined)[];

  if (!version && REQUIRED) it('is installed', () => expect.fail(`${driver.command} is not on PATH`));

  describe.skipIf(!version)(`(${version})`, () => {
    beforeAll(
      async () => {
        home = mkdtempSync(join(tmpdir(), `mcp-client-${driver.command}-`));
        const cwd = join(home, 'work');
        mkdirSync(cwd);
        stack = await startStack({ bundleDir: inject('bundleDir'), webDir: inject('webDir'), oauth: true });
        model = await startFakeModel(driver.invoker, CASES);
        const setup = {
          modelUrl: model.url,
          mcpUrl: `${stack.url}/mcp`,
          token: auth === 'token' ? ALICE.token : undefined,
          home,
        };
        const env = environment(driver, setup);

        if (auth === 'oauth' && driver.login) {
          let approval: Promise<void> | undefined;
          signIn = await run(driver.login.command ?? driver.command, driver.login.args(setup), {
            env,
            cwd,
            timeoutMs: RUN_TIMEOUT_MS,
            openStdin: true,
            onOutput: (output) => {
              const url = authorizationUrl(output);
              if (url && !approval) approval = approveAuthorization(url);
            },
          });
          await approval;
          await driver.login.cleanup?.(setup);
          stack.network.reset();
        }

        result = await run(driver.command, driver.args(setup), { env, cwd, timeoutMs: RUN_TIMEOUT_MS });
        moodleCalls = stack.moodle.restCalls.map((call) => ({ fn: call.fn, token: call.token }));
        downloads = stack.moodle.requests.filter((r) => r.kind === 'file').map((r) => r.token);
      },
      RUN_TIMEOUT_MS * 2 + 10_000,
    );

    afterAll(async () => {
      await model.stop();
      await stack.stop();
      if (!process.env.E2E_KEEP_HOME) rmSync(home, { recursive: true, force: true });
    });

    if (auth === 'oauth') {
      it('signs in through the consent flow', () => {
        const tail = `${signIn?.stdout.slice(-1500)}\n${signIn?.stderr.slice(-1500)}`;
        expect(signIn?.timedOut, tail).toBe(false);
        expect(signIn?.code, tail).toBe(0);
      });
    }

    it('runs the scripted session to the end', () => {
      const tail = `${result.stdout.slice(-1500)}\n${result.stderr.slice(-1500)}`;
      expect(result.timedOut, tail).toBe(false);
      expect(result.code, tail).toBe(0);
      expect(model.transcript.stuckOn, 'the client never offered this tool').toBeUndefined();
    });

    it.skipIf(!driver.listsAllTools)('is offered every tool the server has', async () => {
      const served = (await McpClient.bearer(stack.worker, ALICE.token).listTools()).map((tool) => tool.name);
      expect(served.length).toBeGreaterThan(CASES.length);
      expect([...model.transcript.offered].sort()).toEqual(served.sort());
    });

    it('acts with the signed-in user’s Moodle token and no other', () => {
      expect(moodleCalls.length + downloads.length).toBeGreaterThan(0);
      for (const token of [...moodleCalls.map((c) => c.token), ...downloads]) expect(token).toBe(ALICE.token);
    });

    describe.each(CASES)('$tool', (step) => {
      it('reaches Moodle through the Worker', () => {
        if (step.moodle.length === 0) return expect(downloads.length).toBeGreaterThan(0);
        for (const fn of step.moodle) expect(moodleCalls.map((c) => c.fn)).toContain(fn);
      });

      it('returns the result to the model', () => {
        const output = model.transcript.outputs[CASES.indexOf(step)];
        expect(output, 'the client never sent the tool result back').toBeDefined();
        expect(output?.text).toContain(step.returns);
      });

      it.runIf(step.image && driver.forwardsImages)('shows the model the image', () => {
        expect(model.transcript.outputs[CASES.indexOf(step)]?.images).toBeGreaterThan(0);
      });
    });
  });
});
