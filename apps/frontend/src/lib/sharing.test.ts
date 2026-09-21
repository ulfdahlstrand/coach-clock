import { expect, test } from 'vitest';
import { formatJoinCode, lastSeenLabel, normalizeJoinCode, roleLabel } from './sharing';

test('formaterar och normaliserar anslutningskoden', () => {
  expect(formatJoinCode('k7m2qx')).toBe('K7M-2QX');
  expect(normalizeJoinCode('k7m-2qx')).toBe('K7M2QX');
});

test('översätter deltagarroll och senast sedd på svenska', () => {
  expect(roleLabel('coach')).toBe('Tränare');
  expect(lastSeenLabel('2026-09-21T10:00:00.000Z', Date.parse('2026-09-21T10:03:00.000Z'))).toBe(
    '3 min sedan',
  );
});
