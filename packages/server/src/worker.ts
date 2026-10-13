import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createLogger } from './logger.ts';

type App = ReturnType<typeof createApp>;

// Bindings are fixed for the lifetime of an isolate, so the app is built once, on the first request.
let app: App | undefined;

function buildApp(env: Env): App {
  const config = loadConfig(env);
  // `wrangler dev --local` has no AI binding; read_file then extracts text itself.
  const ai = env.AI as Ai | undefined;
  return createApp(config, { logger: createLogger(config.logLevel), ...(ai && { markdown: ai }) });
}

export default {
  fetch(request, env, ctx) {
    app ??= buildApp(env);
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
