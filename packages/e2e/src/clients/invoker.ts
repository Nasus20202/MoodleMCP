import type { ParsedRequest, Protocol } from './protocol.ts';

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

/** How one client reaches the Moodle tools: which model API it speaks and how it names and invokes the tools. */
export interface Invoker {
  protocol: Protocol;
  /** The call that runs `tool`, or undefined while the client has not made it available (yet). */
  invoke(request: ParsedRequest, tool: string, args: Record<string, unknown>): ToolCall | undefined;
  /** A call that gives the client a chance to finish loading its tools, if any helps. */
  probe(request: ParsedRequest): ToolCall | undefined;
  /** The tools this request shows as offered, by the server's own names (`list_courses`). */
  offered(request: ParsedRequest): string[];
}

const SERVER = 'moodle';

const namesIn = (text: string, pattern: RegExp): string[] => [
  ...new Set([...text.matchAll(pattern)].map((match) => match[1] ?? '')),
];

/** Moodle tools offered as ordinary tools named `<prefix><tool>`, possibly announced in prose before their schemas load. */
export function directTools(
  protocol: Protocol,
  prefix: string,
  probe: (request: ParsedRequest, announced: string[]) => ToolCall | undefined,
): Invoker {
  const announced = (request: ParsedRequest) => namesIn(request.text, new RegExp(`${prefix}([a-z_]+)`, 'g'));
  return {
    protocol,
    invoke: (request, tool, args) =>
      request.tools.includes(`${prefix}${tool}`) ? { name: `${prefix}${tool}`, args } : undefined,
    probe: (request) => probe(request, announced(request)),
    offered: (request) => [
      ...new Set([
        ...request.tools.filter((t) => t.startsWith(prefix)).map((t) => t.slice(prefix.length)),
        ...announced(request),
      ]),
    ],
  };
}

/** Claude Code defers MCP tool schemas: the model must ask ToolSearch to load them. */
export const loadWithToolSearch = (request: ParsedRequest, announced: string[]): ToolCall | undefined =>
  request.tools.includes('ToolSearch') && announced.length > 0
    ? {
        name: 'ToolSearch',
        args: {
          query: `select:${announced.map((name) => `mcp__${SERVER}__${name}`).join(',')}`,
          max_results: 50,
        },
      }
    : undefined;

/** Moodle tools called from JavaScript run by the `execute` tool (opencode's Code Mode). */
export function codeModeTools(protocol: Protocol): Invoker {
  const ready = (request: ParsedRequest) =>
    request.tools.includes('execute') && request.text.includes(`tools.${SERVER}.`);
  return {
    protocol,
    invoke: (request, tool, args) =>
      ready(request)
        ? {
            name: 'execute',
            args: { code: `return await tools.${SERVER}.${tool}(${JSON.stringify(args)});` },
          }
        : undefined,
    probe: (request) =>
      request.tools.includes('execute') ? { name: 'execute', args: { code: 'return 0;' } } : undefined,
    // The catalog shows a few tools only; the rest are reached by name all the same.
    offered: (request) => namesIn(request.text, new RegExp(`tools\\.${SERVER}\\.([a-z_]+)\\(`, 'g')),
  };
}
