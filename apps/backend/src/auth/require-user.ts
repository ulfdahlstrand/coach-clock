import { ORPCError } from '@orpc/server';
import type { AuthUser } from './session.js';

/** Den inloggade tränaren, eller UNAUTHORIZED — för skyddade procedurer. */
export function requireUser(context: { readonly user: AuthUser | null }): AuthUser {
  if (context.user === null) {
    throw new ORPCError('UNAUTHORIZED', { message: 'Logga in först' });
  }
  return context.user;
}
