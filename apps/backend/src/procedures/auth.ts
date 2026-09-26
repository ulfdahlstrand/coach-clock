import { contract } from '@coach-clock/contracts';
import { implement } from '@orpc/server';
import { clearCookie } from '../auth/cookies.js';
import { SESSION_COOKIE, deleteSessionByToken } from '../auth/session.js';
import type { ApiContext } from './matches.js';

const os = implement(contract).$context<ApiContext>();

export const getMe = os.auth.me.handler(({ context }) => ({ user: context.user }));

/**
 * Utloggning är ett vanligt POST-anrop via oRPC. Sessionscookien är
 * `SameSite=Lax` och följer därför inte med i en cross-site POST, så en annan
 * sida kan inte logga ut tränaren.
 */
export const logout = os.auth.logout.handler(async ({ context }) => {
  if (context.sessionToken !== undefined) {
    await deleteSessionByToken(context.db, context.sessionToken);
  }
  context.response.setHeader('set-cookie', clearCookie(SESSION_COOKIE, context.auth.cookieSecure));
  return { ok: true as const };
});
