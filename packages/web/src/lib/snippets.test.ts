import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  claudeCodeCommand,
  codexCommand,
  codexConfig,
  connectionHeaders,
  headerExamples,
  jsonConfig,
  oauthClaudeCodeCommand,
  oauthExamples,
  oauthJsonConfig,
  opencodeConfig,
} from './snippets';

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

  it('renders OAuth examples without any credentials', () => {
    expect(JSON.parse(oauthJsonConfig())).toEqual({
      mcpServers: { moodle: { type: 'http', url: 'https://mcp.example/mcp' } },
    });
    expect(oauthClaudeCodeCommand()).toBe('claude mcp add --transport http moodle https://mcp.example/mcp');
  });

  it('renders OpenCode and Codex configs with the headers', () => {
    const details = { token: 't', site: 'https://m.example' };
    expect(JSON.parse(opencodeConfig(details))).toMatchObject({
      mcp: {
        moodle: {
          type: 'remote',
          url: 'https://mcp.example/mcp',
          headers: { Authorization: 'Bearer t', 'X-Moodle-URL': 'https://m.example' },
        },
      },
    });
    expect(codexConfig(details)).toBe(
      '[mcp_servers.moodle]\nurl = "https://mcp.example/mcp"\n' +
        'http_headers = { "Authorization" = "Bearer t", "X-Moodle-URL" = "https://m.example" }',
    );
  });

  it('lists the same agents for headers and OAuth, and OAuth examples carry no credentials', () => {
    const titles = (list: { title: string }[]) => list.map((e) => e.title);
    expect(titles(oauthExamples())).toEqual(titles(headerExamples({ token: 't' })));
    expect(oauthExamples().every((e) => !/Bearer|token/i.test(e.code))).toBe(true);
  });

  it('reads the Codex token from an environment variable', () => {
    const cmd = codexCommand({ token: 't' });
    expect(cmd).toContain('export MOODLE_MCP_TOKEN=t');
    expect(cmd).toContain(
      'codex mcp add moodle --url https://mcp.example/mcp --bearer-token-env-var MOODLE_MCP_TOKEN',
    );
  });

  it('warns that commands cannot set a custom site, only when one is chosen', () => {
    const note = (site?: string) =>
      headerExamples({ token: 't', ...(site && { site }) }).find((e) => e.title === 'Codex: command')?.note;
    expect(note()).toBeUndefined();
    expect(note('https://m.example')).toMatch(/custom site/);
  });
});
