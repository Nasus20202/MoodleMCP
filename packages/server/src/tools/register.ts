import type { McpServer } from '@modelcontextprotocol/server';

import { MoodleError, MoodleTransportError } from '../moodle/errors.ts';
import type { ToolContent, ToolContext, ToolDefinition } from './define.ts';
import { TOOLS } from './definitions.ts';

/** A tool call slower than this is logged as a warning. */
const SLOW_MS = 5000;

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

/** Registers every tool on `server`; each call acts on behalf of `context.client`'s token owner. */
export function registerTools(server: McpServer, context: ToolContext): void {
  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input, annotations: ANNOTATIONS },
      (args) => runTool(tool, context, args),
    );
  }
}

/** A short, non-sensitive label for why a tool failed, for the logs. */
function failureKind(error: unknown): string {
  if (error instanceof MoodleError) return error.code;
  if (error instanceof MoodleTransportError) return 'transport';
  return 'internal';
}

/** How much a result weighs, to spot tools whose output is too big for a model. */
function sizeOf(content: ToolContent[]): number {
  return content.reduce((sum, block) => {
    if (block.type === 'text') return sum + block.text.length;
    return sum + (block.type === 'resource' ? block.resource.blob.length : block.data.length);
  }, 0);
}

async function runTool(tool: ToolDefinition, context: ToolContext, args: unknown) {
  const { logger } = context;
  const started = Date.now();
  try {
    const content = await tool.execute(context, args);
    const ms = Date.now() - started;
    const chars = sizeOf(content);
    if (ms >= SLOW_MS)
      logger.warn(`tool ${tool.name} ok but slow ${ms}ms`, { tool: tool.name, ok: true, chars, ms });
    else logger.info(`tool ${tool.name} ok ${ms}ms`, { tool: tool.name, ok: true, chars, ms });
    return { content };
  } catch (error) {
    const kind = failureKind(error);
    const ms = Date.now() - started;
    logger.info(`tool ${tool.name} failed (${kind}) ${ms}ms`, {
      tool: tool.name,
      ok: false,
      error: kind,
      ms,
    });
    // Errors from Moodle are meaningful to the model; anything else is a bug we must not leak.
    if (error instanceof MoodleError || error instanceof MoodleTransportError) {
      return { isError: true, content: [{ type: 'text' as const, text: error.message }] };
    }
    logger.error('tool failed unexpectedly', { tool: tool.name, error: String(error) });
    return { isError: true, content: [{ type: 'text' as const, text: 'Internal error' }] };
  }
}
