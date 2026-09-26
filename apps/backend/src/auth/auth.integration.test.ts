import type { AddressInfo } from 'node:net';
import { NO_MIGRATIONS } from 'kysely/migration';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../db/client.js';
import { createMigrator, migrateToLatest } from '../db/migrator.js';
import { readEnv } from '../env.js';
import { createApiServer } from '../server.js';
import { SESSION_COOKIE, hashSessionToken } from './session.js';
import { signInWithProfile } from './sign-in.js';

const env = readEnv();
const db = createDb(env.databaseUrl);
const now = new Date('2026-09-25T12:00:00.000Z');
let googleClaims: Record<string, unknown> = {};

function idToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'RS256' })}.${encode(claims)}.signatur`;
}

const server = createApiServer(
  {
    ...env,
    port: 0,
    auth: {
      google: {
        clientId: 'klient-id',
        clientSecret: 'hemlig',
        callbackUrl: 'http://localhost:5174/api/auth/google/callback',
      },
      frontendUrl: 'http://localhost:5174',
      cookieSecure: true,
      devLogin: false,
    },
  },
  {
    db,
    now: () => now,
    googleFetch: () => Promise.resolve(Response.json({ id_token: idToken(googleClaims) })),
  },
);
let baseUrl: string;

/** Kör hela flödet: /auth/google → (Google) → callback. Returnerar callbackens svar. */
async function signInThroughGoogle(returnTo = '/lag'): Promise<Response> {
  const start = await fetch(`${baseUrl}/auth/google?returnTo=${encodeURIComponent(returnTo)}`, {
    redirect: 'manual',
  });
  const state = new URL(start.headers.get('location') ?? '').searchParams.get('state') ?? '';
  const stateCookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  return fetch(`${baseUrl}/auth/google/callback?state=${state}&code=kod`, {
    redirect: 'manual',
    headers: { cookie: stateCookie },
  });
}

function sessionCookieFrom(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  return (cookie ?? '').split(';')[0] ?? '';
}

beforeAll(async () => {
  await createMigrator(db).migrateTo(NO_MIGRATIONS);
  expect((await migrateToLatest(db)).error).toBeUndefined();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await sql`truncate table sessions, identities, users restart identity cascade`.execute(db);
  googleClaims = { sub: 'google-1', email: 'Ulf@Example.se', email_verified: true, name: 'Ulf' };
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  await db.destroy();
});

describe('Google-inloggning', () => {
  it('skapar konto och session och skickar tillbaka till sidan man kom från', async () => {
    const response = await signInThroughGoogle('/lag');

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost:5174/lag');
    const setCookies = response.headers.getSetCookie();
    const session = setCookies.find((value) => value.startsWith(`${SESSION_COOKIE}=`)) ?? '';
    expect(session).toMatch(/HttpOnly; SameSite=Lax; Expires=.+; Secure$/);
    expect(setCookies.some((value) => value.startsWith('coach_clock_oauth_state=;'))).toBe(true);

    const token = sessionCookieFrom(response).slice(`${SESSION_COOKIE}=`.length);
    const stored = await db.selectFrom('sessions').select(['token_hash', 'expires_at']).execute();
    expect(stored).toEqual([
      { token_hash: hashSessionToken(token), expires_at: new Date('2026-10-25T12:00:00.000Z') },
    ]);

    const me = await fetch(`${baseUrl}/auth/me`, {
      headers: { cookie: sessionCookieFrom(response) },
    });
    const user = await db.selectFrom('users').select('id').executeTakeFirstOrThrow();
    await expect(me.json()).resolves.toEqual({
      user: { id: user.id, name: 'Ulf', email: 'ulf@example.se', imageUrl: null },
    });
  });

  it('ger samma konto vid nästa inloggning', async () => {
    await signInThroughGoogle();
    await signInThroughGoogle();

    expect(await db.selectFrom('users').select('id').execute()).toHaveLength(1);
    expect(await db.selectFrom('identities').select('id').execute()).toHaveLength(1);
    expect(await db.selectFrom('sessions').select('id').execute()).toHaveLength(2);
  });

  it('skapar inget konto för en overifierad e-postadress', async () => {
    googleClaims = { ...googleClaims, email_verified: false };
    const response = await signInThroughGoogle();

    expect(response.headers.get('location')).toBe('http://localhost:5174/logga-in?error=failed');
    expect(sessionCookieFrom(response)).toBe('');
    expect(await db.selectFrom('users').select('id').execute()).toHaveLength(0);
  });

  it('kräver att callbacken kommer från samma webbläsare som startade flödet', async () => {
    await fetch(`${baseUrl}/auth/google`, { redirect: 'manual' });
    const response = await fetch(`${baseUrl}/auth/google/callback?state=gissad&code=kod`, {
      redirect: 'manual',
    });

    expect(response.headers.get('location')).toBe('http://localhost:5174/logga-in?error=failed');
    expect(await db.selectFrom('users').select('id').execute()).toHaveLength(0);
  });
});

describe('utloggning', () => {
  it('tar bort sessionen i databasen och rensar cookien', async () => {
    const cookie = sessionCookieFrom(await signInThroughGoogle());

    const response = await fetch(`${baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { cookie },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toMatch(
      /^coach_clock_session=; Path=\/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970/,
    );
    expect(await db.selectFrom('sessions').select('id').execute()).toHaveLength(0);
    const me = await fetch(`${baseUrl}/auth/me`, { headers: { cookie } });
    await expect(me.json()).resolves.toEqual({ user: null });
  });
});

describe('signInWithProfile', () => {
  it('länkar en ny identitet till ett befintligt konto med samma verifierade e-post', async () => {
    const first = await signInWithProfile(db, {
      provider: 'google',
      subject: 'a',
      email: 'ulf@example.se',
      name: 'Ulf',
      imageUrl: null,
    });
    const second = await signInWithProfile(db, {
      provider: 'google',
      subject: 'b',
      email: 'ulf@example.se',
      name: 'Ulf',
      imageUrl: null,
    });

    expect(second).toBe(first);
    expect(await db.selectFrom('identities').select('subject').execute()).toHaveLength(2);
  });
});
