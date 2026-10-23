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

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : asArray(content)
        .map((block) => asRecord(block))
        .filter((block) => block.type === 'text')
        .map((block) => String(block.text))
        .join('\n');

const imagesIn = (content: unknown): number =>
  asArray(content).filter((block) => asRecord(block).type === 'image').length;

/** The Anthropic Messages API, as Claude Code speaks it. */
export const anthropic: Protocol = {
  name: 'anthropic',
  matches: (method, path) => method === 'POST' && path === '/v1/messages',

  parse(body): ParsedRequest {
    const request = asRecord(body);
    const outputs: ToolOutput[] = [];
    for (const message of asArray(request.messages).map((m) => asRecord(m))) {
      for (const block of asArray(message.content).map((b) => asRecord(b))) {
        if (block.type !== 'tool_result') continue;
        outputs.push({
          callId: String(block.tool_use_id),
          text: textOf(block.content),
          images: imagesIn(block.content),
        });
      }
    }
    return {
      tools: asArray(request.tools).map((tool) => String(asRecord(tool).name)),
      text: textOfBody(request),
      outputs,
    };
  },

  respond(res, decision: Decision) {
    const message = {
      type: 'message_start',
      message: {
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        model: 'fake',
        content: [],
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    };
    const start =
      decision.kind === 'call'
        ? { type: 'tool_use', id: decision.callId, name: decision.name, input: {} }
        : { type: 'text', text: '' };
    const delta =
      decision.kind === 'call'
        ? { type: 'input_json_delta', partial_json: JSON.stringify(decision.args) }
        : { type: 'text_delta', text: decision.text };
    sse(res, [
      { event: 'message_start', data: message },
      { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: start } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
      {
        event: 'message_delta',
        data: {
          type: 'message_delta',
          delta: { stop_reason: decision.kind === 'call' ? 'tool_use' : 'end_turn', stop_sequence: null },
          usage: { output_tokens: 1 },
        },
      },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]);
  },
};
