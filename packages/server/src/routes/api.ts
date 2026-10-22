import type { ConfigResponse, ExchangeResponse, ToolInfo, ToolsResponse } from '@moodle-mcp/shared';
import { parseQrLogin } from '@moodle-mcp/shared';
import { Hono } from 'hono';
import * as z from 'zod/v4';

import { limitBody } from '../http/body-limit.ts';
import { exchangeQrLogin } from '../moodle/qr-login.ts';
import type { SitePolicy } from '../site-policy.ts';
import { toolCatalog } from '../tools/catalog.ts';

const MAX_EXCHANGE_BODY_BYTES = 4096;
const CACHE_SECONDS = 300;

const exchangeRequest = z.object({ qr: z.string().min(1).max(MAX_EXCHANGE_BODY_BYTES) });

/** The JSON API behind the setup page. */
export function apiRoutes(deps: { policy: SitePolicy; fetch: typeof fetch; oauth: boolean }): Hono {
  const { policy } = deps;
  // Built on first use: converting every tool schema costs CPU that /mcp requests never need.
  let catalog: ToolInfo[] | undefined;

  return new Hono()
    .get('/api/config', (c) => {
      c.header('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
      return c.json<ConfigResponse>({ moodleUrl: policy.defaultUrl, oauth: deps.oauth });
    })
    .get('/api/tools', (c) => {
      c.header('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
      return c.json<ToolsResponse>({ tools: (catalog ??= toolCatalog()) });
    })
    .post('/api/exchange', limitBody(MAX_EXCHANGE_BODY_BYTES), async (c) => {
      // Trades the content of a Moodle app QR code for a token. Only sites allowed by the site policy are
      // contacted, and the one-time key is neither stored nor logged.
      const { qr } = exchangeRequest.parse(await c.req.json().catch(() => undefined));
      const login = parseQrLogin(qr);
      policy.validate(login.site);
      const token = await exchangeQrLogin(login, deps.fetch);

      c.header('Cache-Control', 'no-store');
      return c.json<ExchangeResponse>({ token });
    });
}
