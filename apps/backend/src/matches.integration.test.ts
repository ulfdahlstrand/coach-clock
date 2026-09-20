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

function get(url: string, path: string, query: Record<string, string>): Promise<Response> {
  const search = new URLSearchParams(query);
  return fetch(`${url}${path}?${search.toString()}`);
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

describe('GET /matches', () => {
  it('returnerar matchens metadata utan tokenhash', async () => {
    const matchId = await createMatch();
    const response = await get(baseUrl, '/matches', { matchId });
    const output = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(output).toMatchObject({
      id: matchId,
      opponent: 'Grön IF',
      format: 7,
      formationId: '2-3-1',
      periodCount: 2,
      periodLengthSeconds: 1500,
      status: 'scheduled',
      joinCode: null,
      endedAt: null,
    });
    expect(output['teamId']).toMatch(/^[0-9a-f-]{36}$/);
    expect(output['createdAt']).toEqual(expect.any(String));
    expect(output).not.toHaveProperty('joinTokenHash');
  });

  it('returnerar 404 för en saknad match och 400 för ett ogiltigt id', async () => {
    const missing = await get(baseUrl, '/matches', { matchId: uuid() });
    const invalid = await get(baseUrl, '/matches', { matchId: 'inte-ett-uuid' });

    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(400);
  });
});

describe('GET /matches/events', () => {
  it('returnerar exakt händelserna efter sinceSeq i stigande seq-ordning', async () => {
    const matchId = await createMatch();
    const otherMatchId = await createMatch();
    const events = [
      periodStarted(matchId, uuid(), 1),
      periodStarted(matchId, uuid(), 2),
      periodStarted(matchId, uuid(), 3),
    ];

    for (const matchEvent of events) {
      const response = await post(baseUrl, matchEvent);
      expect(response.status).toBe(200);
    }
    expect((await post(baseUrl, periodStarted(otherMatchId))).status).toBe(200);

    const response = await get(baseUrl, '/matches/events', {
      matchId,
      sinceSeq: '1',
    });
    const output = (await response.json()) as Array<{
      seq: number;
      receivedAt: string;
      event: Record<string, unknown>;
    }>;

    expect(response.status).toBe(200);
    expect(output.map(({ seq }) => seq)).toEqual([2, 3]);
    expect(output.map(({ event }) => event)).toEqual(events.slice(1));
    expect(output.every(({ receivedAt }) => !Number.isNaN(Date.parse(receivedAt)))).toBe(true);

    const caughtUp = await get(baseUrl, '/matches/events', {
      matchId,
      sinceSeq: '3',
    });
    await expect(caughtUp.json()).resolves.toEqual([]);
  });

  it('returnerar 404 för en saknad match', async () => {
    const response = await get(baseUrl, '/matches/events', {
      matchId: uuid(),
      sinceSeq: '0',
    });

    expect(response.status).toBe(404);
  });

  it('validerar matchId och ett icke-negativt heltal för sinceSeq', async () => {
    const matchId = await createMatch();
    const missingSeq = await get(baseUrl, '/matches/events', { matchId });
    const negativeSeq = await get(baseUrl, '/matches/events', { matchId, sinceSeq: '-1' });
    const decimalSeq = await get(baseUrl, '/matches/events', { matchId, sinceSeq: '1.5' });
    const invalidMatch = await get(baseUrl, '/matches/events', {
      matchId: 'nej',
      sinceSeq: '0',
    });

    expect(missingSeq.status).toBe(400);
    expect(negativeSeq.status).toBe(400);
    expect(decimalSeq.status).toBe(400);
    expect(invalidMatch.status).toBe(400);
  });
});

describe('GET /time', () => {
  it('returnerar serverns tid utan autentisering', async () => {
    const response = await fetch(`${baseUrl}/time`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ now: serverNow.toISOString() });
  });
});
