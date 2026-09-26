import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash } from 'node:crypto';
import type { SequencedMatchEvent } from '@coach-clock/contracts';
import { NO_MIGRATIONS } from 'kysely/migration';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SESSION_COOKIE, createSession } from './auth/session.js';
import { createDb } from './db/client.js';
import { createMigrator, migrateToLatest } from './db/migrator.js';
import { readEnv } from './env.js';
import { ExponentialBackoffRateLimiter, FixedWindowRateLimiter } from './rate-limit.js';
import { createApiServer } from './server.js';

const env = readEnv();
const db = createDb(env.databaseUrl);
const serverNow = new Date('2026-09-20T12:00:00.000Z');
let joinLimiterNow = serverNow.getTime();
const server = createApiServer(env, {
  db,
  now: () => serverNow,
  rateLimiter: new FixedWindowRateLimiter({ maxRequests: 100, windowMs: 60_000 }),
  joinRateLimiter: new ExponentialBackoffRateLimiter({
    baseDelayMs: 1,
    maxDelayMs: 60_000,
    now: () => joinLimiterNow,
  }),
});
const limitedServer = createApiServer(env, {
  db,
  now: () => serverNow,
  rateLimiter: new FixedWindowRateLimiter({ maxRequests: 1, windowMs: 60_000 }),
  joinRateLimiter: new ExponentialBackoffRateLimiter({ baseDelayMs: 60_000, maxDelayMs: 60_000 }),
});

let baseUrl: string;
let limitedBaseUrl: string;
let nextId = 0;
/** Tränaren som äger lagen nedan, och sessionscookien hen skickar med. */
let coach: { id: string; cookie: string };

async function signIn(email: string): Promise<{ id: string; cookie: string }> {
  const user = await db
    .insertInto('users')
    .values({ email, name: email, image_url: null })
    .returning('id')
    .executeTakeFirstOrThrow();
  const { token } = await createSession(db, user.id, serverNow);
  return { id: user.id, cookie: `${SESSION_COOKIE}=${token}` };
}

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
    .values({ name: 'P13 Blå', owner_user_id: coach.id })
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

async function createParticipant(matchId: string, role: 'owner' | 'coach' | 'referee' | 'viewer') {
  const token = `test-participant-${uuid()}`;
  const participant = await db
    .insertInto('participants')
    .values({
      match_id: matchId,
      role,
      display_name: `${role} test`,
      token_hash: createHash('sha256').update(token).digest('hex'),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return { id: participant.id, token };
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

async function post(url: string, body: unknown, token?: string): Promise<Response> {
  let participantToken = token;
  if (
    participantToken === undefined &&
    typeof body === 'object' &&
    body !== null &&
    'matchId' in body
  ) {
    const matchId = body.matchId;
    if (typeof matchId === 'string') {
      const match = await db
        .selectFrom('matches')
        .select('id')
        .where('id', '=', matchId)
        .executeTakeFirst();
      if (match !== undefined) participantToken = (await createParticipant(matchId, 'coach')).token;
    }
  }
  return fetch(`${url}/matches/events`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(participantToken === undefined
        ? {}
        : { cookie: `coach_clock_participant=${participantToken}` }),
    },
    body: JSON.stringify(body),
  });
}

async function postTo(
  url: string,
  path: string,
  body: unknown,
  token?: string,
  /** null = utloggad. */
  session: string | null = coach.cookie,
): Promise<Response> {
  const cookies = [
    ...(token === undefined ? [] : [`coach_clock_participant=${token}`]),
    ...(session === null ? [] : [session]),
  ];
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookies.length === 0 ? {} : { cookie: cookies.join('; ') }),
    },
    body: JSON.stringify(body),
  });
}

function get(
  url: string,
  path: string,
  query: Record<string, string>,
  token?: string,
): Promise<Response> {
  const search = new URLSearchParams(query);
  return fetch(`${url}${path}?${search.toString()}`, {
    headers: token === undefined ? {} : { cookie: `coach_clock_participant=${token}` },
  });
}

type SseMessage = {
  readonly id: string;
  readonly data: SequencedMatchEvent;
};

