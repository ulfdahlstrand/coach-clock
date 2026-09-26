import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApiServer } from './server.js';

let baseUrl: string;
const server = createApiServer({
  port: 0,
  corsOrigins: ['http://localhost:5174'],
  databaseUrl: 'postgres://coach_clock:coach_clock@localhost:5434/coach_clock',
  auth: {
    google: {
      clientId: 'klient-id',
      clientSecret: 'hemlig',
      callbackUrl: 'http://localhost:5174/api/auth/google/callback',
    },
    frontendUrl: 'http://localhost:5174',
    cookieSecure: false,
    devLogin: false,
  },
});

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

describe('GET /health', () => {
  it('svarar 200 med status ok', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: 'ok' });
  });
});

describe('GET /openapi.json', () => {
  it('svarar med ett giltigt OpenAPI-dokument genererat ur kontraktet', async () => {
    const response = await fetch(`${baseUrl}/openapi.json`);
    const document = z
      .object({
        openapi: z.string().regex(/^3\.\d+\.\d+$/),
        info: z.object({ title: z.literal('coach-clock API'), version: z.literal('0.0.0') }),
        paths: z.object({
          '/matches': z.object({ get: z.object({}).passthrough() }).passthrough(),
          '/matches/share': z.object({ post: z.object({}).passthrough() }).passthrough(),
          '/matches/join': z.object({ post: z.object({}).passthrough() }).passthrough(),
          '/matches/participants': z.object({ get: z.object({}).passthrough() }).passthrough(),
          '/matches/events': z
            .object({ get: z.object({}).passthrough(), post: z.object({}).passthrough() })
            .passthrough(),
          '/players': z
            .object({ get: z.object({}).passthrough(), post: z.object({}).passthrough() })
            .passthrough(),
          '/players/update': z.object({ post: z.object({}).passthrough() }).passthrough(),
          '/teams': z
            .object({ get: z.object({}).passthrough(), post: z.object({}).passthrough() })
            .passthrough(),
          '/time': z.object({ get: z.object({}).passthrough() }).passthrough(),
        }),
      })
      .passthrough()
      .safeParse(await response.json());

    expect(response.status).toBe(200);
    expect(document.success).toBe(true);
  });
});

describe('okänd route', () => {
  it('svarar 404 istället för att hänga', async () => {
    const response = await fetch(`${baseUrl}/finns-inte`);

    expect(response.status).toBe(404);
  });
});

describe('inloggning', () => {
  it('skickar vidare till Google med en state som binds till webbläsaren', async () => {
    const response = await fetch(`${baseUrl}/auth/google?returnTo=/lag`, { redirect: 'manual' });

    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location') ?? '');
    expect(location.origin).toBe('https://accounts.google.com');
    expect(location.searchParams.get('client_id')).toBe('klient-id');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    const state = location.searchParams.get('state') ?? '';
    expect(state).toMatch(/^[0-9a-f]{32}$/);

    const cookie = response.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`coach_clock_oauth_state=${encodeURIComponent(`${state}:/lag`)}`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).not.toContain('hemlig');
  });

  it('sparar aldrig en extern adress att återvända till', async () => {
    const response = await fetch(`${baseUrl}/auth/google?returnTo=//ond.se`, {
      redirect: 'manual',
    });
    expect(response.headers.get('set-cookie')).toMatch(
      /coach_clock_oauth_state=[0-9a-f]{32}%3A%2F;/,
    );
  });

  it('avvisar en callback vars state inte stämmer, utan att röra databasen', async () => {
    const response = await fetch(`${baseUrl}/auth/google/callback?state=fel&code=kod`, {
      redirect: 'manual',
      headers: { cookie: 'coach_clock_oauth_state=ratt%3A%2F' },
    });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('http://localhost:5174/logga-in?error=failed');
    expect(response.headers.get('set-cookie')).toContain('coach_clock_oauth_state=;');
  });

  it('svarar user: null för en utloggad besökare', async () => {
    const response = await fetch(`${baseUrl}/auth/me`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ user: null });
  });

  it('kräver inloggning för lagen', async () => {
    const response = await fetch(`${baseUrl}/teams`);
    expect(response.status).toBe(401);
  });

  it('har ingen utvecklingsinloggning när den inte är påslagen', async () => {
    const response = await fetch(`${baseUrl}/auth/dev-login`, { redirect: 'manual' });
    expect(response.status).toBe(404);
  });
});
