import { Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import { readEnv } from '../env.js';
import type { Database } from './types.js';

export function createDb(connectionString: string): Kysely<Database> {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString }),
    }),
  });
}

let instance: Kysely<Database> | undefined;

/**
 * Lazy singleton: poolen skapas först när någon faktiskt frågar efter den.
 *
 * Det är hela poängen — enhetstester kan importera vad som helst härifrån utan
 * att ha vare sig `DATABASE_URL` eller en körande databas.
 */
export function getDb(): Kysely<Database> {
  instance ??= createDb(readEnv().databaseUrl);

  return instance;
}

export async function destroyDb(): Promise<void> {
  if (instance === undefined) {
    return;
  }

  const db = instance;
  instance = undefined;
  await db.destroy();
}
