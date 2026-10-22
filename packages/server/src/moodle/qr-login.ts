import type { QrLogin } from '@moodle-mcp/shared';

import { USER_AGENT } from './client.ts';
import { MoodleError, MoodleTransportError } from './errors.ts';
import { ensureOk, send } from './http.ts';

const METHOD = 'tool_mobile_get_tokens_for_qr_login';

interface AjaxResult {
  error?: boolean;
  data?: { token?: string };
  exception?: { errorcode: string; message: string };
}

/**
 * Trades the (single use, short lived) key from a Moodle app QR code for a web service token.
 * Browsers cannot do this themselves because Moodle insists on a "MoodleMobile" user agent.
 */
export async function exchangeQrLogin(
  login: QrLogin,
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<string> {
  const response = await send(fetchImpl, `${login.site}/lib/ajax/service-nologin.php?info=${METHOD}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': USER_AGENT },
    body: JSON.stringify([
      { index: 0, methodname: METHOD, args: { qrloginkey: login.key, userid: login.userId } },
    ]),
  });
  ensureOk(response);

  const results = (await response.json().catch(() => undefined)) as AjaxResult[] | undefined;
  const result = results?.[0];
  if (!result) throw new MoodleTransportError('Unexpected response from Moodle');
  if (result.exception) throw new MoodleError(result.exception.errorcode, result.exception.message);
  if (result.error || !result.data?.token) throw new MoodleTransportError('Login failed');
  return result.data.token;
}
