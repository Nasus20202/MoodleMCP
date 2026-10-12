import type { ToolInfo } from '@moodle-mcp/shared';

import type { TextSegment, ToolArgument } from './types/tools';

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

/** Splits text on `backtick` spans so they can be rendered as code. An unmatched backtick stays plain text. */
export function codeSegments(text: string): TextSegment[] {
  return text
    .split(/(`[^`]+`)/)
    .filter((part) => part !== '')
    .map((part) =>
      part.length > 2 && part.startsWith('`') && part.endsWith('`')
        ? { text: part.slice(1, -1), code: true }
        : { text: part, code: false },
    );
}
