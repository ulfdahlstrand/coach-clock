import { describe, expect, it } from 'vitest';
import { readEnv } from './env.js';

describe('readEnv', () => {
  it('faller tillbaka på port 4002 och frontendens dev-origin', () => {
    expect(readEnv({})).toEqual({
      port: 4002,
      corsOrigins: ['http://localhost:5174'],
    });
  });

  it('läser port och en kommaseparerad lista av origins', () => {
    expect(readEnv({ PORT: '5000', CORS_ORIGIN: 'https://a.se, https://b.se' })).toEqual({
      port: 5000,
      corsOrigins: ['https://a.se', 'https://b.se'],
    });
  });

  it('avvisar en port som inte är ett heltal i giltigt intervall', () => {
    expect(() => readEnv({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => readEnv({ PORT: '0' })).toThrow(/PORT/);
    expect(() => readEnv({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => readEnv({ PORT: '4002.5' })).toThrow(/PORT/);
  });
});
