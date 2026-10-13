import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

import { AI_WORKER_SCRIPT, type MockAi } from './mock/ai.ts';
import { SITE_URL } from './mock/data.ts';
import type { MockNetwork } from './mock/moodle.ts';

const COMPATIBILITY_DATE = '2026-10-12';

export const OAUTH_SECRET = 'e2e-oauth-secret-that-is-long-enough-0123456789';

export interface LogLine {
  level: string;
  msg: string;
  [field: string]: unknown;
}

export interface WorkerOptions {
  /** Directory holding the bundled Worker, from the `bundleDir` provided by the global setup. */
  bundleDir: string;
  network: MockNetwork;
  /** Environment bindings, as in wrangler.jsonc; merged over the defaults. */
  env?: Record<string, string>;
  /** Stands in for the `AI` binding; without it the Worker has none, as under `wrangler dev --local`. */
  ai?: MockAi;
}

export interface RunningWorker {
  /** `http://host:port` of the Worker, as callers see it. */
  origin: string;
  fetch(path: string, init?: RequestInit): Promise<Response>;
  /** Every JSON log line the Worker has written so far. */
  logs(): Promise<LogLine[]>;
  /** Forgets the log lines so far (after waiting for in-flight ones), so a test sees only its own. */
  clearLogs(): Promise<void>;
  /** The Worker's raw log output, for asserting that something never appears in it. */
  rawLogs(): Promise<string>;
  stop(): Promise<void>;
}

/**
 * Runs the bundled Worker in workerd (the Cloudflare runtime) with its outbound network replaced by
 * `network`: every request the Worker makes to a Moodle site lands in the mock.
 */
export async function startWorker(options: WorkerOptions): Promise<RunningWorker> {
  const raw: string[] = [];
  const { ai } = options;
  const miniflare = new Miniflare(
    convertV4MiniflareOptions({
      handleStructuredLogs: (log) => raw.push(log.message),
      workers: [
        {
          name: 'moodle-mcp',
          modules: true,
          scriptPath: `${options.bundleDir}/worker.js`,
          modulesRoot: options.bundleDir,
          compatibilityDate: COMPATIBILITY_DATE,
          compatibilityFlags: ['nodejs_compat'],
          bindings: {
            MOODLE_URL: SITE_URL,
            ALLOWED_MOODLE_HOSTS: '',
            LOG_LEVEL: 'debug',
            ...options.env,
          },
          outboundService: (request) => options.network.fetch(request),
          ...(ai && { serviceBindings: { AI: { name: 'workers-ai', entrypoint: 'Ai' } } }),
        },
        ...(ai
          ? [
              {
                name: 'workers-ai',
                modules: true,
                script: AI_WORKER_SCRIPT,
                compatibilityDate: COMPATIBILITY_DATE,
                serviceBindings: { CONVERTER: (request: Request) => ai.handle(request) },
              },
            ]
          : []),
      ],
    }),
  );
  const origin = (await miniflare.ready).origin;

  // Miniflare ships its own copy of undici, whose types differ nominally from Node's; the values are compatible.
  const dispatch = (url: string, init: RequestInit): Promise<Response> =>
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- needed for tsc, which resolves the two undici copies separately
    miniflare.dispatchFetch(url, init as never) as unknown as Promise<Response>;

  // Log lines arrive over a separate channel from responses, so give them a moment to land.
  const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
  return {
    origin,
    fetch: (path, init) => dispatch(`${origin}${path}`, { redirect: 'manual', ...init }),
    async logs() {
      await settle();
      return raw.flatMap((line) => {
        try {
          return [JSON.parse(line) as LogLine];
        } catch {
          return [];
        }
      });
    },
    async clearLogs() {
      await settle();
      raw.length = 0;
    },
    async rawLogs() {
      await settle();
      return raw.join('\n');
    },
    stop: () => miniflare.dispose(),
  };
}
