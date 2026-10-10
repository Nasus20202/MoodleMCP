import { describe, expect, it } from 'vitest';

import { createLogger, type LogLevel } from './logger.ts';

function capture(level: LogLevel) {
  const lines: [LogLevel, Record<string, unknown>][] = [];
  const logger = createLogger(level, (l, line) =>
    lines.push([l, JSON.parse(line) as Record<string, unknown>]),
  );
  return { logger, lines };
}

describe('createLogger', () => {
  it('writes structured JSON lines', () => {
    const { logger, lines } = capture('info');
    logger.info('hello', { a: 1 });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.[1]).toMatchObject({ level: 'info', msg: 'hello', a: 1 });
    expect(typeof lines[0]?.[1].time).toBe('string');
  });

  it('drops messages below the configured level', () => {
    const { logger, lines } = capture('warn');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(lines.map(([l]) => l)).toEqual(['warn', 'error']);
  });

  it('child loggers add their fields to every line, and call fields win', () => {
    const { logger, lines } = capture('info');
    const child = logger.child({ ip: '1.2.3.4', tokenId: 'abc' });
    child.info('one');
    child.child({ extra: true }).info('two', { ip: 'override' });
    logger.info('parent');

    expect(lines[0]?.[1]).toMatchObject({ msg: 'one', ip: '1.2.3.4', tokenId: 'abc' });
    expect(lines[1]?.[1]).toMatchObject({ msg: 'two', ip: 'override', tokenId: 'abc', extra: true });
    expect(lines[2]?.[1]).not.toHaveProperty('ip');
  });
});
