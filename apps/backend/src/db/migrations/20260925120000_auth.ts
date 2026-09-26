import { Kysely, sql } from 'kysely';

/**
 * Inloggning för tränaren (docs/tech-decisions.md, ADR-001).
 *
 * - users:      konton. E-posten är nyckeln som identiteter länkas på.
 * - identities: en rad per OAuth-identitet (provider + subject). Flera kan
 *               peka på samma användare — Google i dag, fler leverantörer sen.
 * - sessions:   serverhanterade sessioner. Bara sha256 av sessionstoken lagras,
 *               på samma sätt som deltagartokens.
 * - teams.owner_user_id: laget tillhör den som skapade det. Nullbar eftersom
 *               lag skapade före inloggningen saknar ägare; de syns inte för
 *               någon förrän de tilldelas (docs/deployment.md).
 *
 * Domare och åskådare berörs inte: de går fortfarande med via länk utan konto (#16).
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('users')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('email', 'text', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('image_url', 'text')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex('users_email_idx').on('users').column('email').execute();

  await db.schema
    .createTable('identities')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (column) =>
      column.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('provider', 'text', (column) => column.notNull())
    .addColumn('subject', 'text', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('identities_provider_subject_uq', ['provider', 'subject'])
    .execute();

  await db.schema
    .createTable('sessions')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('user_id', 'uuid', (column) =>
      column.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('token_hash', 'text', (column) =>
      column
        .notNull()
        .unique()
        .check(sql`char_length(token_hash) = 64`),
    )
    .addColumn('expires_at', 'timestamptz', (column) => column.notNull())
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema.createIndex('sessions_user_id_idx').on('sessions').column('user_id').execute();

  await db.schema
    .alterTable('teams')
    .addColumn('owner_user_id', 'uuid', (column) => column.references('users.id'))
    .execute();

  await db.schema
    .createIndex('teams_owner_user_id_idx')
    .on('teams')
    .column('owner_user_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropIndex('teams_owner_user_id_idx').execute();
  await db.schema.alterTable('teams').dropColumn('owner_user_id').execute();
  await db.schema.dropTable('sessions').execute();
  await db.schema.dropTable('identities').execute();
  await db.schema.dropTable('users').execute();
}
