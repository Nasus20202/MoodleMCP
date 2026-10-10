import { describe, expect, it } from 'vitest';

import { DEFAULT_MOODLE_URL, loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig({})).toEqual({
      moodleUrl: DEFAULT_MOODLE_URL,
      allowedHosts: ['*'],
      allowInsecureSites: false,
      logLevel: 'info',
    });
  });

  it('parses and normalises values', () => {
    const config = loadConfig({
      MOODLE_URL: 'https://m.example.edu/x',
      ALLOWED_MOODLE_HOSTS: ' A.example.edu, ,b.example.edu ',
      LOG_LEVEL: 'debug',
    });
    expect(config.moodleUrl).toBe('https://m.example.edu/x');
    expect(config.allowedHosts).toEqual(['a.example.edu', 'b.example.edu']);
    expect(config.logLevel).toBe('debug');
  });

  it('treats an empty ALLOWED_MOODLE_HOSTS as "default site only"', () => {
    expect(loadConfig({ ALLOWED_MOODLE_HOSTS: '' }).allowedHosts).toEqual([]);
  });

  it('rejects invalid values with a readable error', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ MOODLE_URL: 'not a url' })).toThrow(/Invalid configuration/);
  });
});
