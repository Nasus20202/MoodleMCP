import type { ToolInfo } from '@moodle-mcp/shared';
import { describe, expect, it } from 'vitest';

import { codeSegments, summary, toolArguments } from './tools';

const tool = (inputSchema: ToolInfo['inputSchema']): ToolInfo => ({
  name: 't',
  description: 'd',
  readOnly: true,
  inputSchema,
});

describe('toolArguments', () => {
  it('flattens properties and marks required ones', () => {
    const args = toolArguments(
      tool({
        properties: { course_id: { type: 'integer', description: 'id' }, q: {} },
        required: ['course_id'],
      }),
    );
    expect(args).toEqual([
      { name: 'course_id', type: 'integer', description: 'id', required: true },
      { name: 'q', type: 'any', description: undefined, required: false },
    ]);
  });

  it('reports defaults as text', () => {
    const [arg] = toolArguments(tool({ properties: { raw: { type: 'boolean', default: false } } }));
    expect(arg).toMatchObject({ name: 'raw', required: false, default: 'false' });
  });

  it('handles tools without arguments', () => {
    expect(toolArguments(tool({}))).toEqual([]);
  });
});

describe('summary', () => {
  it.each([
    ['Show the site. Rarely needed.', 'Show the site'],
    [
      'Look up one activity by its `cmid` and get its type (`modname`). Use this when',
      'Look up one activity by its cmid and get its type (modname)',
    ],
    [
      'Search ALL visible courses on the site by name, including ones the user is not enrolled in.',
      'Search ALL visible courses on the site by name, including ones the user is not enrolled in',
    ],
    ['Open https://x.org/a.b now. Then go.', 'Open https://x.org/a.b now'],
    ['no punctuation', 'no punctuation'],
  ])('%s', (input, expected) => {
    expect(summary(input)).toBe(expected);
  });
});

describe('codeSegments', () => {
  it('marks backtick spans as code', () => {
    expect(codeSegments('call `assign_id`/`forum_id`.')).toEqual([
      { text: 'call ', code: false },
      { text: 'assign_id', code: true },
      { text: '/', code: false },
      { text: 'forum_id', code: true },
      { text: '.', code: false },
    ]);
  });

  it('leaves an unmatched backtick as text', () => {
    expect(codeSegments('a ` b')).toEqual([{ text: 'a ` b', code: false }]);
  });
});
