// Composition root. `mastra dev` and `mastra build` load this file and its exported `mastra`. It only loads the
// configuration, picks the adapters for the mode and wires them together; the logic lives in core/.
import 'dotenv/config';
import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { LocalAuthenticator } from '../adapters/local/auth/authenticator';
import { refreshTokens } from '../adapters/local/auth/oauth';
import { SessionTokenProvider } from '../adapters/local/auth/sessions';
import { PatTokenProvider } from '../adapters/local/auth/tokenProvider';
import { createModelProvider } from '../adapters/model';
import { loadProcessConfig } from '../config/load';
import { createBiService } from '../core/service';
import { localAuthRoutes, serveUi } from '../edge/mastra/local-dev';
import { createBiRoutes } from '../edge/mastra/routes';
import type { TokenProvider } from '../ports/auth';

const { config, warnings } = loadProcessConfig();
warnings.forEach((w) => console.warn(`[config] ${w}`));
if (config.mode === 'gc') throw new Error('BI_MODE=gc needs the Okta sign-in, which is not wired in yet.'); // TODO(GC:okta-verifier)

// Local: per-user Databricks login when DATABRICKS_CLIENT_ID is set; otherwise the shared token (development only).
const oauth = config.databricks.oauth;
if (!oauth) console.warn('DATABRICKS_CLIENT_ID not set: using the shared DATABRICKS_TOKEN, no user login.');
const tokens: TokenProvider = oauth ? new SessionTokenProvider((refreshToken) => refreshTokens(oauth, refreshToken)) : new PatTokenProvider(config.databricks.token);

const service = createBiService(config, { tokens, model: createModelProvider(config.model) });
const authenticator = new LocalAuthenticator(Boolean(oauth), tokens);

export const mastra = new Mastra({
  agents: service.agents,
  storage: new LibSQLStore({ id: 'mastra-storage', url: 'file:./mastra.db' }),
  server: {
    port: config.port,
    cors: { origin: ['http://localhost:5173'], allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] },
    middleware: [{ path: '/*', handler: serveUi(config) }],
    apiRoutes: [...createBiRoutes(service, authenticator, config.routePrefix), ...localAuthRoutes(config)],
  },
});
