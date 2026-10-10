import type { ToolArgument, ToolInfo } from './types/tools';

/** Flatten a tool's JSON schema into a list of arguments for display. */
export function toolArguments(tool: ToolInfo): ToolArgument[] {
  const required = new Set(tool.inputSchema.required ?? []);
  return Object.entries(tool.inputSchema.properties ?? {}).map(([name, p]) => ({
    name,
    type: p.type ?? 'any',
    description: p.description,
    required: required.has(name)
  }));
}
