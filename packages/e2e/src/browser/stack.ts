import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize } from 'node:path';

import { ALICE, BOB, OTHER_SITE_URL, OTHER_SITE_USER, SITE_URL } from '../mock/data.ts';
import { MockMoodle, MockNetwork } from '../mock/moodle.ts';
import { OAUTH_SECRET, type RunningWorker, startWorker } from '../worker.ts';

/** The paths wrangler.jsonc runs the Worker for (`run_worker_first`); everything else is a static asset. */
const WORKER_PREFIXES = ['/mcp', '/api/', '/oauth/', '/.well-known/'];

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

export interface Stack {
  /** The deployment as a browser sees it: static setup page and Worker on one origin. */
  url: string;
  worker: RunningWorker;
  network: MockNetwork;
  moodle: MockMoodle;
  other: MockMoodle;
  stop(): Promise<void>;
}

export interface StackOptions {
  bundleDir: string;
  webDir: string;
  oauth: boolean;
}

/** Reads Cloudflare's `_headers` file (path rules followed by indented `Name: value` lines) into path → headers. */
function parseHeaders(text: string): Map<string, Record<string, string>> {
  const rules = new Map<string, Record<string, string>>();
  let current: Record<string, string> | undefined;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.startsWith('#')) continue;
    if (/^\s/.test(line)) {
      const [name, ...value] = line.trim().split(':');
      if (current && name) current[name] = value.join(':').trim();
    } else {
      current = {};
      rules.set(line.trim(), current);
    }
  }
  return rules;
}

const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

/**
 * The whole product on localhost: the built setup page served as static assets, in front of the bundled
 * Worker (in workerd) talking to a mock Moodle. Routing follows wrangler.jsonc: Worker paths go to the Worker,
 * and any other path is an asset, falling back to index.html like `not_found_handling: single-page-application`.
 */
export async function startStack(options: StackOptions): Promise<Stack> {
  const moodle = new MockMoodle({ url: SITE_URL, users: [ALICE, BOB] });
  const other = new MockMoodle({ url: OTHER_SITE_URL, users: [OTHER_SITE_USER] });
  const network = new MockNetwork(moodle, other);
  const worker = await startWorker({
    bundleDir: options.bundleDir,
    network,
    env: { ALLOWED_MOODLE_HOSTS: '*', ...(options.oauth && { OAUTH_SECRET }) },
  });

  const assetHeaders = parseHeaders(await readFile(join(options.webDir, '_headers'), 'utf8').catch(() => ''));

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (
        WORKER_PREFIXES.some(
          (p) => url.pathname === p || url.pathname.startsWith(p.endsWith('/') ? p : `${p}/`),
        )
      ) {
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);
        const headers = Object.fromEntries(
          Object.entries(req.headers).flatMap(([k, v]) =>
            typeof v === 'string' && !['host', 'connection', 'content-length'].includes(k) ? [[k, v]] : [],
          ),
        );
        const reply = await worker.fetch(`${url.pathname}${url.search}`, {
          method: req.method ?? 'GET',
          headers,
          ...(body && { body: new Uint8Array(body) }),
        });
        res.writeHead(reply.status, Object.fromEntries(reply.headers));
        res.end(Buffer.from(await reply.arrayBuffer()));
        return;
      }
      const relative = normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
      let file = join(options.webDir, relative);
      let content: Buffer;
      try {
        content = await readFile(file);
      } catch {
        file = join(options.webDir, 'index.html');
        content = await readFile(file);
      }
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        ...assetHeaders.get(url.pathname),
      });
      res.end(content);
    })().catch((error: unknown) => {
      res.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    worker,
    network,
    moodle,
    other,
    async stop() {
      server.close();
      await worker.stop();
    },
  };
}
