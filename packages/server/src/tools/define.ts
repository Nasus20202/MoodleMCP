import type * as z from 'zod/v4';

import type { MoodleClient, Params } from '../moodle/client.ts';
import type { MoodleFunction } from '../moodle/functions.ts';
import type { ToolName } from './names.ts';

/** A read-only tool: validated input in, raw Moodle JSON out. */
export interface ToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  readonly input: z.ZodObject;
  /** Validates `rawInput` and runs the tool. Throws on invalid input or Moodle errors. */
  execute(client: MoodleClient, rawInput: unknown): Promise<unknown>;
}

interface ToolSpec<Schema extends z.ZodObject> {
  name: ToolName;
  description: string;
  input: Schema;
  /** The single Moodle function this tool wraps. */
  fn: MoodleFunction;
  /** Maps validated input to Moodle parameters. May look up the token owner via `client.userId()`. */
  params(input: z.output<Schema>, client: MoodleClient): Params | Promise<Params>;
}

export function defineTool<Schema extends z.ZodObject>(spec: ToolSpec<Schema>): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    input: spec.input,
    async execute(client, rawInput) {
      const input = spec.input.parse(rawInput);
      return client.call(spec.fn, await spec.params(input, client));
    },
  };
}
