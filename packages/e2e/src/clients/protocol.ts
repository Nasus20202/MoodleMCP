import type { ServerResponse } from 'node:http';

/** What a tool returned to the model, as the client put it into the next request. */
export interface ToolOutput {
  callId: string;
  text: string;
  /** Image blocks the client forwarded alongside the text. */
  images: number;
}

/** The parts of a model request the scripted model cares about, whatever the wire format. */
export interface ParsedRequest {
  /** Names of the tools the client offered with this request. */
  tools: string[];
  /** All the text of the request, system prompt and tool descriptions included, for clients that announce tools in prose. */
  text: string;
  outputs: ToolOutput[];
}

export type Decision =
  | { kind: 'call'; callId: string; name: string; args: Record<string, unknown> }
  | { kind: 'text'; text: string };

/** One model API a client can be pointed at. */
export interface Protocol {
  name: string;
  /** Whether this protocol serves the request path. */
  matches(method: string, path: string): boolean;
  parse(body: unknown): ParsedRequest;
  respond(res: ServerResponse, decision: Decision): void;
}

/** Writes server-sent events: `event:` is omitted when the protocol puts the type in the data. */
export function sse(res: ServerResponse, events: { event?: string; data: unknown }[]): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
  for (const { event, data } of events) {
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
  }
  res.end();
}

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

export const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Every string anywhere inside a JSON value. */
export function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const item of value) yield* strings(item);
  else if (typeof value === 'object' && value !== null)
    for (const item of Object.values(value)) yield* strings(item);
}

/** All the text in a request body. */
export const textOfBody = (body: unknown): string => [...strings(body)].join('\n');
