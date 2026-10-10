import { describe, expect, it } from 'vitest';
import { toolArguments } from './tools';
import type { ToolInfo } from './types/tools';

const tool = (inputSchema: ToolInfo['inputSchema']): ToolInfo => ({ name: 't', description: 'd', readOnly: true, inputSchema });

describe('toolArguments', () => {
  it('flattens properties and marks required ones', () => {
    const args = toolArguments(
      tool({ properties: { course_id: { type: 'integer', description: 'id' }, q: {} }, required: ['course_id'] })
    );
    expect(args).toEqual([
      { name: 'course_id', type: 'integer', description: 'id', required: true },
      { name: 'q', type: 'any', description: undefined, required: false }
    ]);
  });

  it('handles tools without arguments', () => {
    expect(toolArguments(tool({}))).toEqual([]);
  });
});
