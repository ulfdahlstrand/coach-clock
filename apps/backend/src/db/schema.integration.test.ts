import { sql } from 'kysely';
import { NO_MIGRATIONS } from 'kysely/migration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readEnv } from '../env.js';
import { createDb } from './client.js';
import { createMigrator, migrateToLatest, reportMigrationResults } from './migrator.js';
import type { MatchFormat, ParticipantRole } from './types.js';

/**
 * Kräver en körande Postgres: `npm run docker:db` från roten.
 * Körs med `npm run test:integration -w apps/backend`, aldrig i `npm test`.
 */
const db = createDb(readEnv().databaseUrl);

const MATCH_DOMAIN_TABLES = ['teams', 'players', 'matches', 'participants', 'match_events'];

async function publicTables(): Promise<string[]> {
  const result = await sql<{ table_name: string }>`
    select table_name from information_schema.tables where table_schema = 'public'
  `.execute(db);

  return result.rows.map((row) => row.table_name);
}

/** Ett lag med en match, som de flesta testerna nedan behöver något att hänga i. */
async function createMatch(): Promise<{ teamId: string; matchId: string }> {
  const team = await db
    .insertInto('teams')
    .values({ name: 'P13 Blå' })
    .returning('id')
    .executeTakeFirstOrThrow();

  const match = await db
    .insertInto('matches')
    .values({
      team_id: team.id,
      opponent: 'Grön IF',
      format: 9,
      formation_id: '9-3-3-2',
      period_count: 2,
      period_length_seconds: 1500,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return { teamId: team.id, matchId: match.id };
}

beforeAll(async () => {
  // Börja från noll så att testerna inte ärver en halvmigrerad databas.
  await createMigrator(db).migrateTo(NO_MIGRATIONS);
  const resultSet = await migrateToLatest(db);

  expect(resultSet.error).toBeUndefined();
  expect(reportMigrationResults(resultSet, () => {})).toBe(true);
});

afterAll(async () => {
  await db.destroy();
});

describe('matchdomänens schema', () => {
  it('skapar alla tabeller migrationen lovar', async () => {
    const tables = await publicTables();

    for (const table of MATCH_DOMAIN_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it('låter en spelare höra till ett lag och ärva default-flaggorna', async () => {
    const { teamId } = await createMatch();

    const player = await db
      .insertInto('players')
      .values({ team_id: teamId, name: 'Alva', number: 7 })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(player).toMatchObject({ number: 7, is_goalkeeper: false, archived: false });
  });

  it('tar bort lagets matcher och spelare när laget försvinner', async () => {
    const { teamId, matchId } = await createMatch();
    await db.insertInto('players').values({ team_id: teamId, name: 'Alva' }).execute();

    await db.deleteFrom('teams').where('id', '=', teamId).execute();

    const match = await db
      .selectFrom('matches')
      .where('id', '=', matchId)
      .select('id')
      .executeTakeFirst();

    expect(match).toBeUndefined();
  });

  it('avvisar ett format som inte finns i ungdomsfotbollen', async () => {
    const { teamId } = await createMatch();

    // Dubbelcastad med flit: poängen är att se att databasen håller emot även
    // när typerna har kringgåtts.
    await expect(
      db
        .insertInto('matches')
        .values({
          team_id: teamId,
          opponent: 'Grön IF',
          format: 6 as unknown as MatchFormat,
          formation_id: '6-2-2-1',
          period_count: 2,
          period_length_seconds: 1500,
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('kräver att join_code och join_token_hash sätts tillsammans', async () => {
    const { teamId } = await createMatch();

    await expect(
      db
        .insertInto('matches')
        .values({
          team_id: teamId,
          opponent: 'Grön IF',
          format: 5,
          formation_id: '5-2-2',
          period_count: 2,
          period_length_seconds: 1200,
          join_code: 'ABC123',
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('låter en join_code peka på högst en pågående match, men återanvändas efteråt', async () => {
    const { teamId } = await createMatch();
    const shared = {
      team_id: teamId,
      opponent: 'Grön IF',
      format: 7 as MatchFormat,
      formation_id: '7-2-3-1',
      period_count: 2,
      period_length_seconds: 1500,
      join_code: 'DELA42',
      join_token_hash: 'c'.repeat(64),
    };

    const first = await db
      .insertInto('matches')
      .values(shared)
      .returning('id')
      .executeTakeFirstOrThrow();

    await expect(db.insertInto('matches').values(shared).execute()).rejects.toMatchObject({
      code: '23505',
    });

    await db
      .updateTable('matches')
      .set({ status: 'ended', ended_at: new Date() })
      .where('id', '=', first.id)
      .execute();

    await db.insertInto('matches').values(shared).execute();

    const active = await db
      .selectFrom('matches')
      .where('join_code', '=', shared.join_code)
      .where('status', '<>', 'ended')
      .select('id')
      .execute();

    expect(active).toHaveLength(1);
  });
});

describe('match_events', () => {
  const baseEvent = {
    event_id: 'client-generated-1',
    seq: 1,
    type: 'period.started',
    payload: { period: 1 },
    at: new Date('2026-09-20T10:05:00.000Z'),
  };

  it('stämplar received_at på servern', async () => {
    const { matchId } = await createMatch();

    const event = await db
      .insertInto('match_events')
      .values({ ...baseEvent, match_id: matchId })
      .returningAll()
      .executeTakeFirstOrThrow();

    expect(event.received_at).toBeInstanceOf(Date);
    expect(event.payload).toEqual({ period: 1 });
  });

  it('gör en omsändning av samma event_id omöjlig inom matchen', async () => {
    const { matchId } = await createMatch();
    await db
      .insertInto('match_events')
      .values({ ...baseEvent, match_id: matchId })
      .execute();

    await expect(
      db
        .insertInto('match_events')
        .values({ ...baseEvent, match_id: matchId, seq: 2 })
        .execute(),
    ).rejects.toMatchObject({ code: '23505' });

    const { rows } = await sql<{ count: string }>`
      select count(*)::text as count from match_events where match_id = ${matchId}
    `.execute(db);

    expect(rows[0]?.count).toBe('1');
  });

  it('håller idempotensen per match — samma event_id i en annan match går bra', async () => {
    const first = await createMatch();
    const second = await createMatch();

    await db
      .insertInto('match_events')
      .values({ ...baseEvent, match_id: first.matchId })
      .execute();
    await db
      .insertInto('match_events')
      .values({ ...baseEvent, match_id: second.matchId })
      .execute();

    const events = await db
      .selectFrom('match_events')
      .where('event_id', '=', baseEvent.event_id)
      .where('match_id', 'in', [first.matchId, second.matchId])
      .select('match_id')
      .execute();

    expect(events).toHaveLength(2);
  });

  it('låter inte två händelser ta samma plats i matchens ordning', async () => {
    const { matchId } = await createMatch();
    await db
      .insertInto('match_events')
      .values({ ...baseEvent, match_id: matchId })
      .execute();

    await expect(
      db
        .insertInto('match_events')
        .values({ ...baseEvent, match_id: matchId, event_id: 'client-generated-2' })
        .execute(),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('behåller loggen när deltagaren som skickade händelsen tas bort', async () => {
    const { matchId } = await createMatch();
    const participant = await db
      .insertInto('participants')
      .values({
        match_id: matchId,
        role: 'coach',
        display_name: 'Ulf',
        token_hash: 'a'.repeat(64),
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    await db
      .insertInto('match_events')
      .values({ ...baseEvent, match_id: matchId, by_participant_id: participant.id })
      .execute();

    await db.deleteFrom('participants').where('id', '=', participant.id).execute();

    const event = await db
      .selectFrom('match_events')
      .where('match_id', '=', matchId)
      .select(['event_id', 'by_participant_id'])
      .executeTakeFirstOrThrow();

    expect(event).toEqual({ event_id: baseEvent.event_id, by_participant_id: null });
  });
});

describe('participants', () => {
  it('avvisar en okänd roll', async () => {
    const { matchId } = await createMatch();

    await expect(
      db
        .insertInto('participants')
        .values({
          match_id: matchId,
          role: 'admin' as unknown as ParticipantRole,
          display_name: 'Ulf',
          token_hash: 'b'.repeat(64),
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('avvisar en tokenhash som inte är sha256 i hex', async () => {
    const { matchId } = await createMatch();

    await expect(
      db
        .insertInto('participants')
        .values({
          match_id: matchId,
          role: 'viewer',
          display_name: 'Ulf',
          token_hash: 'hemlig-token-i-klartext',
        })
        .execute(),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// Sist i filen: den här rullar ner allt och lämnar därför inget kvar åt
// testerna ovan.
describe('down', () => {
  it('rullar tillbaka hela matchdomänen och kan köras upp igen', async () => {
    const resultSet = await createMigrator(db).migrateTo(NO_MIGRATIONS);

    expect(resultSet.error).toBeUndefined();

    const afterDown = await publicTables();

    for (const table of MATCH_DOMAIN_TABLES) {
      expect(afterDown).not.toContain(table);
    }

    const up = await migrateToLatest(db);

    expect(up.error).toBeUndefined();
    expect(await publicTables()).toEqual(expect.arrayContaining(MATCH_DOMAIN_TABLES));
  });
});