async function openEventStream(matchId: string, lastEventId?: number) {
  const controller = new AbortController();
  const init: RequestInit = { signal: controller.signal };
  if (lastEventId !== undefined) init.headers = { 'Last-Event-ID': String(lastEventId) };

  const response = await fetch(`${baseUrl}/matches/stream?matchId=${matchId}`, init);
  const body = response.body;
  if (body === null) throw new Error('SSE-svaret saknar body');
  const reader = body.getReader();

  const decoder = new TextDecoder();
  let buffer = '';

  async function nextMessage(): Promise<SseMessage> {
    const readMessage = async (): Promise<SseMessage> => {
      while (true) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (block.startsWith(':')) continue;

          const lines = block.split('\n');
          const id = lines.find((line) => line.startsWith('id: '))?.slice(4);
          const data = lines.find((line) => line.startsWith('data: '))?.slice(6);
          if (id !== undefined && data !== undefined) {
            return { id, data: JSON.parse(data) as SequencedMatchEvent };
          }
          continue;
        }

        const chunk = await reader.read();
        if (chunk.done) throw new Error('SSE-strömmen stängdes före nästa händelse');
        buffer += decoder.decode(chunk.value as Uint8Array<ArrayBuffer>, { stream: true });
      }
    };

    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        readMessage(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Timeout i väntan på SSE-händelse')), 2_000);
        }),
      ]);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  return {
    response,
    nextMessage,
    async close() {
      await reader.cancel();
      controller.abort();
    },
  };
}

beforeAll(async () => {
  await createMigrator(db).migrateTo(NO_MIGRATIONS);
  const migrations = await migrateToLatest(db);
  expect(migrations.error).toBeUndefined();
  coach = await signIn('ulf@example.se');
  [baseUrl, limitedBaseUrl] = await Promise.all([listen(server), listen(limitedServer)]);
});

describe('POST /matches', () => {
  it('skapar ägarsession och en komplett matchlogg som väntar på avspark', async () => {
    const team = await db
      .insertInto('teams')
      .values({ name: 'F11 Blå', owner_user_id: coach.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    const roster = await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        db
          .insertInto('players')
          .values({ team_id: team.id, name: `Spelare ${index + 1}`, is_goalkeeper: index === 0 })
          .returning('id')
          .executeTakeFirstOrThrow(),
      ),
    );
    const formation = ['gk', 'cb-left', 'cb-right', 'lm', 'cm', 'rm', 'st'];
    const response = await postTo(baseUrl, '/matches', {
      teamId: team.id,
      opponent: 'Grön IF',
      format: 7,
      formationId: '7v7-2-3-1',
      periodCount: 3,
      periodLengthSeconds: 900,
      presentPlayerIds: roster.map((player) => player.id),
      assignments: formation.map((slotId, index) => ({ slotId, playerId: roster[index]?.id })),
    });
    const body = (await response.json()) as { id: string; status: string };

    expect(response.status).toBe(200);
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(body.status).toBe('live');
    const events = await db
      .selectFrom('match_events')
      .select(['seq', 'type'])
      .where('match_id', '=', body.id)
      .orderBy('seq')
      .execute();
    // Klockan startar först när domaren eller tränaren blåser igång (#89).
    expect(events.map((event) => event.type)).toEqual(['match_created', 'squad_set', 'lineup_set']);
  });
});

afterAll(async () => {
  await Promise.all([close(server), close(limitedServer)]);
  await db.destroy();
});

