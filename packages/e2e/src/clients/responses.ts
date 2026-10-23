import {
  asArray,
  asRecord,
  type Decision,
  type ParsedRequest,
  type Protocol,
  sse,
  textOfBody,
  type ToolOutput,
} from './protocol.ts';

const NAMESPACE_SEPARATOR = '__';

/** Output as the client sent it: a string, or content items (text and images). */
function describeOutput(output: unknown): { text: string; images: number } {
  if (typeof output === 'string') return { text: output, images: 0 };
  const items = asArray(output).map((item) => asRecord(item));
  return {
    text: items
      .filter((item) => item.type === 'input_text' || item.type === 'output_text' || item.type === 'text')
      .map((item) => String(item.text))
      .join('\n'),
    images: items.filter((item) => item.type === 'input_image' || item.type === 'image').length,
  };
}

/** Function tools, with those grouped in a namespace named `namespace__tool` so they match like flat ones. */
function toolNames(tools: unknown): string[] {
  return asArray(tools).flatMap((tool) => {
    const { type, name, tools: nested } = asRecord(tool);
    if (type === 'namespace') {
      return asArray(nested).map(
        (inner) => `${String(name)}${NAMESPACE_SEPARATOR}${String(asRecord(inner).name)}`,
      );
    }
    return [String(name)];
  });
}

/** The OpenAI Responses API, as Codex speaks it. */
export const responses: Protocol = {
  name: 'responses',
  matches: (method, path) => method === 'POST' && path.endsWith('/responses'),

  parse(body): ParsedRequest {
    const request = asRecord(body);
    const outputs: ToolOutput[] = [];
    for (const item of asArray(request.input).map((i) => asRecord(i))) {
      if (
        typeof item.type === 'string' &&
        item.type.endsWith('_output') &&
        typeof item.call_id === 'string'
      ) {
        outputs.push({ callId: item.call_id, ...describeOutput(item.output) });
      }
    }
    return { tools: toolNames(request.tools), text: textOfBody(request), outputs };
  },

  respond(res, decision: Decision) {
    let item: Record<string, unknown>;
    if (decision.kind === 'call') {
      const split = decision.name.lastIndexOf(NAMESPACE_SEPARATOR);
      item = {
        type: 'function_call',
        call_id: decision.callId,
        ...(split > 0
          ? {
              namespace: decision.name.slice(0, split),
              name: decision.name.slice(split + NAMESPACE_SEPARATOR.length),
            }
          : { name: decision.name }),
        arguments: JSON.stringify(decision.args),
      };
    } else {
      item = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: decision.text }] };
    }
    const response = { id: 'resp_fake', object: 'response', status: 'completed' };
    sse(res, [
      {
        event: 'response.created',
        data: { type: 'response.created', response: { ...response, status: 'in_progress' } },
      },
      {
        event: 'response.output_item.done',
        data: { type: 'response.output_item.done', output_index: 0, item },
      },
      {
        event: 'response.completed',
        data: {
          type: 'response.completed',
          response: {
            ...response,
            output: [item],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        },
      },
    ]);
  },
};
