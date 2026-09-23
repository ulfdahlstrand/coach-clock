import { describe, expect, it } from 'vitest';
import { resolveTestDatabaseUrl } from './test-database.js';

const TEST = 'postgres://coach_clock:coach_clock@localhost:5434/coach_clock_test';
const DEV = 'postgres://coach_clock:coach_clock@localhost:5434/coach_clock';

describe('integrationstesternas databas', () => {
  it('använder TEST_DATABASE_URL', () => {
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: TEST, DATABASE_URL: DEV })).toBe(TEST);
  });

  it('vägrar starta utan TEST_DATABASE_URL i stället för att falla tillbaka på utvecklingsdatabasen', () => {
    expect(() => resolveTestDatabaseUrl({ DATABASE_URL: DEV })).toThrow(/TEST_DATABASE_URL/);
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: '  ' })).toThrow(/TEST_DATABASE_URL/);
  });

  it('vägrar peka på utvecklingsdatabasen', () => {
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: DEV })).toThrow(/test/);
  });

  it('vägrar peka på utvecklingsdatabasen även om DATABASE_URL är satt till något annat', () => {
    expect(() =>
      resolveTestDatabaseUrl({ TEST_DATABASE_URL: DEV, DATABASE_URL: 'postgres://x/other_test' }),
    ).toThrow(/test/);
  });

  it('godtar att DATABASE_URL redan pekar på testdatabasen, som i CI', () => {
    expect(resolveTestDatabaseUrl({ TEST_DATABASE_URL: TEST, DATABASE_URL: TEST })).toBe(TEST);
  });

  it('säger ifrån om adressen inte går att tolka', () => {
    expect(() => resolveTestDatabaseUrl({ TEST_DATABASE_URL: 'inte en adress' })).toThrow(
      /TEST_DATABASE_URL/,
    );
  });
});
