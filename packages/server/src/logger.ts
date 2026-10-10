export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line it writes. */
  child(fields: LogFields): Logger;
}

/** Receives one finished JSON line per log call. */
export type LogSink = (level: LogLevel, line: string) => void;

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Writes to the console; on Workers these lines show up in the dashboard and `wrangler tail`. */
/* eslint-disable no-console -- the console is the log output on Workers */
const CONSOLE_WRITERS: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.debug(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};
/* eslint-enable no-console */

export const consoleSink: LogSink = (level, line) => {
  CONSOLE_WRITERS[level](line);
};

/**
 * Structured JSON logger. Callers must never pass secrets (tokens, QR keys) or user data.
 * Identify users only by the fields `ip` and `tokenId` that the HTTP layer attaches.
 */
export function createLogger(level: LogLevel, sink: LogSink = consoleSink, base: LogFields = {}): Logger {
  const emit = (at: LogLevel) => (message: string, fields?: LogFields) => {
    if (ORDER[at] < ORDER[level]) return;
    sink(at, JSON.stringify({ time: new Date().toISOString(), level: at, msg: message, ...base, ...fields }));
  };
  return {
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    child: (fields) => createLogger(level, sink, { ...base, ...fields }),
  };
}

const noop = (): void => undefined;

export const silentLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
  child: () => silentLogger,
};
