import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { LogFields, Logger } from './logger.ts';
import { MoodleClient } from './moodle/client.ts';
import { registerTools } from './tools/register.ts';
import { SERVER_NAME, SERVER_VERSION } from './version.ts';

/** Whose Moodle data a request may read: the token owner, on the chosen site. */
export interface Caller {
  token: string;
  site: string;
}

export interface McpEndpoint {
  /** `logFields` are added to every log line written while serving this request. */
  handle(request: Request, caller: Caller, logFields?: LogFields): Promise<Response>;
}

/** What `handle` passes to the server factory, through the SDK's pass-through `authInfo.extra`. */
const callerExtra = z.object({ site: z.string(), logFields: z.record(z.string(), z.unknown()) });

const CLIENT_ID = 'moodle-token';

/**
 * The stateless MCP endpoint. A fresh server is built for every request, bound to that request's
 * caller, so nothing is shared between users and nothing is stored.
 */
export function createMcpEndpoint(deps: { fetch: typeof fetch; logger: Logger }): McpEndpoint {
  const handler = createMcpHandler(
    ({ authInfo }) => {
      const extra = callerExtra.safeParse(authInfo?.extra);
      if (!(authInfo && extra.success))
        throw new Error('MCP request reached the handler without credentials');

      const logger = deps.logger.child(extra.data.logFields);
      const client = new MoodleClient({
        baseUrl: extra.data.site,
        token: authInfo.token,
        fetch: deps.fetch,
        logger,
      });
      const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
      registerTools(server, client, logger);
      return server;
    },
    { responseMode: 'json' },
  );

  return {
    handle: (request, caller, logFields = {}) =>
      handler.fetch(request, {
        authInfo: {
          token: caller.token,
          clientId: CLIENT_ID,
          scopes: [],
          extra: { site: caller.site, logFields } satisfies z.input<typeof callerExtra>,
        },
      }),
  };
}
