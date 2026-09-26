import type { AddressInfo } from 'node:net';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApiServer } from '../server.js';
import { createDb, destroyDb } from '../db/client.js';
import { createMigrator, migrateToLatest, reportMigrationResults } from '../db/migrator.js';
import { readEnv } from '../env.js';
import { SESSION_COOKIE, createSession } from '../auth/session.js';
import { NO_MIGRATIONS } from 'kysely/migration';

const env = readEnv();
const db = createDb(env.databaseUrl);
const server = createApiServer({ ...env, port: 0 });
let baseUrl: string;
/** Sessionscookien för tränaren som äger lagen i testerna. */
let cookie: string;

async function signIn(email: string): Promise<string> {
  const user = await db
    .insertInto('users')
    .values({ email, name: email, image_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const { token } = await createSession(db, user.id, new Date());
  return `${SESSION_COOKIE}=${token}`;
}

interface TeamResponse {
  id: string;
  name: string;
  createdAt: string;
}

interface PlayerResponse {
  id: string;
  teamId: string;
  name: string;
  number: number | null;
  isGoalkeeper: boolean;
  archived: boolean;
}

async function post<T>(
  path: string,
  body: unknown,
  as = cookie,
): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: as },
    body: JSON.stringify(body),
  });

  return { response, body: (await response.json()) as T };
}

async function createTeam(name = 'P13 Blå'): Promise<TeamResponse> {
  const { response, body } = await post<TeamResponse>('/teams', { name });
  expect(response.status).toBe(200);
  return body;
}

async function createPlayer(
  teamId: string,
  values: Partial<Pick<PlayerResponse, 'name' | 'number' | 'isGoalkeeper'>> = {},
): Promise<PlayerResponse> {
  const { response, body } = await post<PlayerResponse>('/players', {
    teamId,
    name: 'Alva',
    ...values,
  });
  expect(response.status).toBe(200);
  return body;
}

beforeAll(async () => {
  await createMigrator(db).migrateTo(NO_MIGRATIONS);
  const resultSet = await migrateToLatest(db);
  expect(resultSet.error).toBeUndefined();
  expect(reportMigrationResults(resultSet, () => {})).toBe(true);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  await sql`
    truncate table match_events, participants, matches, players, teams, sessions, identities, users
    restart identity cascade
  `.execute(db);
  cookie = await signIn('ulf@example.se');
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await destroyDb();
  await db.destroy();
});

describe('lag-API', () => {
  it('skapar, trimmar och listar lag utan response-envelope', async () => {
    const first = await createTeam('  P13 Blå  ');
    const second = await createTeam('P15 Vit');

    expect(first).toMatchObject({ name: 'P13 Blå' });
    expect(first.createdAt).toEqual(expect.any(String));

    const response = await fetch(`${baseUrl}/teams`, { headers: { cookie } });
    const body = (await response.json()) as TeamResponse[];

    expect(response.status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body.map(({ id }) => id)).toEqual([first.id, second.id]);
  });
});

