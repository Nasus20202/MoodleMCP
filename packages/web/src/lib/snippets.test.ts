import { beforeEach, describe, expect, it, vi } from 'vitest';

import { claudeCodeCommand, connectionHeaders, jsonConfig } from './snippets';

beforeEach(() => vi.stubGlobal('location', { origin: 'https://mcp.example' }));

describe('connectionHeaders', () => {
  it('sends only Authorization for the default site', () => {
    expect(connectionHeaders({ token: 't' })).toEqual({ Authorization: 'Bearer t' });
  });

  it('adds the site header for a custom site', () => {
    expect(connectionHeaders({ token: 't', site: 'https://m.example/x' })).toEqual({
      Authorization: 'Bearer t',
      'X-Moodle-URL': 'https://m.example/x',
    });
  });
});

describe('snippets', () => {
  it('renders a generic JSON config', () => {
    const cfg = JSON.parse(jsonConfig({ token: 't', site: 'https://m.example' })) as {
      mcpServers: Record<string, unknown>;
    };
    expect(cfg.mcpServers.moodle).toEqual({
      type: 'http',
      url: 'https://mcp.example/mcp',
      headers: { Authorization: 'Bearer t', 'X-Moodle-URL': 'https://m.example' },
    });
  });

  it('renders a Claude Code command with one --header per header', () => {
    const cmd = claudeCodeCommand({ token: 't', site: 'https://m.example' });
    expect(cmd).toContain('claude mcp add --transport http moodle https://mcp.example/mcp');
    expect(cmd.match(/--header/g)).toHaveLength(2);
  });
});
