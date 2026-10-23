import { spawn } from 'node:child_process';

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs a command to completion with stdin closed (some CLIs wait for piped input) and a deadline. Asynchronous on
 * purpose: the fake model and the Worker live in this process and must keep answering while the client runs.
 */
export function run(
  command: string,
  args: string[],
  options: {
    env: Record<string, string>;
    cwd: string;
    timeoutMs: number;
    /** Called with the output so far each time more arrives, to react to what the program prints (a login URL). */
    onOutput?: (output: string) => void;
    /** Leave stdin open and silent, for programs that also read a pasted answer and give up when it closes. */
    openStdin?: boolean;
  },
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: options.env,
      cwd: options.cwd,
      stdio: [options.openStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      options.onOutput?.(stdout);
    });
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      child.stdin?.destroy();
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
  });
}
