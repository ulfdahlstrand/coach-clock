/**
 * ENDAST UTVECKLING — inloggning utan Google, så att appen kan klickas igenom
 * lokalt utan riktiga OAuth-uppgifter.
 *
 * Filen byggs aldrig in i produktionsbygget (`tsconfig.build.json` utesluter
 * `src/**\/*.dev.ts`) och laddas bara dynamiskt när `ENABLE_DEV_LOGIN=true`
 * och `NODE_ENV !== 'production'` (env.ts, server.ts). Ingen produktionskod
 * får importera den.
 *
 * `GET /auth/dev-login?email=&name=&returnTo=` hittar eller skapar en användare
 * på e-post, skapar en riktig session (samma `createSession` som callbacken)
 * och skickar vidare till frontenden — allt nedströms beter sig som vanligt.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { serializeCookie } from './cookies.js';
import { type AuthHttpDependencies, sanitizeReturnTo } from './http.js';
import { SESSION_COOKIE, createSession } from './session.js';

const DEFAULT_EMAIL = 'dev@coach-clock.local';
const DEFAULT_NAME = 'Dev-tränare';

export async function handleDevLogin(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: AuthHttpDependencies,
): Promise<void> {
  const email = (url.searchParams.get('email')?.trim() || DEFAULT_EMAIL).toLowerCase();
  const name = url.searchParams.get('name')?.trim() || DEFAULT_NAME;

  const existing = await deps.db
    .selectFrom('users')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirst();
  const userId =
    existing?.id ??
    (
      await deps.db
        .insertInto('users')
        .values({ email, name, image_url: null })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;

  const { token, expiresAt } = await createSession(deps.db, userId, deps.now());

  console.warn(`DEV-inloggning som ${email} — Google förbigås`);
  res.writeHead(302, {
    location: `${deps.auth.frontendUrl}${sanitizeReturnTo(url.searchParams.get('returnTo'))}`,
    'set-cookie': serializeCookie(SESSION_COOKIE, token, {
      secure: deps.auth.cookieSecure,
      expires: expiresAt,
    }),
  });
  res.end();
}
