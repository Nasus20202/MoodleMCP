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

const chunk = (delta: Record<string, unknown>, finishReason: string | null = null) => ({
  data: {
    id: 'chatcmpl-fake',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'fake',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  },
});

/** The OpenAI Chat Completions API, as OpenAI-compatible providers in opencode speak it. */
export const chat: Protocol = {
  name: 'chat',
  matches: (method, path) => method === 'POST' && path.endsWith('/chat/completions'),

  parse(body): ParsedRequest {
    const request = asRecord(body);
    const messages = asArray(request.messages).map((m) => asRecord(m));
    const outputs: ToolOutput[] = [];
    for (const message of messages) {
      if (message.role !== 'tool') continue;
      const content = message.content;
      const parts = typeof content === 'string' ? [] : asArray(content).map((p) => asRecord(p));
      outputs.push({
        callId: String(message.tool_call_id),
        text:
          typeof content === 'string'
            ? content
            : parts.map((p) => (typeof p.text === 'string' ? p.text : '')).join('\n'),
        images: parts.filter((p) => p.type === 'image_url').length,
      });
    }
    return {
      tools: asArray(request.tools).map((tool) => String(asRecord(asRecord(tool).function).name)),
      text: textOfBody(request),
      outputs,
    };
  },

  respond(res, decision: Decision) {
    sse(res, [
      chunk({ role: 'assistant', content: '' }),
      decision.kind === 'call'
        ? chunk({
            tool_calls: [
              {
                index: 0,
                id: decision.callId,
                type: 'function',
                function: { name: decision.name, arguments: JSON.stringify(decision.args) },
              },
            ],
          })
        : chunk({ content: decision.text }),
      chunk({}, decision.kind === 'call' ? 'tool_calls' : 'stop'),
      { data: '[DONE]' },
    ]);
  },
};
