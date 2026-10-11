import type { InputSchema, ToolInfo } from '@moodle-mcp/shared';
import * as z from 'zod/v4';

import { TOOLS } from './definitions.ts';

/** The tools as the web UI shows them; derived from the same definitions MCP clients see. */
export function toolCatalog(): ToolInfo[] {
  return TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    readOnly: true,
    inputSchema: z.toJSONSchema(tool.input, { io: 'input' }) as InputSchema,
  }));
}
