import * as z from 'zod/v4';

import type { LogLevel } from './logger.ts';

export const DEFAULT_MOODLE_URL = 'https://enauczanie.pg.edu.pl/2025';

/** Wildcard for ALLOWED_MOODLE_HOSTS: any public https host. */
export const ANY_HOST = '*';

const MIN_OAUTH_SECRET_LENGTH = 32;

const envSchema = z.object({
  MOODLE_URL: z.url({ protocol: /^https?$/ }).default(DEFAULT_MOODLE_URL),
  ALLOWED_MOODLE_HOSTS: z.string().default(ANY_HOST),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  OAUTH_SECRET: z.string().min(MIN_OAUTH_SECRET_LENGTH).optional(),
});

export interface AppConfig {
  /** Default Moodle site; callers may override it with the site header. */
  moodleUrl: string;
  /** Hosts callers may select via the site header. Empty means only the default site's host; "*" means any public https host. */
  allowedHosts: readonly string[];
  /** Permit http and non-public hosts. For tests and local development only. */
  allowInsecureSites: boolean;
  logLevel: LogLevel;
  /** Key for the OAuth tokens (see `oauth/`). Without it OAuth is off and only raw Moodle tokens work. */
  oauthSecret?: string | undefined;
}

/** Reads and validates the Worker's environment bindings. Throws with a readable message when invalid. */
export function loadConfig(
  env: Partial<Record<keyof z.input<typeof envSchema>, string | undefined>>,
): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid configuration: ${z.prettifyError(parsed.error)}`);
  return {
    moodleUrl: parsed.data.MOODLE_URL,
    allowedHosts: parsed.data.ALLOWED_MOODLE_HOSTS.split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    allowInsecureSites: false,
    logLevel: parsed.data.LOG_LEVEL,
    oauthSecret: parsed.data.OAUTH_SECRET,
  };
}
