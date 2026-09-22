import { describe, expect, it } from 'vitest';
import { readEnv } from './env.js';

describe('readEnv', () => {
  it('faller tillbaka på port 4002, frontendens dev-origin och den lokala databasen', () => {
    expect(readEnv({})).toEqual({
      port: 4002,
      corsOrigins: ['http://localhost:5174'],
      databaseUrl: 'postgres://coach_clock:coach_clock@localhost:5434/coach_clock',
      vapid: undefined,
    });
  });

  it('kräver en komplett VAPID-konfiguration och lämnar inga nycklar i källkod', () => {
    expect(() => readEnv({ VAPID_PUBLIC_KEY: 'public' })).toThrow(/tillsammans/);
    expect(
      readEnv({
        VAPID_SUBJECT: 'mailto:coach@example.test',
        VAPID_PUBLIC_KEY: 'public',
        VAPID_PRIVATE_KEY: 'private',
      }).vapid,
    ).toEqual({ subject: 'mailto:coach@example.test', publicKey: 'public', privateKey: 'private' });
  });

  it('läser port och en kommaseparerad lista av origins', () => {
    expect(readEnv({ PORT: '5000', CORS_ORIGIN: 'https://a.se, https://b.se' })).toMatchObject({
      port: 5000,
      corsOrigins: ['https://a.se', 'https://b.se'],
    });
  });

  it('kräver DATABASE_URL i produktion istället för att peka på localhost', () => {
    expect(() => readEnv({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL/);
    expect(readEnv({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x/y' })).toMatchObject({
      databaseUrl: 'postgres://x/y',
    });
  });

  it('avvisar en port som inte är ett heltal i giltigt intervall', () => {
    expect(() => readEnv({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => readEnv({ PORT: '0' })).toThrow(/PORT/);
    expect(() => readEnv({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => readEnv({ PORT: '4002.5' })).toThrow(/PORT/);
  });
});
