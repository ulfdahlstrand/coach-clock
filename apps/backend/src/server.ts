import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { OpenAPIHandler } from '@orpc/openapi/node';
import { CORSPlugin } from '@orpc/server/plugins';
import type { Kysely } from 'kysely';
import { getDb } from './db/client.js';
import type { Database } from './db/types.js';
import type { Env } from './env.js';
import { getOpenApiDocument } from './openapi.js';
import type { RateLimiter } from './rate-limit.js';
import type { JoinRateLimiter } from './rate-limit.js';
import { defaultAppendRateLimiter, defaultJoinRateLimiter } from './rate-limit.js';
import { router } from './router.js';

export interface ApiServerDependencies {
  readonly db?: Kysely<Database>;
  readonly rateLimiter?: RateLimiter;
  readonly joinRateLimiter?: JoinRateLimiter;
  readonly now?: () => Date;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function createHandler(env: Env): OpenAPIHandler<{
  db: Kysely<Database>;
  clientId: string;
  rateLimiter: RateLimiter;
  joinRateLimiter: JoinRateLimiter;
  now: () => Date;
  response: ServerResponse;
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
  handler: ReturnType<typeof createHandler>,
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

  const { matched } = await handler.handle(req, res, {
    context: {
      ...dependencies,
      clientId: req.socket.remoteAddress ?? 'unknown',
      response: res,
    },
  });

  if (!matched) {
    sendJson(res, 404, { error: 'Not Found' });
  }
}

export function createApiServer(env: Env, supplied: ApiServerDependencies = {}): Server {
  const handler = createHandler(env);
  const dependencies: Required<ApiServerDependencies> = {
    db: supplied.db ?? getDb(),
    rateLimiter: supplied.rateLimiter ?? defaultAppendRateLimiter,
    joinRateLimiter: supplied.joinRateLimiter ?? defaultJoinRateLimiter,
    now: supplied.now ?? (() => new Date()),
  };

  return createServer((req, res) => {
    route(handler, req, res, dependencies).catch((error: unknown) => {
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
