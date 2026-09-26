import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { OpenAPIHandler } from '@orpc/openapi/node';
import { CORSPlugin } from '@orpc/server/plugins';
import type { Kysely } from 'kysely';
import { parseCookies } from './auth/cookies.js';
import { type AuthHttpDependencies, handleAuthRequest } from './auth/http.js';
import { SESSION_COOKIE, type AuthUser, getUserBySessionToken } from './auth/session.js';
import { getDb } from './db/client.js';
import type { Database } from './db/types.js';
import type { Env } from './env.js';
import { InProcessMatchEventBroadcast, type MatchEventBroadcast } from './match-event-broadcast.js';
import { getOpenApiDocument } from './openapi.js';
import type { RateLimiter } from './rate-limit.js';
import type { JoinRateLimiter } from './rate-limit.js';
import { defaultAppendRateLimiter, defaultJoinRateLimiter } from './rate-limit.js';
import { router } from './router.js';
import { handleMatchEventStream } from './sse.js';

export interface ApiServerDependencies {
  readonly db?: Kysely<Database>;
  readonly rateLimiter?: RateLimiter;
  readonly joinRateLimiter?: JoinRateLimiter;
  readonly now?: () => Date;
  readonly eventBroadcast?: MatchEventBroadcast;
  /** fetch mot Googles tokenendpoint — utbytbar i tester. */
  readonly googleFetch?: typeof fetch;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

type DevLoginHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: AuthHttpDependencies,
) => Promise<void>;

/**
 * Laddar utvecklingsinloggningen, eller null när den inte får finnas. Filen
 * saknas i produktionsbygget, så den importeras dynamiskt och bara här.
 */
async function loadDevLogin(env: Env): Promise<DevLoginHandler | null> {
  if (!env.auth.devLogin) return null;
  const specifier: string = './auth/dev-login.dev.js';
  const module_ = (await import(specifier)) as { handleDevLogin: DevLoginHandler };
  console.warn('DEV-inloggning aktiv på GET /auth/dev-login — slå aldrig på i produktion');
  return module_.handleDevLogin;
}

/**
 * Tränaren bakom sessionscookien. Ett databasfel får inte göra varje anrop
 * till ett 500 — då behandlas anroparen som utloggad och procedurerna avgör
 * själva vad som kräver inloggning.
 */
async function resolveUser(
  db: Kysely<Database>,
  token: string | undefined,
  now: Date,
): Promise<AuthUser | null> {
  if (token === undefined) return null;
  try {
    return await getUserBySessionToken(db, token, now);
  } catch (error: unknown) {
    console.error('Kunde inte slå upp sessionen', error);
    return null;
  }
}

function createHandler(env: Env): OpenAPIHandler<{
  db: Kysely<Database>;
  clientId: string;
  rateLimiter: RateLimiter;
  joinRateLimiter: JoinRateLimiter;
  now: () => Date;
  response: ServerResponse;
  participantToken: string | undefined;
  eventBroadcast: MatchEventBroadcast;
  user: AuthUser | null;
  sessionToken: string | undefined;
  auth: Env['auth'];
}> {
  return new OpenAPIHandler(router, {
    plugins: [
      new CORSPlugin({
        // Endast origins ur env släpps in — aldrig en reflekterad wildcard,
        // eftersom cookies (credentials) följer med anropen.
        origin: (origin) => (env.corsOrigins.includes(origin) ? origin : null),
        credentials: true,
      }),
    ],
  });
}

async function route(
  env: Env,
  handler: ReturnType<typeof createHandler>,
  devLogin: Promise<DevLoginHandler | null>,
  req: IncomingMessage,
  res: ServerResponse,
  dependencies: Required<ApiServerDependencies>,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { status: 'ok', uptime: Math.round(process.uptime()) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/openapi.json') {
    sendJson(res, 200, await getOpenApiDocument());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/matches/stream') {
    await handleMatchEventStream(req, res, url, dependencies);
    return;
  }

  const authDependencies = {
    db: dependencies.db,
    auth: env.auth,
    now: dependencies.now,
    fetchImpl: dependencies.googleFetch,
  };

  if (req.method === 'GET' && url.pathname === '/auth/dev-login') {
    const handleDevLogin = await devLogin;
    if (handleDevLogin !== null) {
      await handleDevLogin(req, res, url, authDependencies);
      return;
    }
  }

  if (await handleAuthRequest(req, res, url, authDependencies)) {
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionToken = cookies[SESSION_COOKIE] || undefined;
  const { matched } = await handler.handle(req, res, {
    context: {
      ...dependencies,
      clientId: req.socket.remoteAddress ?? 'unknown',
      response: res,
      participantToken: cookies['coach_clock_participant'] || undefined,
      user: await resolveUser(dependencies.db, sessionToken, dependencies.now()),
      sessionToken,
      auth: env.auth,
    },
  });

  if (!matched) {
    sendJson(res, 404, { error: 'Not Found' });
  }
}

export function createApiServer(env: Env, supplied: ApiServerDependencies = {}): Server {
  const handler = createHandler(env);
  const devLogin = loadDevLogin(env);
  const dependencies: Required<ApiServerDependencies> = {
    db: supplied.db ?? getDb(),
    rateLimiter: supplied.rateLimiter ?? defaultAppendRateLimiter,
    joinRateLimiter: supplied.joinRateLimiter ?? defaultJoinRateLimiter,
    now: supplied.now ?? (() => new Date()),
    eventBroadcast: supplied.eventBroadcast ?? new InProcessMatchEventBroadcast(),
    googleFetch: supplied.googleFetch ?? fetch,
  };

  return createServer((req, res) => {
    route(env, handler, devLogin, req, res, dependencies).catch((error: unknown) => {
      // Logga detaljen, skicka en intetsägande kropp — fel ska inte läcka internt tillstånd.
      console.error('Obehandlat fel i request-hanteringen', error);

      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal Server Error' });
        return;
      }

      res.end();
    });
  });
}
