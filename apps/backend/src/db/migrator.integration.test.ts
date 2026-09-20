import { sql } from 'kysely';
import { afterAll, describe, expect, it } from 'vitest';
import { readEnv } from '../env.js';
import { createDb } from './client.js';
import { migrateToLatest, reportMigrationResults } from './migrator.js';

/**
 * Kräver en körande Postgres: `npm run docker:db` från roten.
 * Körs med `npm run test:integration -w apps/backend`, aldrig i `npm test`.
 */
const db = createDb(readEnv().databaseUrl);

afterAll(async () => {
  await db.destroy();
});

describe('migrateToLatest', () => {
  it('går igenom rent mot en riktig databas', async () => {
    const resultSet = await migrateToLatest(db);

    expect(resultSet.error).toBeUndefined();
    expect(reportMigrationResults(resultSet, () => {})).toBe(true);
  });

  it('lämnar kysely-tabellerna bakom sig så nästa körning vet var den står', async () => {
    await migrateToLatest(db);

    const tables = await sql<{ table_name: string }>`
      select table_name from information_schema.tables where table_schema = 'public'
    `.execute(db);

    expect(tables.rows.map((row) => row.table_name)).toContain('kysely_migration');
  });

  it('är idempotent — andra körningen gör ingenting', async () => {
    await migrateToLatest(db);
    const second = await migrateToLatest(db);

    expect(second.error).toBeUndefined();
    expect(second.results).toEqual([]);
  });
});