describe('POST /matches/events', () => {
  it('validerar händelsen och lagrar serverns received_at', async () => {
    const matchId = await createMatch();
    const event = periodStarted(matchId);

    const response = await post(baseUrl, event);
    const output = (await response.json()) as Record<string, unknown>;
    const receivedAt = output['receivedAt'];

    expect(response.status).toBe(200);
    expect(output).toMatchObject({ eventId: event.eventId, matchId, seq: 1 });
    expect(typeof receivedAt).toBe('string');
    if (typeof receivedAt !== 'string') throw new Error('receivedAt saknas i svaret');
    expect(Number.isNaN(Date.parse(receivedAt))).toBe(false);

    const stored = await db
      .selectFrom('match_events')
      .selectAll()
      .where('event_id', '=', event.eventId)
      .executeTakeFirstOrThrow();
    expect(stored.payload).toEqual({ by: 'coach:ulf', periodNumber: 1, v: 1 });
    expect(stored.at.toISOString()).toBe(event.at);
    expect(stored.received_at.toISOString()).toBe(receivedAt);
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

  it('avvisar en orimligt framtida at och osignerade skrivningar mot okända matcher', async () => {
    const matchId = await createMatch();
    const future = await post(baseUrl, {
      ...periodStarted(matchId),
      at: '2026-09-20T12:05:00.001Z',
    });
    const missing = await post(baseUrl, periodStarted(uuid()));

    expect(future.status).toBe(400);
    // Sessionen granskas före matchuppslagning så en anonym klient inte kan
    // använda skrivendpointen för att slå upp vilka match-id:n som finns.
    expect(missing.status).toBe(401);
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

  it('nekar en referee att bekräfta ett spelarbyte', async () => {
    const matchId = await createMatch();
    const referee = await createParticipant(matchId, 'referee');
    const response = await post(
      baseUrl,
      {
        eventId: uuid(),
        matchId,
        v: 1,
        at: '2026-09-20T11:59:00.000Z',
        by: 'referee:anna',
        type: 'substitution_confirmed',
        swaps: [
          {
            slotId: 'cm',
            outPlayerId: uuid(),
            inPlayerId: uuid(),
          },
        ],
      },
      referee.token,
    );

    expect(response.status).toBe(403);
    await expect(
      db.selectFrom('match_events').select('id').where('match_id', '=', matchId).execute(),
    ).resolves.toHaveLength(0);
  });

  it('nekar en viewer varje försök att skriva en matchhändelse', async () => {
    const matchId = await createMatch();
    const viewer = await createParticipant(matchId, 'viewer');
    const response = await post(baseUrl, periodStarted(matchId), viewer.token);

    expect(response.status).toBe(403);
    await expect(
      db.selectFrom('match_events').select('id').where('match_id', '=', matchId).execute(),
    ).resolves.toHaveLength(0);
  });

  it('sparar ångra och tidsrättning som nya, validerade händelser utan att radera originalet', async () => {
    const matchId = await createMatch();
    const coach = await createParticipant(matchId, 'coach');
    const original = periodStarted(matchId);
    expect((await post(baseUrl, original, coach.token)).status).toBe(200);

    const correction = {
      eventId: uuid(),
      matchId,
      v: 1,
      at: '2026-09-20T12:00:00.000Z',
      by: 'coach:ulf',
      type: 'event_time_corrected',
      targetEventId: original.eventId,
      correctedAt: '2026-09-20T11:58:00.000Z',
    } as const;
    expect((await post(baseUrl, correction, coach.token)).status).toBe(200);

    const undone = {
      eventId: uuid(),
      matchId,
      v: 1,
      at: '2026-09-20T12:00:00.000Z',
      by: 'coach:ulf',
      type: 'event_undone',
      targetEventId: correction.eventId,
    } as const;
    expect((await post(baseUrl, undone, coach.token)).status).toBe(200);

    const rows = await db
      .selectFrom('match_events')
      .select(['event_id', 'type'])
      .where('match_id', '=', matchId)
      .orderBy('seq')
      .execute();
    expect(rows).toEqual([
      { event_id: original.eventId, type: 'period_started' },
      { event_id: correction.eventId, type: 'event_time_corrected' },
      { event_id: undone.eventId, type: 'event_undone' },
    ]);
  });

  it('stänger matchen vid match_ended och öppnar den igen när avslutet ångras', async () => {
    const matchId = await createMatch();
    const owner = await createParticipant(matchId, 'owner');
    const status = () =>
      db
        .selectFrom('matches')
        .select(['status', 'ended_at'])
        .where('id', '=', matchId)
        .executeTakeFirstOrThrow();

    const ended = {
      eventId: uuid(),
      matchId,
      v: 1,
      at: '2026-09-20T11:59:00.000Z',
      by: 'owner',
      type: 'match_ended',
    } as const;
    expect((await post(baseUrl, ended, owner.token)).status).toBe(200);
    // Delningskoden och domarlänken räknar sin respit från ended_at.
    expect(await status()).toEqual({ status: 'ended', ended_at: serverNow });

    const undone = {
      eventId: uuid(),
      matchId,
      v: 1,
      at: '2026-09-20T12:00:00.000Z',
      by: 'owner',
      type: 'event_undone',
      targetEventId: ended.eventId,
    } as const;
    expect((await post(baseUrl, undone, owner.token)).status).toBe(200);
    expect(await status()).toEqual({ status: 'live', ended_at: null });
  });

  it('avvisar en rättelse som inte pekar på en befintlig originalhändelse', async () => {
    const matchId = await createMatch();
    const coach = await createParticipant(matchId, 'coach');
    const response = await post(
      baseUrl,
      {
        eventId: uuid(),
        matchId,
        v: 1,
        at: '2026-09-20T12:00:00.000Z',
        by: 'coach:ulf',
        type: 'event_time_corrected',
        targetEventId: uuid(),
        correctedAt: '2026-09-20T11:58:00.000Z',
      },
      coach.token,
    );

    expect(response.status).toBe(400);
    await expect(
      db.selectFrom('match_events').select('id').where('match_id', '=', matchId).execute(),
    ).resolves.toHaveLength(0);
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

describe('tränarens ägarskap', () => {
  it('kräver inloggning för att skapa en match', async () => {
    const response = await postTo(
      baseUrl,
      '/matches',
      {
        teamId: uuid(),
        opponent: 'Grön IF',
        format: 7,
        formationId: '7v7-2-3-1',
        periodCount: 3,
        periodLengthSeconds: 900,
        presentPlayerIds: [uuid()],
        assignments: [{ slotId: 'gk', playerId: uuid() }],
      },
      undefined,
      null,
    );
    expect(response.status).toBe(401);
  });

  it('låter inte en annan tränare starta en match för laget', async () => {
    const team = await db
      .insertInto('teams')
      .values({ name: 'F11 Blå', owner_user_id: coach.id })
      .returning('id')
      .executeTakeFirstOrThrow();
    const roster = await Promise.all(
      Array.from({ length: 7 }, (_, index) =>
        db
          .insertInto('players')
          .values({ team_id: team.id, name: `Spelare ${index + 1}` })
          .returning('id')
          .executeTakeFirstOrThrow(),
      ),
    );
    const formation = ['gk', 'cb-left', 'cb-right', 'lm', 'cm', 'rm', 'st'];
    const other = await signIn(`annan-${uuid()}@example.se`);

    const response = await postTo(
      baseUrl,
      '/matches',
      {
        teamId: team.id,
        opponent: 'Grön IF',
        format: 7,
        formationId: '7v7-2-3-1',
        periodCount: 3,
        periodLengthSeconds: 900,
        presentPlayerIds: roster.map((player) => player.id),
        assignments: formation.map((slotId, index) => ({ slotId, playerId: roster[index]?.id })),
      },
      undefined,
      other.cookie,
    );

    expect(response.status).toBe(404);
    const matches = await db
      .selectFrom('matches')
      .select('id')
      .where('team_id', '=', team.id)
      .execute();
    expect(matches).toHaveLength(0);
  });

  it('låter bara lagets ägare dela en match', async () => {
    const matchId = await createMatch();
    const other = await signIn(`annan-${uuid()}@example.se`);

    const anonymous = await postTo(baseUrl, '/matches/share', { matchId }, undefined, null);
    const stranger = await postTo(baseUrl, '/matches/share', { matchId }, undefined, other.cookie);

    expect(anonymous.status).toBe(401);
    expect(stranger.status).toBe(404);
    const match = await db
      .selectFrom('matches')
      .select('join_code')
      .where('id', '=', matchId)
      .executeTakeFirstOrThrow();
    expect(match.join_code).toBeNull();
  });
});

describe('POST /matches/share och /matches/join', () => {
  async function createShare(
    url = baseUrl,
  ): Promise<{ matchId: string; code: string; token: string }> {
    const matchId = await createMatch();
    const response = await postTo(url, '/matches/share', { matchId });
    const output = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(output['joinCode']).toMatch(
      /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{3}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{3}$/,
    );
    expect(output['linkToken']).toMatch(/^[A-Za-z0-9_-]{24}$/);
    return { matchId, code: output['joinCode'] as string, token: output['linkToken'] as string };
  }

  it('skapar en länk med en kryptografisk token och går med via kortkoden', async () => {
    const share = await createShare();
    const join = await postTo(baseUrl, '/matches/join', {
      code: share.code,
      displayName: 'Ulf, telefon',
    });
    const output = (await join.json()) as Record<string, unknown>;

    expect(join.status).toBe(200);
    expect(output).toMatchObject({ matchId: share.matchId, displayName: 'Ulf, telefon' });
    expect(join.headers.get('set-cookie')).toMatch(
      /coach_clock_participant=[^;]+; HttpOnly; Path=\/; SameSite=Lax/,
    );

    const match = await db
      .selectFrom('matches')
      .select(['join_code', 'join_token_hash'])
      .where('id', '=', share.matchId)
      .executeTakeFirstOrThrow();
    expect(match.join_code).toBe(share.code.replace('-', ''));
    expect(match.join_token_hash).toMatch(/^[a-f0-9]{64}$/);

    const participant = await db
      .selectFrom('participants')
      .select(['match_id', 'display_name', 'token_hash'])
      .where('match_id', '=', share.matchId)
      .executeTakeFirstOrThrow();
    expect(participant).toMatchObject({ match_id: share.matchId, display_name: 'Ulf, telefon' });
    expect(participant.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(join.headers.get('set-cookie')).not.toContain(participant.token_hash);
  });

  it('godtar den längre hemliga länktokenen', async () => {
    const share = await createShare();
    const join = await postTo(baseUrl, '/matches/join', {
      linkToken: share.token,
      displayName: 'Sara, iPad',
    });

    expect(join.status).toBe(200);
    await expect(join.json()).resolves.toMatchObject({ matchId: share.matchId });
  });

  it('avvisar fel kod utan att skapa en deltagare', async () => {
    joinLimiterNow += 10_000;
    const share = await createShare();
    const response = await postTo(baseUrl, '/matches/join', {
      code: 'ABC-123',
      displayName: 'Fel person',
    });

    expect(response.status).toBe(404);
    await expect(
      db.selectFrom('participants').select('id').where('match_id', '=', share.matchId).execute(),
    ).resolves.toHaveLength(0);
  });

  it('avvisar kod mer än 24 timmar efter matchslut', async () => {
    joinLimiterNow += 10_000;
    const share = await createShare();
    await db
      .updateTable('matches')
      .set({ status: 'ended', ended_at: new Date(serverNow.getTime() - 24 * 60 * 60 * 1_000 - 1) })
      .where('id', '=', share.matchId)
      .execute();

    const response = await postTo(baseUrl, '/matches/join', {
      code: share.code,
      displayName: 'Sen åskådare',
    });
    expect(response.status).toBe(404);
  });

  it('rate-limitar felaktiga försök per både IP och kod med backoff', async () => {
    const share = await createShare(limitedBaseUrl);
    const bad = await postTo(limitedBaseUrl, '/matches/join', {
      code: 'ZZZ-999',
      displayName: 'Gissare',
    });
    const blockedSameCode = await postTo(limitedBaseUrl, '/matches/join', {
      code: 'ZZZ-999',
      displayName: 'Gissare igen',
    });
    const blockedSameIp = await postTo(limitedBaseUrl, '/matches/join', {
      code: share.code,
      displayName: 'Rätt kod, men samma IP',
    });

    expect(bad.status).toBe(404);
    expect(blockedSameCode.status).toBe(429);
    expect(blockedSameIp.status).toBe(429);
  });
});

describe('POST /matches/referee-link och /matches/referee-join', () => {
  it('ger en domare en separat token och endast referee-rollen', async () => {
    // Delar testserver med kortkodstesterna, vars IP-backoff annars är aktiv.
    joinLimiterNow += 10_000;
    const matchId = await createMatch();
    const owner = await createParticipant(matchId, 'owner');
    const linkResponse = await postTo(baseUrl, '/matches/referee-link', { matchId }, owner.token);
    const link = (await linkResponse.json()) as { linkToken: string };
    expect(linkResponse.status).toBe(200);
    expect(link.linkToken).toMatch(/^[A-Za-z0-9_-]{24}$/);

    const join = await postTo(baseUrl, '/matches/referee-join', {
      linkToken: link.linkToken,
      displayName: 'Kim Domare',
    });
    expect(join.status).toBe(200);
    await expect(join.json()).resolves.toMatchObject({ matchId, role: 'referee' });
    const participant = await db
      .selectFrom('participants')
      .select(['role', 'token_hash'])
      .where('match_id', '=', matchId)
      .where('display_name', '=', 'Kim Domare')
      .executeTakeFirstOrThrow();
    expect(participant.role).toBe('referee');
    expect(participant.token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('kräver en ägarsession och återkallar föregående domarlänk vid rotation', async () => {
    joinLimiterNow += 10_000;
    const matchId = await createMatch();
    expect((await postTo(baseUrl, '/matches/referee-link', { matchId })).status).toBe(401);
    const owner = await createParticipant(matchId, 'owner');
    const first = (
      await postTo(baseUrl, '/matches/referee-link', { matchId }, owner.token)
    ).json() as Promise<{ linkToken: string }>;
    const second = (
      await postTo(baseUrl, '/matches/referee-link', { matchId }, owner.token)
    ).json() as Promise<{ linkToken: string }>;
    const [{ linkToken: oldToken }, { linkToken: freshToken }] = await Promise.all([first, second]);
    expect(
      (
        await postTo(baseUrl, '/matches/referee-join', {
          linkToken: oldToken,
          displayName: 'För sent',
        })
      ).status,
    ).toBe(404);
    joinLimiterNow += 10_000;
    expect(
      (
        await postTo(baseUrl, '/matches/referee-join', {
          linkToken: freshToken,
          displayName: 'Rätt',
        })
      ).status,
    ).toBe(200);
  });
});

describe('GET /matches/participants', () => {
  it('visar roller och senast sedd för en deltagare med rätt cookie', async () => {
    const matchId = await createMatch();
    const owner = await createParticipant(matchId, 'owner');
    await createParticipant(matchId, 'viewer');

    const response = await get(baseUrl, '/matches/participants', { matchId }, owner.token);
    expect(response.status).toBe(200);
    const output = z
      .array(z.object({ displayName: z.string(), role: z.string(), lastSeenAt: z.iso.datetime() }))
      .parse(await response.json());
    expect(output).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: 'owner test', role: 'owner' }),
        expect.objectContaining({ displayName: 'viewer test', role: 'viewer' }),
      ]),
    );
  });

  it('skyddar deltagarlistan utan matchens deltagarcookie', async () => {
    const matchId = await createMatch();
    const response = await get(baseUrl, '/matches/participants', { matchId });
    expect(response.status).toBe(401);
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

describe('GET /matches/stream', () => {
  it('pushar en ny händelse i realtid med seq som SSE-id', async () => {
    const matchId = await createMatch();
    const otherMatchId = await createMatch();
    const stream = await openEventStream(matchId);

    try {
      expect(stream.response.status).toBe(200);
      expect(stream.response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
      expect(stream.response.headers.get('x-accel-buffering')).toBe('no');
      expect(stream.response.headers.get('cache-control')).toContain('no-transform');
      expect(stream.response.headers.get('content-encoding')).toBeNull();

      expect((await post(baseUrl, periodStarted(otherMatchId))).status).toBe(200);
      const event = periodStarted(matchId);
      expect((await post(baseUrl, event)).status).toBe(200);

      const message = await stream.nextMessage();
      expect(message.id).toBe('1');
      expect(message.data).toMatchObject({ seq: 1, event });
    } finally {
      await stream.close();
    }
  });

  it('återupptar efter Last-Event-ID och spelar bara upp saknade händelser', async () => {
    const matchId = await createMatch();
    const events = [
      periodStarted(matchId, uuid(), 1),
      periodStarted(matchId, uuid(), 2),
      periodStarted(matchId, uuid(), 3),
    ];
    for (const event of events) expect((await post(baseUrl, event)).status).toBe(200);

    const stream = await openEventStream(matchId, 1);
    try {
      const second = await stream.nextMessage();
      const third = await stream.nextMessage();

      expect([second.id, third.id]).toEqual(['2', '3']);
      expect([second.data.event, third.data.event]).toEqual(events.slice(1));
    } finally {
      await stream.close();
    }
  });

  it('validerar matchId och Last-Event-ID innan strömmen öppnas', async () => {
    const matchId = await createMatch();
    const invalidMatch = await fetch(`${baseUrl}/matches/stream?matchId=nej`);
    const invalidSequence = await fetch(`${baseUrl}/matches/stream?matchId=${matchId}`, {
      headers: { 'Last-Event-ID': '-1' },
    });
    const missing = await fetch(`${baseUrl}/matches/stream?matchId=${uuid()}`);

    expect(invalidMatch.status).toBe(400);
    expect(invalidSequence.status).toBe(400);
    expect(missing.status).toBe(404);
  });
});
