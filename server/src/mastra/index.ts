// Composition root. `mastra dev` and `mastra build` load this file and its exported `mastra`. It only loads the
// configuration, picks the adapters for the mode and wires them together; the logic lives in core/.
import 'dotenv/config';
import { Mastra } from '@mastra/core';
import { LibSQLStore } from '@mastra/libsql';
import { LocalAuthenticator } from '../adapters/local/auth/authenticator';
import { refreshTokens } from '../adapters/local/auth/oauth';
import { SessionTokenProvider } from '../adapters/local/auth/sessions';
import { PatTokenProvider } from '../adapters/local/auth/tokenProvider';
import { createLogger } from '../adapters/logging/logger';
import { createModelProvider } from '../adapters/model';
import { loadProcessConfig } from '../config/load';
import { createAdmission } from '../core/admission';
import { createBiService } from '../core/service';
import { localAuthRoutes, serveUi } from '../edge/mastra/local-dev';
import { createBiRoutes } from '../edge/mastra/routes';
import { securityHeaders } from '../edge/mastra/security';
import { installShutdown, ownSignalHandling } from '../edge/mastra/shutdown';
import type { TokenProvider } from '../ports/auth';

const { config, warnings } = loadProcessConfig();
const logger = createLogger(config.logging);
warnings.forEach((warning) => logger.warn('config.warning', { warning }));
if (config.mode === 'gc') throw new Error('BI_MODE=gc needs the Okta sign-in, which is not wired in yet.'); // TODO(GC:okta-verifier)

// Local: per-user Databricks login when DATABRICKS_CLIENT_ID is set; otherwise the shared token (development only).
const oauth = config.databricks.oauth;
if (!oauth) logger.warn('config.shared_token', { note: 'DATABRICKS_CLIENT_ID not set: everyone uses the shared DATABRICKS_TOKEN, no user login' });
const tokens: TokenProvider = oauth ? new SessionTokenProvider((refreshToken) => refreshTokens(oauth, refreshToken)) : new PatTokenProvider(config.databricks.token);

const model = createModelProvider(config.model);
const guardModel = config.guards.model && createModelProvider(config.guards.model);
const service = createBiService(config, { tokens, model, logger, guardModel });
logger.info('service.started', { mode: config.mode, port: config.port, spaces: config.spaces.map((s) => s.key), genieMode: config.genie.mode, model: model.label });
const authenticator = new LocalAuthenticator(Boolean(oauth), tokens);
const { service: limits } = config;
const admission = createAdmission({ enabled: limits.enabled, maxPerUser: limits.maxConcurrentPerUser, maxTotal: limits.maxConcurrentTotal });

// Shutdown is ours on every Mastra version (edge/mastra/shutdown.ts): on SIGTERM new questions are refused (503) and
// readiness fails, running answers get BI_SHUTDOWN_GRACE_MS to finish, then the process exits.
installShutdown({ admission, logger, graceMs: limits.shutdownGraceMs });
// A bug that escapes a request is logged, never silent; an uncaught exception leaves the process in an unknown state,
// so it exits and the orchestrator starts a fresh one.
process.on('unhandledRejection', (error) => logger.error('process.unhandled_rejection', { error }));
process.on('uncaughtException', (error) => {
  logger.error('process.uncaught_exception', { error });
  process.exit(1);
});

export const mastra = new Mastra({
  agents: service.agents,
  storage: new LibSQLStore({ id: 'mastra-storage', url: 'file:./mastra.db' }),
  server: {
    port: config.port,
    ...ownSignalHandling,
    cors: {
      origin: limits.corsOrigins,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', 'traceparent', 'X-Trace-Id'],
      exposeHeaders: ['X-Trace-Id', 'Retry-After'],
      credentials: config.mode === 'local', // the local login uses a cookie; GC sends a bearer token
    },
    middleware: [
      { path: '/*', handler: securityHeaders(limits.frameAncestors) },
      { path: '/*', handler: serveUi(config) },
    ],
    apiRoutes: [
      ...createBiRoutes(service, authenticator, admission, logger, { prefix: config.routePrefix, maxBodyBytes: limits.maxBodyBytes, heartbeatMs: limits.sseHeartbeatMs, build: limits.build, feedback: config.feedback }),
      ...localAuthRoutes(config),
    ],
  },
});
