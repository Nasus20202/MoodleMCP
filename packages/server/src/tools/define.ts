import type * as z from 'zod/v4';

import { extractEmbeddedImages } from '../files/embedded-images.ts';
import type { MarkdownConverter } from '../files/markdown.ts';
import type { Logger } from '../logger.ts';
import type { MoodleClient, Params } from '../moodle/client.ts';
import type { MoodleFunction } from '../moodle/functions.ts';
import type { ToolName } from './names.ts';
import { tidyToJson } from './tidy.ts';

/** One block of a tool result, as MCP clients receive it. */
export type ToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; mimeType?: string; blob: string } };

/** Says where the pictures that came with a result are: numbered `data-image` marks in the text. */
export function imageNote(attached: number, skipped: number): string {
  return (
    `${attached} image(s) pasted into the text are attached after it, in order; each \`data-image="N"\` ` +
    'mark in the text is the Nth of them.' +
    (skipped > 0 ? ` ${skipped} more were too large or beyond the limit and are left out.` : '')
  );
}

export const jsonContent = (data: unknown): ToolContent[] => [{ type: 'text', text: JSON.stringify(data) }];

/** What a tool run may use: the caller's Moodle client and a logger already tagged with the caller. */
export interface ToolContext {
  client: MoodleClient;
  logger: Logger;
  /** Workers AI's document converter, when the binding is configured. */
  markdown?: MarkdownConverter | undefined;
}

/** A read-only tool: validated input in, content blocks out (raw Moodle JSON for most tools). */
export interface ToolDefinition {
  readonly name: ToolName;
  readonly description: string;
  readonly input: z.ZodObject;
  /** Validates `rawInput` and runs the tool. Throws on invalid input or Moodle errors. */
  execute(context: ToolContext, rawInput: unknown): Promise<ToolContent[]>;
}

interface ToolSpec<Schema extends z.ZodObject> {
  name: ToolName;
  description: string;
  input: Schema;
  /** The single Moodle function this tool wraps. */
  fn: MoodleFunction;
  /** Maps validated input to Moodle parameters. May look up the token owner via `client.userId()`. */
  params(input: z.output<Schema>, client: MoodleClient): Params | Promise<Params>;
  /** Reduces Moodle's result before it is tidied, e.g. to drop fields the model must not see. */
  shape?(result: unknown): unknown;
}

export function defineTool<Schema extends z.ZodObject>(spec: ToolSpec<Schema>): ToolDefinition {
  return defineCustomTool({
    name: spec.name,
    description: spec.description,
    input: spec.input,
    async run({ client }, input) {
      const result = await client.call(spec.fn, await spec.params(input, client));
      return renderResult(client, spec.shape ? spec.shape(result) : result);
    },
  });
}

/**
 * Turns a Moodle result into content blocks: tidied JSON, then the pictures pasted into its HTML as image
 * blocks, each marked `data-image="N"` where it sat, and a line saying so.
 */
export async function renderResult(client: MoodleClient, shaped: unknown): Promise<ToolContent[]> {
  const { value, images, skipped } = extractEmbeddedImages(shaped);
  const text = await tidyToJson(value, () => client.lang());
  if (images.length === 0 && skipped === 0) return [{ type: 'text', text }];
  return [
    { type: 'text', text },
    ...images.map((image): ToolContent => ({
      type: 'image',
      data: image.base64,
      mimeType: image.mimeType,
    })),
    ...jsonContent({ note: imageNote(images.length, skipped) }),
  ];
}

interface CustomToolSpec<Schema extends z.ZodObject> {
  name: ToolName;
  description: string;
  input: Schema;
  /** Must only read: go through `client.call` or `client.download`. */
  run(context: ToolContext, input: z.output<Schema>): Promise<ToolContent[]>;
}

/** For tools that do more than relay one Moodle function, such as downloading a file. */
export function defineCustomTool<Schema extends z.ZodObject>(spec: CustomToolSpec<Schema>): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    input: spec.input,
    execute: (context, rawInput) => spec.run(context, spec.input.parse(rawInput)),
  };
}
