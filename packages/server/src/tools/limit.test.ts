import { describe, expect, it } from 'vitest';

import { callTool, setup } from '../app-test-utils.ts';
import { limitResult, MAX_RESULT_CHARS } from './define.ts';
import { ToolName } from './names.ts';
import { pickQuizzes } from './tidy.ts';

describe('limitResult', () => {
  it('leaves a result that fits alone', () => {
    const text = JSON.stringify({ a: 'x'.repeat(1000) });
    expect(limitResult(text)).toBe(text);
  });

  it('cuts a longer one, says so and how much there was, and stays below what clients cut', () => {
    const text = JSON.stringify({
      items: Array.from({ length: 20_000 }, (_, i) => ({ id: i, name: 'n"ame' })),
    });
    const limited = limitResult(text);
    const parsed = JSON.parse(limited) as Record<string, unknown>;
    expect(parsed).toMatchObject({ truncated: true, total_chars: text.length });
    // Quotes are escaped inside `partial`, so fewer characters than the limit are shown to stay within it.
    expect(Number(parsed.shown_chars)).toBeLessThan(MAX_RESULT_CHARS);
    expect(String(parsed.note)).toContain('narrower');
    expect(String(parsed.partial)).toBe(text.slice(0, Number(parsed.shown_chars)));
    expect(limited.length).toBeLessThanOrEqual(MAX_RESULT_CHARS);
  });

  it('applies to every tool: a huge Moodle answer comes back cut, not whole', async () => {
    const { app } = setup(() => ({
      events: Array.from({ length: 5000 }, (_, i) => ({ id: i, name: 'Event '.repeat(10) })),
    }));
    const { body } = await callTool(app, ToolName.GetCourseEvents, { course_id: 3 });
    const text = body.result?.content?.[0]?.text ?? '';
    expect(JSON.parse(text)).toMatchObject({ truncated: true });
    expect(text.length).toBeLessThan(100_000);
  });
});

describe('list_quizzes', () => {
  it('keeps what a student asks about a quiz and drops its settings', () => {
    const quiz = {
      id: 1,
      name: 'Q',
      timeclose: 5,
      timelimit: 60,
      attempts: 2,
      preferredbehaviour: 'x',
      browsersecurity: '-',
    };
    expect(pickQuizzes({ quizzes: [quiz], warnings: [] })).toEqual({
      quizzes: [{ id: 1, name: 'Q', timeclose: 5, timelimit: 60, attempts: 2 }],
      warnings: [],
    });
  });

  it('passes anything else through unchanged', () => {
    expect(pickQuizzes({ exception: 'x' })).toEqual({ exception: 'x' });
    expect(pickQuizzes('text')).toBe('text');
  });
});
