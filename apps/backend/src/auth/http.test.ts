import { describe, expect, it } from 'vitest';
import { sanitizeReturnTo } from './http.js';

describe('sanitizeReturnTo', () => {
  it('släpper igenom sökvägar på den egna frontenden', () => {
    expect(sanitizeReturnTo('/lag')).toBe('/lag');
    expect(sanitizeReturnTo('/matches/new?teamId=1')).toBe('/matches/new?teamId=1');
  });

  it.each([
    null,
    undefined,
    '',
    'lag',
    'https://ond.se',
    '//ond.se',
    '/\\ond.se',
    '/\tond',
    `/${'a'.repeat(600)}`,
  ])('gör %j till /', (raw) => {
    expect(sanitizeReturnTo(raw)).toBe('/');
  });
});
