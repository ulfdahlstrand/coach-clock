# migrations

En fil per migration, namngiven `YYYYMMDDHHMMSS_snake_case.ts` — tidsstämpeln gör att
ordningen är entydig även när två personer skriver migrationer samma dag.

Varje fil exporterar `up` och `down`:

```ts
import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('teams')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (col) => col.notNull())
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('teams').execute();
}
```

`down` är inte valfri: utan den går en felaktig migration inte att backa i en integrationstest
eller på en delad utvecklingsdatabas.

Matchdomänens tabeller ligger i `20260920103000_match_domain.ts`. Filer som inte är
migrationer (som den här) ignoreras av `FileMigrationProvider` — testerna hör därför
hemma i `src/db/`, inte här.
