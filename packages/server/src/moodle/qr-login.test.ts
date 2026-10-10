import { describe, expect, it } from 'vitest';

import { fakeMoodle, TEST_SITE } from '../test-utils.ts';
import { MoodleError, MoodleTransportError } from './errors.ts';
import { exchangeQrLogin } from './qr-login.ts';

const login = { site: TEST_SITE, key: 'k', userId: 7 };

describe('exchangeQrLogin', () => {
  it('posts the key as the mobile app and returns the token', async () => {
    const moodle = fakeMoodle(() => [{ error: false, data: { token: 'secret', privatetoken: 'p' } }]);
    expect(await exchangeQrLogin(login, moodle.fetch)).toBe('secret');

    const [call] = moodle.calls;
    expect(call?.url.pathname).toBe('/2025/lib/ajax/service-nologin.php');
    expect(call?.headers.get('User-Agent')).toContain('MoodleMobile');
    expect(call?.body).toEqual([
      { index: 0, methodname: 'tool_mobile_get_tokens_for_qr_login', args: { qrloginkey: 'k', userid: 7 } },
    ]);
  });

  it('reports Moodle exceptions', async () => {
    const moodle = fakeMoodle(() => [
      { error: true, exception: { errorcode: 'qrcodedisabled', message: 'off' } },
    ]);
    await expect(exchangeQrLogin(login, moodle.fetch)).rejects.toBeInstanceOf(MoodleError);
  });

  it.each([
    ['garbage', () => new Response('garbage')],
    ['empty list', () => []],
    ['no token', () => [{ error: false, data: {} }]],
    ['HTTP error', () => new Response('x', { status: 500 })],
  ])('rejects %s as a transport error', async (_name, respond) => {
    const moodle = fakeMoodle(respond);
    await expect(exchangeQrLogin(login, moodle.fetch)).rejects.toBeInstanceOf(MoodleTransportError);
  });
});
