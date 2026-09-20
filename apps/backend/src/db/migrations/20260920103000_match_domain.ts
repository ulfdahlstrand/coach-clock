import { Kysely, sql, type SqlBool } from 'kysely';

/**
 * Matchdomänens grundschema: lag, spelare, matcher, deltagare och händelselogg.
 *
 * Två saker styr utformningen:
 *
 * 1. `match_events` är en append-only logg per match. Speltid räknas aldrig upp
 *    i en kolumn någonstans — den härleds genom att vika loggen. Därför finns
 *    ingen `update`-vänlig struktur här, bara rader som läggs till.
 * 2. Idempotens. Klienten sätter `event_id` och kan skicka om samma händelse
 *    hur många gånger som helst efter en tapp; det unika indexet på
 *    `(match_id, event_id)` gör omsändningen till en no-op istället för en
 *    dubblett i loggen.
 *
 * Tabellerna skapas i beroendeordning (deltagare före händelser, eftersom
 * `by_participant_id` pekar dit) och `down` släpper dem i omvänd ordning.
 */

const uuidPrimaryKey = sql`gen_random_uuid()`;
const now = sql`now()`;

/** sha256 i hex — 64 tecken. Vi lagrar aldrig en token i klartext. */
const SHA256_HEX_LENGTH = 64;

export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('teams')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(uuidPrimaryKey))
    .addColumn('name', 'text', (col) => col.notNull().check(sql`length(trim(name)) > 0`))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(now))
    .execute();

  await db.schema
    .createTable('players')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(uuidPrimaryKey))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('name', 'text', (col) => col.notNull().check(sql`length(trim(name)) > 0`))
    // Tröjnummer är frivilligt — alla ungdomslag delar inte ut nummer.
    .addColumn('number', 'integer', (col) => col.check(sql`number > 0`))
    .addColumn('is_goalkeeper', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('archived', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();

  await db.schema.createIndex('players_team_id_idx').on('players').column('team_id').execute();

  await db.schema
    .createTable('matches')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(uuidPrimaryKey))
    .addColumn('team_id', 'uuid', (col) => col.notNull().references('teams.id').onDelete('cascade'))
    .addColumn('opponent', 'text', (col) => col.notNull())
    // Spelformerna i svensk ungdomsfotboll. Fler format kräver en ny migration
    // — det är en medveten broms, formatet styr planen och formationerna.
    .addColumn('format', 'integer', (col) => col.notNull().check(sql`format in (5, 7, 9, 11)`))
    .addColumn('formation_id', 'text', (col) => col.notNull())
    .addColumn('period_count', 'integer', (col) => col.notNull().check(sql`period_count > 0`))
    .addColumn('period_length_seconds', 'integer', (col) =>
      col.notNull().check(sql`period_length_seconds > 0`),
    )
    .addColumn('status', 'text', (col) =>
      col
        .notNull()
        .defaultTo('scheduled')
        .check(sql`status in ('scheduled', 'live', 'ended')`),
    )
    // Delningen sätts på i #16. Koden och tokenhashen hör ihop: antingen är
    // matchen delad, eller så är den inte det.
    .addColumn('join_code', 'text')
    .addColumn('join_token_hash', 'text', (col) =>
      col.check(sql`char_length(join_token_hash) = ${sql.lit(SHA256_HEX_LENGTH)}`),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(now))
    .addColumn('ended_at', 'timestamptz')
    .addCheckConstraint(
      'matches_join_code_and_token_together',
      sql`(join_code is null) = (join_token_hash is null)`,
    )
    .execute();

  await db.schema.createIndex('matches_team_id_idx').on('matches').column('team_id').execute();

  // En kod ska peka på exakt en match som fortfarande pågår. Avslutade matcher
  // lämnar tillbaka sin kod till poolen — partiellt index, inte globalt unikt.
  await db.schema
    .createIndex('matches_active_join_code_uidx')
    .unique()
    .on('matches')
    .column('join_code')
    .where(sql<SqlBool>`status <> 'ended'`)
    .execute();

  await db.schema
    .createTable('participants')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(uuidPrimaryKey))
    .addColumn('match_id', 'uuid', (col) =>
      col.notNull().references('matches.id').onDelete('cascade'),
    )
    .addColumn('role', 'text', (col) =>
      col.notNull().check(sql`role in ('owner', 'coach', 'referee', 'viewer')`),
    )
    .addColumn('display_name', 'text', (col) =>
      col.notNull().check(sql`length(trim(display_name)) > 0`),
    )
    // Unikt i hela tabellen: tokenhashen är legitimationen och slår upp
    // deltagaren utan att anroparen behöver veta vilken match det gäller.
    .addColumn('token_hash', 'text', (col) =>
      col
        .notNull()
        .unique()
        .check(sql`char_length(token_hash) = ${sql.lit(SHA256_HEX_LENGTH)}`),
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(now))
    .addColumn('last_seen_at', 'timestamptz', (col) => col.notNull().defaultTo(now))
    .execute();

  await db.schema
    .createIndex('participants_match_id_idx')
    .on('participants')
    .column('match_id')
    .execute();

  await db.schema
    .createTable('match_events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(uuidPrimaryKey))
    .addColumn('match_id', 'uuid', (col) =>
      col.notNull().references('matches.id').onDelete('cascade'),
    )
    // Klientens id för händelsen. Idempotensnyckeln — se det unika indexet nedan.
    .addColumn('event_id', 'text', (col) => col.notNull().check(sql`length(event_id) > 0`))
    // Serverns ordningsnummer, monotont per match och tätt från 1. Foldens
    // ordning läses härifrån, aldrig ur `at` (klientklockor går fel).
    .addColumn('seq', 'integer', (col) => col.notNull().check(sql`seq > 0`))
    // Ingen check på typerna: loggen är append-only och måste kunna ta emot en
    // händelsetyp som är nyare än schemat. Kontraktet (#7) validerar istället.
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    // `at` är när händelsen inträffade enligt klienten, `received_at` när
    // servern tog emot den. Båda behövs för att kunna reda ut en sen leverans.
    .addColumn('at', 'timestamptz', (col) => col.notNull())
    .addColumn('received_at', 'timestamptz', (col) => col.notNull().defaultTo(now))
    .addColumn('by_participant_id', 'uuid', (col) =>
      col.references('participants.id').onDelete('set null'),
    )
    .execute();

  // Hjärtat i idempotensen: samma händelse två gånger blir en krock, inte en
  // dubblett. Append-logiken i #13 fångar krocken och svarar med raden som
  // redan finns.
  await db.schema
    .createIndex('match_events_match_id_event_id_uidx')
    .unique()
    .on('match_events')
    .columns(['match_id', 'event_id'])
    .execute();

  // Garanterar att två samtidiga appends inte kan ta samma plats i ordningen,
  // och är samtidigt indexet läsningen viker loggen längs.
  await db.schema
    .createIndex('match_events_match_id_seq_uidx')
    .unique()
    .on('match_events')
    .columns(['match_id', 'seq'])
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('match_events').execute();
  await db.schema.dropTable('participants').execute();
  await db.schema.dropTable('matches').execute();
  await db.schema.dropTable('players').execute();
  await db.schema.dropTable('teams').execute();
}
