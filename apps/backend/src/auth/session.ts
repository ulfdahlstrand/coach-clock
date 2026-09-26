/** Opaka sessionstokens, lagrade som hash (ADR-001). */
import { createHash, randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { Database } from '../db/types.js';

export const SESSION_COOKIE = 'coach_clock_session';
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

/** Den inloggade tränaren, som procedurerna ser den via kontexten. */
export interface AuthUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly imageUrl: string | null;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  db: Kysely<Database>,
  userId: string,
  now: Date,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  // Städar användarens utgångna sessioner vid varje ny inloggning, så att
  // tabellen inte växer för evigt utan ett separat städjobb.
  await db
    .deleteFrom('sessions')
    .where('user_id', '=', userId)
    .where('expires_at', '<=', now)
    .execute();
  await db
    .insertInto('sessions')
    .values({ user_id: userId, token_hash: hashSessionToken(token), expires_at: expiresAt })
    .execute();

  return { token, expiresAt };
}

/** Löser en klartexttoken till sin användare, eller null om den är okänd eller utgången. */
export async function getUserBySessionToken(
  db: Kysely<Database>,
  token: string,
  now: Date,
): Promise<AuthUser | null> {
  const row = await db
    .selectFrom('sessions')
    .innerJoin('users', 'users.id', 'sessions.user_id')
    .select(['users.id', 'users.name', 'users.email', 'users.image_url'])
    .where('sessions.token_hash', '=', hashSessionToken(token))
    .where('sessions.expires_at', '>', now)
    .executeTakeFirst();

  if (row === undefined) return null;
  return { id: row.id, name: row.name, email: row.email, imageUrl: row.image_url };
}

export async function deleteSessionByToken(db: Kysely<Database>, token: string): Promise<void> {
  await db.deleteFrom('sessions').where('token_hash', '=', hashSessionToken(token)).execute();
}