describe('spelar-API', () => {
  it('skapar spelare med defaultvärden och listar bara det efterfrågade laget', async () => {
    const team = await createTeam();
    const otherTeam = await createTeam('P14 Grön');
    const player = await createPlayer(team.id);
    await createPlayer(otherTeam.id, { name: 'Bo', number: 12, isGoalkeeper: true });

    expect(player).toMatchObject({
      teamId: team.id,
      name: 'Alva',
      number: null,
      isGoalkeeper: false,
      archived: false,
    });

    const response = await fetch(`${baseUrl}/players?teamId=${team.id}`, { headers: { cookie } });
    const body = (await response.json()) as PlayerResponse[];

    expect(response.status).toBe(200);
    expect(body).toEqual([player]);
  });

  it('uppdaterar alla redigerbara fält och låter nummer rensas', async () => {
    const team = await createTeam();
    const player = await createPlayer(team.id, { number: 7 });

    const updated = await post<PlayerResponse>('/players/update', {
      teamId: team.id,
      playerId: player.id,
      name: 'Alva Andersson',
      number: null,
      isGoalkeeper: true,
      archived: true,
    });

    expect(updated.response.status).toBe(200);
    expect(updated.body).toEqual({
      ...player,
      name: 'Alva Andersson',
      number: null,
      isGoalkeeper: true,
      archived: true,
    });

    const listed = await fetch(`${baseUrl}/players?teamId=${team.id}`, { headers: { cookie } });
    await expect(listed.json()).resolves.toEqual([updated.body]);
  });

  it('arkiverar utan att ta bort spelaren eller historik som refererar till den', async () => {
    const team = await createTeam();
    const player = await createPlayer(team.id, { number: 9 });
    const match = await db
      .insertInto('matches')
      .values({
        team_id: team.id,
        opponent: 'Grön IF',
        format: 7,
        formation_id: '7-2-3-1',
        period_count: 3,
        period_length_seconds: 1200,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('match_events')
      .values({
        match_id: match.id,
        event_id: 'historik-1',
        seq: 1,
        type: 'lineup_set',
        payload: { playerIds: [player.id] },
        at: new Date('2026-09-20T12:00:00.000Z'),
      })
      .execute();

    const archived = await post<PlayerResponse>('/players/update', {
      teamId: team.id,
      playerId: player.id,
      archived: true,
    });
    const storedPlayer = await db
      .selectFrom('players')
      .selectAll()
      .where('id', '=', player.id)
      .executeTakeFirst();
    const storedEvent = await db
      .selectFrom('match_events')
      .select('payload')
      .where('match_id', '=', match.id)
      .executeTakeFirstOrThrow();

    expect(archived.body.archived).toBe(true);
    expect(storedPlayer).toMatchObject({ id: player.id, archived: true });
    expect(storedEvent.payload).toEqual({ playerIds: [player.id] });
  });

  it('kan inte skapa en spelare för ett lag som saknas', async () => {
    const missingTeamId = '00000000-0000-4000-8000-000000000000';
    const { response } = await post<unknown>('/players', {
      teamId: missingTeamId,
      name: 'Ingen',
    });

    expect(response.status).toBe(404);
    const rows = await db.selectFrom('players').select('id').execute();
    expect(rows).toHaveLength(0);
  });

  it('scopar uppdateringen till laget och lämnar spelaren orörd vid fel lag', async () => {
    const team = await createTeam();
    const otherTeam = await createTeam('P14 Grön');
    const player = await createPlayer(team.id);

    const { response } = await post<unknown>('/players/update', {
      teamId: otherTeam.id,
      playerId: player.id,
      name: 'Fel lag',
    });

    expect(response.status).toBe(404);
    const stored = await db
      .selectFrom('players')
      .select(['name', 'team_id'])
      .where('id', '=', player.id)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ name: 'Alva', team_id: team.id });
  });
});

describe('ägarskap', () => {
  it('kräver inloggning för att lista och skapa lag', async () => {
    expect((await fetch(`${baseUrl}/teams`)).status).toBe(401);
    const { response } = await post<unknown>('/teams', { name: 'P13 Blå' }, '');
    expect(response.status).toBe(401);
    expect(await db.selectFrom('teams').select('id').execute()).toHaveLength(0);
  });

  it('visar bara tränarens egna lag och knyter nya lag till tränaren', async () => {
    const mine = await createTeam('Mitt lag');
    const other = await signIn('annan@example.se');
    await post<TeamResponse>('/teams', { name: 'Annans lag' }, other);

    const response = await fetch(`${baseUrl}/teams`, { headers: { cookie } });
    const body = (await response.json()) as TeamResponse[];
    expect(body.map(({ id }) => id)).toEqual([mine.id]);
  });

  it('svarar 404 på någon annans lag, som om det inte fanns', async () => {
    const team = await createTeam();
    const player = await createPlayer(team.id);
    const other = await signIn('annan@example.se');

    const listed = await fetch(`${baseUrl}/players?teamId=${team.id}`, {
      headers: { cookie: other },
    });
    const created = await post<unknown>('/players', { teamId: team.id, name: 'Inkräktare' }, other);
    const updated = await post<unknown>(
      '/players/update',
      { teamId: team.id, playerId: player.id, name: 'Kapad' },
      other,
    );

    expect([listed.status, created.response.status, updated.response.status]).toEqual([
      404, 404, 404,
    ]);
    const stored = await db.selectFrom('players').select('name').execute();
    expect(stored).toEqual([{ name: 'Alva' }]);
  });

  it('gömmer lag från före inloggningen tills de tilldelas en ägare', async () => {
    await db.insertInto('teams').values({ name: 'Föräldralöst' }).execute();

    const response = await fetch(`${baseUrl}/teams`, { headers: { cookie } });
    expect(await response.json()).toEqual([]);
  });

  it('behandlar en utgången session som utloggad', async () => {
    await db
      .updateTable('sessions')
      .set({ expires_at: new Date(Date.now() - 1_000) })
      .execute();
    expect((await fetch(`${baseUrl}/teams`, { headers: { cookie } })).status).toBe(401);
  });
});
