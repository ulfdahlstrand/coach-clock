import { describe, expect, it } from 'vitest';
import { clearCookie, parseCookies, serializeCookie } from './cookies.js';

describe('parseCookies', () => {
  it('läser flera cookies och avkodar värdena', () => {
    expect(parseCookies('a=1; coach_clock_session=x%3Ay; tom=')).toEqual({
      a: '1',
      coach_clock_session: 'x:y',
    });
  });

  it('tål en saknad header och trasig kodning', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('trasig=%E0%A4%A; ok=1')).toEqual({ ok: '1' });
  });
});

describe('serializeCookie', () => {
  it('är alltid HttpOnly och SameSite=Lax', () => {
    expect(serializeCookie('s', 'v', { secure: false })).toBe(
      's=v; Path=/; HttpOnly; SameSite=Lax',
    );
  });

  it('lägger till Secure och utgång när det efterfrågas', () => {
    const cookie = serializeCookie('s', 'v', {
      secure: true,
      expires: new Date('2026-10-01T00:00:00.000Z'),
      maxAgeSeconds: 60,
    });
    expect(cookie).toContain('Expires=Thu, 01 Oct 2026 00:00:00 GMT');
    expect(cookie).toContain('Max-Age=60');
    expect(cookie).toMatch(/; Secure$/);
  });

  it('rensar en cookie med ett passerat datum', () => {
    expect(clearCookie('s', false)).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });
});
