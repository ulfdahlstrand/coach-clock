import { Kysely, sql, type SqlBool } from 'kysely';

/**
 * Domarens inbjudan är skild från den vanliga delningslänken. Därmed går det
 * inte att förvandla en åskådarlänk till en skrivbehörighet genom att ändra UI.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('match_referee_links')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('match_id', 'uuid', (column) =>
      column.notNull().references('matches.id').onDelete('cascade'),
    )
    .addColumn('token_hash', 'text', (column) =>
      column
        .notNull()
        .unique()
        .check(sql`char_length(token_hash) = 64`),
    )
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('revoked_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('match_referee_links_active_match_uidx')
    .unique()
    .on('match_referee_links')
    .column('match_id')
    .where(sql<SqlBool>`revoked_at is null`)
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('match_referee_links').execute();
}
