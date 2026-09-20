import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Kysely } from 'kysely';
import { FileMigrationProvider, Migrator, type MigrationResultSet } from 'kysely/migration';
import type { Database } from './types.js';

/**
 * Ligger bredvid den här filen, så den pekar på `src/db/migrations` under tsx
 * och `dist/db/migrations` i ett byggt paket.
 */
export const MIGRATIONS_FOLDER = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'migrations',
);

export function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: MIGRATIONS_FOLDER,
    }),
  });
}

export function migrateToLatest(db: Kysely<Database>): Promise<MigrationResultSet> {
  return createMigrator(db).migrateToLatest();
}

export function migrateDown(db: Kysely<Database>): Promise<MigrationResultSet> {
  return createMigrator(db).migrateDown();
}

/**
 * Skriver ut vad som hände och säger om körningen gick rent.
 * Delad mellan scriptet och integrationstesterna.
 */
export function reportMigrationResults(
  { error, results }: MigrationResultSet,
  log: (message: string) => void = console.log,
): boolean {
  for (const result of results ?? []) {
    const verb = result.direction === 'Up' ? 'kördes' : 'rullades tillbaka';

    log(
      result.status === 'Success'
        ? `✓ ${result.migrationName} ${verb}`
        : `✗ ${result.migrationName} misslyckades`,
    );
  }

  if (error !== undefined) {
    return false;
  }

  if ((results ?? []).length === 0) {
    log('Inga migrationer att köra — databasen är redan i fas.');
  }

  return true;
}
