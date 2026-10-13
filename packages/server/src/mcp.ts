import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import type { MarkdownConverter } from './files/markdown.ts';
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

/** Orientation for the model: the order tools are meant to be chained in, and what is out of scope. */
const SERVER_INSTRUCTIONS = [
  "Read-only access to the user's Moodle (e-learning) account. Nothing can be changed, submitted or posted.",
  'Start with list_courses to get course ids. Use get_course_contents for a course outline; it lists files with a',
  '`fileurl` that read_file turns into text (PDF, Word, PowerPoint, HTML, text, images).',
  'Ids differ per tool: ids you pass come from the output of the listing tool named in each argument. Timestamps',
  'are Unix seconds. Course names can contain {mlang xx}...{mlang} markup: read the part in the right language.',
  'For "what is due soon?" use get_upcoming_events.',
].join(' ');

/**
 * The stateless MCP endpoint. A fresh server is built for every request, bound to that request's
 * caller, so nothing is shared between users and nothing is stored.
 */
export interface McpEndpointDeps {
  fetch: typeof fetch;
  logger: Logger;
  markdown?: MarkdownConverter;
}

export function createMcpEndpoint(deps: McpEndpointDeps): McpEndpoint {
  const handler = createMcpHandler(({ authInfo }) => {
    const extra = callerExtra.safeParse(authInfo?.extra);
    if (!(authInfo && extra.success)) throw new Error('MCP request reached the handler without credentials');

    const logger = deps.logger.child(extra.data.logFields);
    const client = new MoodleClient({
      baseUrl: extra.data.site,
      token: authInfo.token,
      fetch: deps.fetch,
      logger,
    });
    const server = new McpServer(
      { name: SERVER_NAME, version: SERVER_VERSION },
      { instructions: SERVER_INSTRUCTIONS },
    );
    registerTools(server, { client, logger, ...(deps.markdown && { markdown: deps.markdown }) });
    return server;
  });

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
