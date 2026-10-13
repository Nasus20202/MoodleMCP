import { describe, expect, it } from 'vitest';

import { fakeMarkdown } from '../test-utils.ts';
import {
  classifyConversionFailure,
  CONVERSION_TIMEOUT_MS,
  ConversionFailure,
  conversionFailureNote,
  type MarkdownConverter,
  MarkdownTimeoutError,
  toMarkdown,
} from './markdown.ts';

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

  it('leaves the fallback time to run inside a minute, the point where MCP clients give up', () => {
    expect(CONVERSION_TIMEOUT_MS).toBeGreaterThan(20_000);
    expect(CONVERSION_TIMEOUT_MS).toBeLessThanOrEqual(45_000);
  });

  it('does not leave an unhandled rejection when a timed-out conversion fails later', async () => {
    const lateFailure: MarkdownConverter = {
      toMarkdown: () => new Promise((_, reject) => setTimeout(() => reject(new Error('too late')), 30)),
    };
    await expect(toMarkdown(lateFailure, file, 'application/pdf', 5)).rejects.toMatchObject({
      name: 'MarkdownTimeoutError',
    });
    // Vitest fails the run on an unhandled rejection, so waiting past the late failure is the assertion.
    await new Promise((resolve) => setTimeout(resolve, 60));
  });
});

describe('classifyConversionFailure', () => {
  it.each([
    ['notes.pdf: daily free allocation of neurons exceeded', ConversionFailure.Quota],
    ['AiError: 429 Too Many Requests', ConversionFailure.Quota],
    ['Rate limit reached', ConversionFailure.Quota],
    ['Unsupported file type', ConversionFailure.Unsupported],
    ['Unknown format', ConversionFailure.Unsupported],
    ['Something went wrong', ConversionFailure.Failed],
    ['', ConversionFailure.Failed],
  ])('sorts the message %j as %s', (message, reason) => {
    expect(classifyConversionFailure(new Error(message))).toBe(reason);
  });

  it('recognises the timeout by its type, not by a message', () => {
    expect(classifyConversionFailure(new MarkdownTimeoutError())).toBe(ConversionFailure.Timeout);
  });

  it('copes with something that is not an Error', () => {
    expect(classifyConversionFailure('neurons')).toBe(ConversionFailure.Failed);
    expect(classifyConversionFailure(undefined)).toBe(ConversionFailure.Failed);
  });
});

describe('conversionFailureNote', () => {
  it.each(Object.values(ConversionFailure))(
    'tells the caller the text was extracted instead (%s)',
    (reason) => {
      const note = conversionFailureNote(reason);
      expect(note).toContain('Markdown conversion failed');
      expect(note).toContain('extracted instead');
    },
  );
});
