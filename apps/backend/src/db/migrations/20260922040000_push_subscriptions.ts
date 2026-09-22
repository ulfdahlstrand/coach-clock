import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('push_subscriptions')
    .addColumn('id', 'uuid', (column) => column.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('participant_id', 'uuid', (column) =>
      column.notNull().references('participants.id').onDelete('cascade'),
    )
    .addColumn('endpoint', 'text', (column) => column.notNull().unique())
    .addColumn('p256dh', 'text', (column) => column.notNull())
    .addColumn('auth', 'text', (column) => column.notNull())
    .addColumn('expiration_time', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (column) => column.notNull().defaultTo(sql`now()`))
    .addColumn('last_notified_at', 'timestamptz')
    .execute();
  await db.schema
    .createIndex('push_subscriptions_participant_id_idx')
    .on('push_subscriptions')
    .column('participant_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('push_subscriptions').execute();
}
