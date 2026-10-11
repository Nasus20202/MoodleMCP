import * as z from 'zod/v4';

/** What each kind of sealed value contains. */
export const SealKind = {
  Client: 'client',
  Code: 'code',
  Access: 'access',
  Refresh: 'refresh',
} as const;

/** A registered client: the redirect URIs it may use. Sealed into the client id itself. */
export const clientSeal = z.object({ redirectUris: z.array(z.string()).min(1) });

/** The Moodle credentials every grant carries forward. */
const credentials = { token: z.string().min(1), site: z.string().min(1) };

export const codeSeal = z.object({
  ...credentials,
  clientId: z.string(),
  redirectUri: z.string(),
  challenge: z.string(),
});

export const accessSeal = z.object(credentials);

export const refreshSeal = z.object({ ...credentials, clientId: z.string() });

export type Credentials = z.output<typeof accessSeal>;

/** Lifetimes in seconds. */
export const Lifetime = {
  Code: 60,
  Access: 12 * 60 * 60,
  Refresh: 90 * 24 * 60 * 60,
} as const;
