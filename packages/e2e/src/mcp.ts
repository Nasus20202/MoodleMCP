import type { RunningWorker } from './worker.ts';

const MCP_HEADERS = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
};

export interface ToolResult {
  isError?: boolean;
  content: {
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: { uri: string; mimeType?: string; blob: string };
  }[];
}

export interface RpcReply<T = unknown> {
  status: number;
  headers: Headers;
  /** The JSON-RPC message for MCP responses, or the JSON error body for failures before MCP. */
  body: { result?: T; error?: { code?: number; message: string } | string; jsonrpc?: string; id?: number };
}

export interface ToolListing {
  name: string;
  description?: string;
  inputSchema: { type: string; properties?: Record<string, { type?: string }>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

/** Reads a reply that is either plain JSON or a single server-sent event. */
async function readReply<T>(res: Response): Promise<RpcReply<T>> {
  const text = await res.text();
  const data = text.split('\n').find((line) => line.startsWith('data: '));
  return {
    status: res.status,
    headers: res.headers,
    body: JSON.parse(data ? data.slice(6) : text || '{}') as RpcReply<T>['body'],
  };
}

let nextId = 1;

/** Sends one JSON-RPC request to `/mcp` with the given auth headers. */
export async function rpc<T = unknown>(
  worker: RunningWorker,
  headers: Record<string, string>,
  method: string,
  params?: unknown,
): Promise<RpcReply<T>> {
  const res = await worker.fetch('/mcp', {
    method: 'POST',
    headers: { ...MCP_HEADERS, ...headers },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  return readReply<T>(res);
}

/** An MCP client bound to one set of credentials. */
export class McpClient {
  readonly #worker: RunningWorker;
  readonly #headers: Record<string, string>;

  constructor(worker: RunningWorker, credentials: Record<string, string>) {
    this.#worker = worker;
    this.#headers = credentials;
  }

  /** Credentials for `Authorization: Bearer <token>`. */
  static bearer(worker: RunningWorker, token: string, extra: Record<string, string> = {}): McpClient {
    return new McpClient(worker, { Authorization: `Bearer ${token}`, ...extra });
  }

  rpc<T = unknown>(method: string, params?: unknown): Promise<RpcReply<T>> {
    return rpc<T>(this.#worker, this.#headers, method, params);
  }

  async listTools(): Promise<ToolListing[]> {
    const { body } = await this.rpc<{ tools: ToolListing[] }>('tools/list');
    return (body.result as { tools: ToolListing[] }).tools;
  }

  /** Calls a tool and returns the raw result, whether it succeeded or reported an error. */
  async call(name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
    const { body } = await this.rpc<ToolResult>('tools/call', { name, arguments: args });
    if (!body.result) throw new Error(`tools/call ${name} failed: ${JSON.stringify(body.error)}`);
    return body.result;
  }

  /** Calls a tool that must succeed and parses its JSON text. */
  async json<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const result = await this.call(name, args);
    if (result.isError) throw new Error(`${name} reported an error: ${result.content[0]?.text}`);
    return JSON.parse(result.content[0]?.text ?? 'null') as T;
  }
}

export const textOf = (result: ToolResult): string => result.content.map((c) => c.text ?? '').join('\n');
