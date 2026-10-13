import type {
  AuthorizeContextResponse,
  AuthorizeSubmitResponse,
  ConfigResponse,
  ErrorResponse,
  ExchangeRequest,
  ExchangeResponse,
  ToolInfo,
  ToolsResponse,
} from '@moodle-mcp/shared';

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as Partial<ErrorResponse>;
  return body.error ?? `Backend returned ${res.status}`;
}

export async function fetchConfig(): Promise<ConfigResponse> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as ConfigResponse;
}

export async function fetchTools(): Promise<ToolInfo[]> {
  const res = await fetch('/api/tools');
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as ToolsResponse).tools;
}

/** Ask the backend to trade a QR login link for a token (Moodle requires a mobile user agent). */
export async function exchangeQR(qr: string): Promise<string> {
  const body: ExchangeRequest = { qr };
  const res = await fetch('/api/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as ExchangeResponse).token;
}

/** Who is asking for access, for an authorization request (the query string the client sent). */
export async function fetchAuthorizeContext(query: string): Promise<AuthorizeContextResponse> {
  const res = await fetch(`/oauth/request${query}`);
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as AuthorizeContextResponse;
}

/** Submits the consent form; resolves to the address to send the user back to, carrying the code. */
export async function submitConsent(fields: Record<string, string>): Promise<string> {
  const res = await fetch('/oauth/authorize', { method: 'POST', body: new URLSearchParams(fields) });
  if (!res.ok) throw new Error(await readError(res));
  return ((await res.json()) as AuthorizeSubmitResponse).redirectUrl;
}
