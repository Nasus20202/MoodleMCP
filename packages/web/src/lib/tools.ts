import type { ToolInfo } from '@moodle-mcp/shared';

import type { ToolArgument } from './types/tools';

/** Flatten a tool's JSON schema into a list of arguments for display. */
export function toolArguments(tool: ToolInfo): ToolArgument[] {
  const required = new Set(tool.inputSchema.required ?? []);
  return Object.entries(tool.inputSchema.properties ?? {}).map(([name, p]) => ({
    name,
    type: p.type ?? 'any',
    description: p.description,
    required: required.has(name),
    ...(p.default === undefined
      ? {}
      : { default: typeof p.default === 'string' ? p.default : JSON.stringify(p.default) }),
  }));
}

/** The first sentence of a tool description, without code backticks, for the collapsed view. */
export function summary(description: string): string {
  const first = /^[\s\S]+?[.!?:](?=\s+[A-Z`"'(]|$)/.exec(description)?.[0] ?? description;
  return first.replace(/`/g, '').replace(/[.:]$/, '');
}
