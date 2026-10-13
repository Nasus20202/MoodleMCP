import { describe, expect, it } from 'vitest';

import { fakeMarkdown } from '../test-utils.ts';
import { type MarkdownConverter, toMarkdown } from './markdown.ts';

const file = { filename: 'notes.pdf', bytes: new TextEncoder().encode('%PDF') };

describe('toMarkdown', () => {
  it('returns the trimmed Markdown and the tokens Workers AI counted', async () => {
    const { converter } = fakeMarkdown(() => '\n# Notes\n\nText\n');
    expect(await toMarkdown(converter, file, 'application/pdf')).toEqual({
      text: '# Notes\n\nText',
      tokens: 4,
    });
  });

  it('turns a failed conversion into an error', async () => {
    const { converter } = fakeMarkdown(() => new Error('Unsupported file type'));
    await expect(toMarkdown(converter, file, 'application/pdf')).rejects.toMatchObject({
      name: 'MarkdownConversionError',
    });
  });

  it('gives up on a conversion that does not answer in time', async () => {
    const stalled: MarkdownConverter = { toMarkdown: () => new Promise(() => undefined) };
    await expect(toMarkdown(stalled, file, 'application/pdf', 10)).rejects.toMatchObject({
      name: 'MarkdownTimeoutError',
    });
  });
});
