import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as sleep } from 'node:timers/promises';

import type { Invoker } from './invoker.ts';
import type { Decision, ToolOutput } from './protocol.ts';

/** One tool call the scripted model makes, in order. */
export interface Step {
  tool: string;
  args: Record<string, unknown>;
}

/** What the model learned from a run: the tools the client offered and what each call returned. */
export interface Transcript {
  /** Moodle tools the client offered or announced, by the server's names. */
  offered: Set<string>;
  /** The output of step `i`, once the client has sent it back. */
  outputs: (ToolOutput | undefined)[];
  /** Whether a step could not be made because the client never offered its tool. */
  stuckOn: string | undefined;
}

const STEP_PREFIX = 'call_step_';
const PROBE_PREFIX = 'call_probe_';
const FINAL_TEXT = 'All tool calls finished.';
/** Some clients connect to MCP servers while the first turn is already running; probes wait for them. */
const PROBE_DELAY_MS = 250;
const MAX_PROBES = 80;

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
};

export interface FakeModel {
  /** `http://127.0.0.1:port`, to hand to the client as its model endpoint. */
  url: string;
  transcript: Transcript;
  stop(): Promise<void>;
}

/**
 * A model API that is not a model: it answers every conversation by calling `steps` one after the other, then ends
 * the turn. The next step is read from the conversation itself (how many of its own calls have outputs), so the
 * client's side requests (titles, compaction, retries) cannot throw it off.
 */
export async function startFakeModel(invoker: Invoker, steps: Step[]): Promise<FakeModel> {
  const transcript: Transcript = { offered: new Set(), outputs: [], stuckOn: undefined };
  const { protocol } = invoker;

  const decide = async (body: unknown): Promise<Decision> => {
    const request = protocol.parse(body);
    for (const output of request.outputs) {
      if (output.callId.startsWith(STEP_PREFIX)) {
        transcript.outputs[Number(output.callId.slice(STEP_PREFIX.length))] = output;
      }
    }
    for (const name of invoker.offered(request)) transcript.offered.add(name);

    const done = request.outputs.filter((o) => o.callId.startsWith(STEP_PREFIX)).length;
    const step = steps[done];
    if (!step) return { kind: 'text', text: FINAL_TEXT };

    const call = invoker.invoke(request, step.tool, step.args);
    if (call) return { kind: 'call', callId: `${STEP_PREFIX}${done}`, ...call };

    const probes = request.outputs.filter((o) => o.callId.startsWith(PROBE_PREFIX)).length;
    const probe = probes < MAX_PROBES ? invoker.probe(request) : undefined;
    if (probe) {
      await sleep(PROBE_DELAY_MS);
      return { kind: 'call', callId: `${PROBE_PREFIX}${probes}`, ...probe };
    }
    // Requests without tools are the client's own housekeeping (session titles); only a real turn can be stuck.
    if (request.tools.length > 0) transcript.stuckOn = step.tool;
    return { kind: 'text', text: `The tool ${step.tool} was not offered.` };
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const path = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (!protocol.matches(req.method ?? 'GET', path)) {
        res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"not found"}');
        return;
      }
      protocol.respond(res, await decide(await readBody(req)));
    })().catch((error: unknown) => {
      res.writeHead(500).end(String(error));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    transcript,
    stop: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
