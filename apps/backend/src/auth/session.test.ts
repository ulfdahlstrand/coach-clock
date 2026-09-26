import { describe, expect, it } from 'vitest';
import { generateSessionToken, hashSessionToken } from './session.js';

describe('sessionstokens', () => {
  it('är 32 slumpbytes som base64url och aldrig samma två gånger', () => {
    const token = generateSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateSessionToken()).not.toBe(token);
  });

  it('lagras som sha256 i hex — klartexten syns inte i hashen', () => {
    const hash = hashSessionToken('token');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashSessionToken('token'));
    expect(hash).not.toContain('token');
  });
});
