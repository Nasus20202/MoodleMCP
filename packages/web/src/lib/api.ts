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

/** Sends a request and returns its JSON body, or throws with the backend's message. */
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(await readError(res));
  return (await res.json()) as T;
}

export const fetchConfig = () => request<ConfigResponse>('/api/config');

export async function fetchTools(): Promise<ToolInfo[]> {
  return (await request<ToolsResponse>('/api/tools')).tools;
}

/** Ask the backend to trade a QR login link for a token (Moodle requires a mobile user agent). */
export async function exchangeQR(qr: string): Promise<string> {
  const body: ExchangeRequest = { qr };
  const exchanged = await request<ExchangeResponse>('/api/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return exchanged.token;
}

/** Who is asking for access, for an authorization request (the query string the client sent). */
export const fetchAuthorizeContext = (query: string) =>
  request<AuthorizeContextResponse>(`/oauth/request${query}`);

/** Submits the consent form; resolves to the address to send the user back to, carrying the code. */
export async function submitConsent(fields: Record<string, string>): Promise<string> {
  const submitted = await request<AuthorizeSubmitResponse>('/oauth/authorize', {
    method: 'POST',
    body: new URLSearchParams(fields),
  });
  return submitted.redirectUrl;
}
