import type { McpServer } from '@modelcontextprotocol/server';

import type { Logger } from '../logger.ts';
import type { MoodleClient } from '../moodle/client.ts';
import { MoodleError, MoodleTransportError } from '../moodle/errors.ts';
import type { ToolDefinition } from './define.ts';
import { TOOLS } from './definitions.ts';

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Registers every tool on `server`; each call acts on behalf of `client`'s token owner. */
export function registerTools(server: McpServer, client: MoodleClient, logger: Logger): void {
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: ANNOTATIONS },
      (args) => runTool(tool, client, args, logger),
    );
  }
}

async function runTool(tool: ToolDefinition, client: MoodleClient, args: unknown, logger: Logger) {
  const started = Date.now();
  try {
    const data = await tool.execute(client, args);
    logger.info('tool call', { tool: tool.name, ok: true, ms: Date.now() - started });
    return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
  } catch (error) {
    logger.info('tool call', { tool: tool.name, ok: false, ms: Date.now() - started });
    // Errors from Moodle are meaningful to the model; anything else is a bug we must not leak.
    if (error instanceof MoodleError || error instanceof MoodleTransportError) {
      return { isError: true, content: [{ type: 'text' as const, text: error.message }] };
    }
    logger.error('tool failed unexpectedly', { tool: tool.name, error: String(error) });
    return { isError: true, content: [{ type: 'text' as const, text: 'Internal error' }] };
  }
}
