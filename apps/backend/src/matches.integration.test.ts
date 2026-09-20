import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { NO_MIGRATIONS } from 'kysely/migration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from './db/client.js';
import { createMigrator, migrateToLatest } from './db/migrator.js';
import { readEnv } from './env.js';
import { FixedWindowRateLimiter } from './rate-limit.js';
import { createApiServer } from './server.js';

const env = readEnv();
const db = createDb(env.databaseUrl);
const serverNow = new Date('2026-09-20T12:00:00.000Z');
const server = createApiServer(env, {
  db,
  now: () => serverNow,
  rateLimiter: new FixedWindowRateLimiter({ maxRequests: 100, windowMs: 60_000 }),
});
const limitedServer = createApiServer(env, {
  db,
  now: () => serverNow,
  rateLimiter: new FixedWindowRateLimiter({ maxRequests: 1, windowMs: 60_000 }),
});

let baseUrl: string;
let limitedBaseUrl: string;
let nextId = 0;

function uuid(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
}

async function listen(serverToStart: Server): Promise<string> {
  await new Promise<void>((resolve) => serverToStart.listen(0, '127.0.0.1', resolve));
  const address = serverToStart.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(serverToClose: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    serverToClose.close((error) => (error ? reject(error) : resolve()));
  });
}

async function createMatch(): Promise<string> {
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
      format: 7,
      formation_id: '2-3-1',
      period_count: 2,
      period_length_seconds: 1500,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return match.id;
}

function periodStarted(matchId: string, eventId = uuid(), periodNumber = 1) {
  return {
    eventId,
    matchId,
    v: 1,
    at: '2026-09-20T11:59:00.000Z',
    by: 'coach:ulf',
    type: 'period_started',
    periodNumber,
  } as const;
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(`${url}/matches/events`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await createMigrator(db).migrateTo(NO_MIGRATIONS);
  const migrations = await migrateToLatest(db);
  expect(migrations.error).toBeUndefined();
  [baseUrl, limitedBaseUrl] = await Promise.all([listen(server), listen(limitedServer)]);
});

afterAll(async () => {
  await Promise.all([close(server), close(limitedServer)]);
  await db.destroy();
});

describe('POST /matches/events', () => {
  it('validerar händelsen och lagrar serverns received_at', async () => {
    const matchId = await createMatch();
    const event = periodStarted(matchId);
    const before = new Date();

    const response = await post(baseUrl, event);
    const output = (await response.json()) as Record<string, unknown>;
    const after = new Date();

    expect(response.status).toBe(200);
    expect(output).toMatchObject({ eventId: event.eventId, matchId, seq: 1 });
    expect(new Date(output['receivedAt'] as string).getTime()).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(new Date(output['receivedAt'] as string).getTime()).toBeLessThanOrEqual(after.getTime());

    const stored = await db
      .selectFrom('match_events')
      .selectAll()
      .where('event_id', '=', event.eventId)
      .executeTakeFirstOrThrow();
    expect(stored.payload).toEqual({ by: 'coach:ulf', periodNumber: 1, v: 1 });
    expect(stored.at.toISOString()).toBe(event.at);
  });

  it('gör dubbel-POST idempotent och returnerar samma seq', async () => {
    const matchId = await createMatch();
    const event = periodStarted(matchId);

    const [first, second] = await Promise.all([post(baseUrl, event), post(baseUrl, event)]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstOutput = await first.json();
    const secondOutput = await second.json();
    expect(secondOutput).toEqual(firstOutput);

    const rows = await db
      .selectFrom('match_events')
      .select(['seq', 'payload'])
      .where('match_id', '=', matchId)
      .execute();
    expect(rows).toEqual([{ seq: 1, payload: { by: 'coach:ulf', periodNumber: 1, v: 1 } }]);
  });

  it('tilldelar unika monotona seq vid samtidiga skrivningar', async () => {
    const matchId = await createMatch();
    const requests = Array.from({ length: 12 }, (_, index) =>
      post(baseUrl, periodStarted(matchId, uuid(), (index % 10) + 1)),
    );

    const responses = await Promise.all(requests);
    expect(responses.every((response) => response.status === 200)).toBe(true);
    const outputs = (await Promise.all(responses.map((response) => response.json()))) as Array<{
      seq: number;
    }>;
    expect(outputs.map(({ seq }) => seq).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );

    const rows = await db
      .selectFrom('match_events')
      .select('seq')
      .where('match_id', '=', matchId)
      .orderBy('seq')
      .execute();
    expect(rows.map(({ seq }) => seq)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });

  it('avvisar en orimligt framtida at och okända matcher', async () => {
    const matchId = await createMatch();
    const future = await post(baseUrl, {
      ...periodStarted(matchId),
      at: '2026-09-20T12:05:00.001Z',
    });
    const missing = await post(baseUrl, periodStarted(uuid()));

    expect(future.status).toBe(400);
    expect(missing.status).toBe(404);
    expect(
      await db.selectFrom('match_events').select('id').where('match_id', '=', matchId).execute(),
    ).toHaveLength(0);
  });

  it('avvisar data som inte följer händelseschemat', async () => {
    const matchId = await createMatch();
    const response = await post(baseUrl, { ...periodStarted(matchId), periodNumber: 11 });

    expect(response.status).toBe(400);
    expect(
      await db.selectFrom('match_events').select('id').where('match_id', '=', matchId).execute(),
    ).toHaveLength(0);
  });

  it('rate-limit:ar upprepade append-anrop per klient och match', async () => {
    const matchId = await createMatch();
    const event = periodStarted(matchId);
    const first = await post(limitedBaseUrl, event);
    const retry = await post(limitedBaseUrl, event);
    const blocked = await post(limitedBaseUrl, periodStarted(matchId));

    expect(first.status).toBe(200);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await first.json());
    expect(blocked.status).toBe(429);
  });
});
