/**
 * Inloggningens HTTP-rutter. De ligger utanför oRPC eftersom inloggning är en
 * webbläsaromdirigering, inte ett API-anrop (ADR-001).
 */
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';
import type { AuthEnv } from '../env.js';
import { clearCookie, parseCookies, serializeCookie } from './cookies.js';
import { exchangeGoogleCode, getGoogleAuthUrl } from './google.js';
import { SESSION_COOKIE, createSession } from './session.js';
import { signInWithProfile } from './sign-in.js';

export const STATE_COOKIE = 'coach_clock_oauth_state';
const STATE_TTL_SECONDS = 10 * 60;
const MAX_RETURN_TO_LENGTH = 512;

export interface AuthHttpDependencies {
  readonly db: Kysely<Database>;
  readonly auth: AuthEnv;
  readonly now: () => Date;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Var användaren ska landa efter inloggningen. Bara en sökväg på vår egen
 * frontend godtas — allt annat blir `/`, så att inloggningen inte kan användas
 * som öppen omdirigering (`//ond.se`, `/\ond.se`, `https://…`).
 */
export function sanitizeReturnTo(raw: string | null | undefined): string {
  if (
    raw === null ||
    raw === undefined ||
    raw.length > MAX_RETURN_TO_LENGTH ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\') ||
    // eslint-disable-next-line no-control-regex -- just kontrolltecken ska bort
    /[\u0000-\u001f\u007f]/.test(raw)
  ) {
    return '/';
  }
  return raw;
}

function redirect(res: ServerResponse, location: string, cookies: readonly string[] = []): void {
  res.writeHead(302, {
    location,
    'cache-control': 'no-store',
    ...(cookies.length > 0 ? { 'set-cookie': [...cookies] } : {}),
  });
  res.end();
}

function loginErrorUrl(auth: AuthEnv, error: string): string {
  return `${auth.frontendUrl}/logga-in?error=${error}`;
}

/** Hanterar /auth/google och /auth/google/callback. Returnerar false för allt annat. */
export async function handleAuthRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: AuthHttpDependencies,
): Promise<boolean> {
  const { auth } = deps;

  if (req.method === 'GET' && url.pathname === '/auth/google') {
    if (auth.google === null) {
      console.error('Google-inloggning efterfrågad men GOOGLE_CLIENT_ID m.fl. saknas');
      redirect(res, loginErrorUrl(auth, 'unavailable'));
      return true;
    }

    // Staten binder callbacken till just den här webbläsaren (CSRF i
    // OAuth-flödet). Vart användaren ska sen följer med i samma cookie, så att
    // inget av det behöver gå via Google.
    const state = randomBytes(16).toString('hex');
    const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));
    redirect(res, getGoogleAuthUrl(auth.google, state), [
      serializeCookie(STATE_COOKIE, `${state}:${returnTo}`, {
        secure: auth.cookieSecure,
        maxAgeSeconds: STATE_TTL_SECONDS,
      }),
    ]);
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/auth/google/callback') {
    const clearState = clearCookie(STATE_COOKIE, auth.cookieSecure);

    try {
      if (auth.google === null) throw new Error('Google-inloggningen är inte konfigurerad');

      const stored = parseCookies(req.headers.cookie)[STATE_COOKIE] ?? '';
      const separator = stored.indexOf(':');
      const expectedState = separator === -1 ? '' : stored.slice(0, separator);
      const returnTo = sanitizeReturnTo(separator === -1 ? '/' : stored.slice(separator + 1));
      const state = url.searchParams.get('state');
      const code = url.searchParams.get('code');

      if (code === null || state === null || expectedState === '' || state !== expectedState) {
        throw new Error('OAuth-state eller kod saknas eller stämmer inte');
      }

      const profile = await exchangeGoogleCode(auth.google, code, deps.fetchImpl);
      const userId = await signInWithProfile(deps.db, profile);
      const { token, expiresAt } = await createSession(deps.db, userId, deps.now());

      redirect(res, `${auth.frontendUrl}${returnTo}`, [
        clearState,
        serializeCookie(SESSION_COOKIE, token, { secure: auth.cookieSecure, expires: expiresAt }),
      ]);
    } catch (error: unknown) {
      console.error('Inloggningen misslyckades', error);
      redirect(res, loginErrorUrl(auth, 'failed'), [clearState]);
    }
    return true;
  }

  return false;
}
