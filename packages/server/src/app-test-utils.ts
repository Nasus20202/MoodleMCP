import type { ErrorResponse } from '@moodle-mcp/shared';

import { type AppDeps, createApp } from './app.ts';
import { createLogger } from './logger.ts';
import { fakeMoodle, type RecordedCall, testConfig } from './test-utils.ts';

/** Helpers for tests that drive the whole app: its MCP endpoint over HTTP, against a fake Moodle. */

export const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

export interface RpcResponse {
  result?: {
    tools?: { name: string; annotations?: { readOnlyHint?: boolean } }[];
    content?: { text: string; type?: string; resource?: unknown }[];
    isError?: boolean;
  };
  error?: { message: string };
}

/** The app wired to a fake Moodle that answers with `respond`, collecting its log lines. */
export function setup(
  respond: (call: RecordedCall) => unknown = () => ({}),
  config = testConfig(),
  deps: Pick<AppDeps, 'markdown'> = {},
) {
  const moodle = fakeMoodle(respond);
  const logs: string[] = [];
  const logger = createLogger('debug', (_l, line) => logs.push(line));
  const app = createApp(config, { fetch: moodle.fetch, logger, ...deps });
  return { app, moodle, logs };
}

export interface RpcReply {
  status: number;
  headers: Headers;
  /** The JSON-RPC message, or the JSON error body for HTTP-level failures. */
  body: RpcResponse & Partial<ErrorResponse>;
}

/** The MCP endpoint answers either plain JSON or a single SSE `data:` event; read it fully either way. */
export async function readReply(res: Response): Promise<RpcReply> {
  const text = await res.text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return {
    status: res.status,
    headers: res.headers,
    body: JSON.parse(data ? data.slice(6) : text || '{}') as RpcReply['body'],
  };
}

export async function rpc(
  app: ReturnType<typeof createApp>,
  method: string,
  params?: unknown,
  headers: Record<string, string> = {},
): Promise<RpcReply> {
  const res = await app.request('/mcp', {
    method: 'POST',
    headers: { ...MCP_HEADERS, Authorization: 'Bearer user-token', ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return readReply(res);
}

export const callTool = (app: ReturnType<typeof createApp>, name: string, args: unknown = {}, headers = {}) =>
  rpc(app, 'tools/call', { name, arguments: args }, headers);

export const restCalls = (moodle: { calls: RecordedCall[] }) =>
  moodle.calls.filter((c) => c.url.pathname.endsWith('/webservice/rest/server.php'));
