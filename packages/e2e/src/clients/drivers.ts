import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { anthropic } from './anthropic.ts';
import { chat } from './chat.ts';
import { codeModeTools, directTools, type Invoker, loadWithToolSearch } from './invoker.ts';
import { responses } from './responses.ts';

export interface ClientRun {
  /** The scripted model's address, `http://127.0.0.1:port`. */
  modelUrl: string;
  /** The Worker's MCP endpoint. */
  mcpUrl: string;
  /** Credentials for the static-header setup, what a user pastes into the client's config; absent when the client signs in with OAuth. */
  token: string | undefined;
  /** An empty directory the client may treat as its home and working directory. */
  home: string;
}

/** A coding agent that can be pointed at a model endpoint and an MCP server from the command line. */
export interface ClientDriver {
  /** Name in the matrix. */
  name: string;
  /** The executable to find on PATH. */
  command: string;
  invoker: Invoker;
  /** Whether the client lists every tool up front (Code Mode clients show a part of them). */
  listsAllTools: boolean;
  /** Whether image blocks in a tool result reach the model (Code Mode returns only what the script returns, as text). */
  forwardsImages: boolean;
  args(run: ClientRun): string[];
  env(run: ClientRun): Record<string, string>;
  /** The command that signs the client in with OAuth, printing the authorization URL; absent when it cannot be scripted. */
  login?: {
    /** The program that signs in; the client itself unless it has no command for that. */
    command?: string;
    args(run: ClientRun): string[];
    /** Stops what the login left running. */
    cleanup?(run: ClientRun): Promise<void> | void;
  };
}

const PROMPT = 'Call the tools you are asked to call.';

const claudeMcpConfig = (run: ClientRun): string =>
  JSON.stringify({
    mcpServers: {
      moodle: {
        type: 'http',
        url: run.mcpUrl,
        ...(run.token && { headers: { Authorization: `Bearer ${run.token}` } }),
      },
    },
  });

const claudeCode: ClientDriver = {
  name: 'Claude Code',
  command: 'claude',
  invoker: directTools(anthropic, 'mcp__moodle__', loadWithToolSearch),
  listsAllTools: true,
  forwardsImages: true,
  args: (run) => [
    '-p',
    PROMPT,
    '--model',
    'claude-sonnet-5-5',
    '--strict-mcp-config',
    '--mcp-config',
    claudeMcpConfig(run),
    '--allowedTools',
    'mcp__moodle',
  ],
  env: (run) => ({
    HOME: run.home,
    ANTHROPIC_BASE_URL: run.modelUrl,
    ANTHROPIC_API_KEY: 'sk-ant-not-a-real-key',
  }),
  // Claude Code signs in to MCP servers only from its terminal UI, which the script drives.
  login: {
    command: 'python3',
    args: (run) => [
      fileURLToPath(new URL('claude-login.py', import.meta.url)),
      run.home,
      claudeMcpConfig(run),
    ],
  },
};

/** Codex keeps OAuth credentials in the keyring by default; a file works wherever the tests run. */
const codexMcpConfig = (run: ClientRun): string[] => [
  '-c',
  `mcp_servers.moodle.url="${run.mcpUrl}"`,
  '-c',
  'mcp_oauth_credentials_store="file"',
  ...(run.token ? ['-c', 'mcp_servers.moodle.bearer_token_env_var="MOODLE_TOKEN"'] : []),
];

const codex: ClientDriver = {
  name: 'Codex',
  command: 'codex',
  invoker: directTools(responses, 'mcp__moodle__', () => undefined),
  listsAllTools: true,
  forwardsImages: true,
  args: (run) => [
    'exec',
    '--skip-git-repo-check',
    '-m',
    'scripted',
    '-c',
    'model_provider="scripted"',
    '-c',
    `model_providers.scripted={name="scripted",base_url="${run.modelUrl}/v1",env_key="SCRIPTED_MODEL_KEY",wire_api="responses",request_max_retries=0,stream_max_retries=0}`,
    ...codexMcpConfig(run),
    PROMPT,
  ],
  env: (run) => ({ HOME: run.home, SCRIPTED_MODEL_KEY: 'not-a-real-key', MOODLE_TOKEN: run.token ?? '' }),
  login: { args: (run) => ['mcp', 'login', 'moodle', '--no-browser', ...codexMcpConfig(run)] },
};

/** opencode's configuration is read from this variable, so nothing is written to (or read from) the user's own. */
const opencodeConfig = (run: ClientRun): string =>
  JSON.stringify({
    model: 'scripted/scripted',
    provider: {
      scripted: {
        npm: '@ai-sdk/openai-compatible',
        name: 'scripted',
        options: { baseURL: `${run.modelUrl}/v1`, apiKey: 'not-a-real-key' },
        models: { scripted: { name: 'scripted', tool_call: true } },
      },
    },
    mcp: {
      moodle: {
        type: 'remote',
        url: run.mcpUrl,
        ...(run.token && { headers: { Authorization: `Bearer ${run.token}` } }),
      },
    },
  });

const opencodeEnv = (run: ClientRun): Record<string, string> => ({
  HOME: run.home,
  XDG_CONFIG_HOME: `${run.home}/.config`,
  XDG_DATA_HOME: `${run.home}/.local/share`,
  XDG_CACHE_HOME: `${run.home}/.cache`,
  XDG_STATE_HOME: `${run.home}/.local/state`,
  OPENCODE_CONFIG_CONTENT: opencodeConfig(run),
});

const opencode: ClientDriver = {
  name: 'opencode',
  command: 'opencode',
  invoker: codeModeTools(chat),
  listsAllTools: false,
  forwardsImages: false,
  args: () => ['run', '--standalone', '--auto', PROMPT],
  env: opencodeEnv,
  login: {
    args: () => ['mcp', 'auth', 'moodle'],
    // `mcp auth` starts opencode's background service, which records its process id in the state directory.
    cleanup(run) {
      try {
        const service = JSON.parse(
          readFileSync(`${run.home}/.local/state/opencode/service.json`, 'utf8'),
        ) as {
          pid: number;
        };
        process.kill(service.pid);
      } catch {
        // No service was started, or it has already gone.
      }
    },
  },
};

export const DRIVERS: ClientDriver[] = [claudeCode, codex, opencode];

/** Whether `command` is on PATH, and its version for the log. */
export function installed(command: string): string | undefined {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return result.status === 0 ? result.stdout.trim().split('\n')[0] : undefined;
}
