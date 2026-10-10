import { describe, expect, it } from 'vitest';

import { SiteNotAllowedError, SitePolicy } from './site-policy.ts';
import { testConfig } from './test-utils.ts';

const policy = (overrides = {}) => new SitePolicy(testConfig(overrides));

describe('SitePolicy.validate', () => {
  it('allows other paths on the default host', () => {
    expect(policy().validate('https://moodle.example.edu/moodle/')).toBe('https://moodle.example.edu/moodle');
  });

  it('matches hosts case-insensitively', () => {
    expect(policy().validate('https://MOODLE.example.edu')).toBe('https://moodle.example.edu');
  });

  it('refuses other hosts by default', () => {
    expect(() => policy().validate('https://other.example.org')).toThrow(SiteNotAllowedError);
  });

  it('honours an explicit allow-list, which replaces the default host', () => {
    const p = policy({ allowedHosts: ['a.example.org', 'b.example.org'] });
    expect(p.validate('https://b.example.org/x')).toBe('https://b.example.org/x');
    expect(() => p.validate('https://moodle.example.edu')).toThrow(SiteNotAllowedError);
  });

  it('allows any public https host with the wildcard', () => {
    expect(policy({ allowedHosts: ['*'] }).validate('https://anything.example.org')).toBe(
      'https://anything.example.org',
    );
  });

  it.each([
    ['http', 'http://anything.example.org'],
    ['IPv4 literal', 'https://10.0.0.1'],
    ['IPv6 literal', 'https://[::1]'],
    ['localhost', 'https://localhost'],
    ['.local suffix', 'https://printer.local'],
    ['single-label host', 'https://intranet'],
    ['credentials', 'https://u:p@a.example.org'],
    ['query', 'https://a.example.org/?x=1'],
    ['fragment', 'https://a.example.org/#x'],
    ['garbage', '::'],
  ])('refuses %s even with the wildcard', (_name, url) => {
    expect(() => policy({ allowedHosts: ['*'] }).validate(url)).toThrow(SiteNotAllowedError);
  });

  it('allows local http in insecure mode (tests and development)', () => {
    const p = policy({ moodleUrl: 'http://127.0.0.1:8080', allowInsecureSites: true });
    expect(p.validate('http://127.0.0.1:8080/2025')).toBe('http://127.0.0.1:8080/2025');
  });
});

describe('SitePolicy.resolve', () => {
  it('falls back to the normalised default', () => {
    expect(policy({ moodleUrl: 'https://moodle.example.edu/2025/' }).resolve(null)).toBe(
      'https://moodle.example.edu/2025',
    );
    expect(policy().resolve('  ')).toBe('https://moodle.example.edu/2025');
  });

  it('validates a requested site', () => {
    expect(policy().resolve('https://moodle.example.edu/moodle')).toBe('https://moodle.example.edu/moodle');
    expect(() => policy().resolve('https://evil.example.org')).toThrow(SiteNotAllowedError);
  });
});
