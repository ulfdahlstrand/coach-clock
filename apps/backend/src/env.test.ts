import { describe, expect, it } from 'vitest';
import { readEnv } from './env.js';

const production: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgres://x/y',
  GOOGLE_CLIENT_ID: 'id',
  GOOGLE_CLIENT_SECRET: 'hemlig',
  AUTH_CALLBACK_URL: 'https://web.se/api/auth/google/callback',
  FRONTEND_URL: 'https://web.se/',
};

describe('readEnv', () => {
  it('faller tillbaka på port 4002, frontendens dev-origin och den lokala databasen', () => {
    expect(readEnv({})).toEqual({
      port: 4002,
      corsOrigins: ['http://localhost:5174'],
      databaseUrl: 'postgres://coach_clock:coach_clock@localhost:5434/coach_clock',
      auth: {
        google: null,
        frontendUrl: 'http://localhost:5174',
        cookieSecure: false,
        devLogin: false,
      },
    });
  });

  it('läser port och en kommaseparerad lista av origins', () => {
    expect(readEnv({ PORT: '5000', CORS_ORIGIN: 'https://a.se, https://b.se' })).toMatchObject({
      port: 5000,
      corsOrigins: ['https://a.se', 'https://b.se'],
    });
  });

  it('kräver DATABASE_URL i produktion istället för att peka på localhost', () => {
    expect(() => readEnv({ ...production, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(readEnv(production)).toMatchObject({
      databaseUrl: 'postgres://x/y',
    });
  });

  it('kräver Google-klienten och FRONTEND_URL i produktion', () => {
    expect(() => readEnv({ ...production, GOOGLE_CLIENT_SECRET: undefined })).toThrow(
      /GOOGLE_CLIENT_ID/,
    );
    expect(() => readEnv({ ...production, FRONTEND_URL: undefined })).toThrow(/FRONTEND_URL/);
    expect(readEnv(production).auth).toEqual({
      google: {
        clientId: 'id',
        clientSecret: 'hemlig',
        callbackUrl: 'https://web.se/api/auth/google/callback',
      },
      frontendUrl: 'https://web.se',
      cookieSecure: true,
      devLogin: false,
    });
  });

  it('låter aldrig utvecklingsinloggningen slås på i produktion', () => {
    expect(readEnv({ ENABLE_DEV_LOGIN: 'true' }).auth.devLogin).toBe(true);
    expect(readEnv({ ...production, ENABLE_DEV_LOGIN: 'true' }).auth.devLogin).toBe(false);
  });

  it('låter COOKIE_SECURE styra Secure-flaggan uttryckligen', () => {
    expect(readEnv({ COOKIE_SECURE: 'true' }).auth.cookieSecure).toBe(true);
    expect(readEnv({ ...production, COOKIE_SECURE: 'false' }).auth.cookieSecure).toBe(false);
  });

  it('avvisar en port som inte är ett heltal i giltigt intervall', () => {
    expect(() => readEnv({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => readEnv({ PORT: '0' })).toThrow(/PORT/);
    expect(() => readEnv({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => readEnv({ PORT: '4002.5' })).toThrow(/PORT/);
  });
});
