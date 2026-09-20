import {
  canAppendMatchEvent,
  contract,
  FORMATIONS,
  type MatchEvent,
} from '@coach-clock/contracts';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ORPCError, implement } from '@orpc/server';
import type { ServerResponse } from 'node:http';
import type { Kysely } from 'kysely';
import { toMatch, type Database, type JsonObject } from '../db/types.js';
import type { MatchEventBroadcast } from '../match-event-broadcast.js';
import { readMatchEventsSince } from '../match-events.js';
import type { RateLimiter } from '../rate-limit.js';
import type { JoinRateLimiter } from '../rate-limit.js';

/** En klientklocka får gå högst fem minuter före servern. */
export const MAX_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export interface ApiContext {
  readonly db: Kysely<Database>;
  readonly clientId: string;
  readonly rateLimiter: RateLimiter;
  readonly joinRateLimiter: JoinRateLimiter;
  readonly now: () => Date;
  readonly response: ServerResponse;
  /** Klartexttoken från den HttpOnly-cookie som #16 utfärdar. */
  readonly participantToken: string | undefined;
  readonly eventBroadcast: MatchEventBroadcast;
}

const os = implement(contract).$context<ApiContext>();

function hashToken(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function setParticipantCookie(response: ServerResponse, token: string): void {
  response.setHeader(
    'set-cookie',
    `coach_clock_participant=${token}; HttpOnly; Path=/; SameSite=Lax`,
  );
}

/** Skapar ett spelbart matchstartpaket utan ett mellanläge som kan bli halvskrivet. */
export const createMatch = os.matches.create.handler(async ({ input, context }) => {
  const formation = FORMATIONS.find((candidate) => candidate.id === input.formationId);
  if (formation === undefined || formation.format !== input.format) {
    throw new ORPCError('BAD_REQUEST', { message: 'Formationen passar inte vald spelform' });
  }
  if (input.presentPlayerIds.length < formation.slots.length) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'För få närvarande spelare för startuppställningen',
    });
  }

  const slotIds = new Set(formation.slots.map((slot) => slot.id));
  const assignedIds = input.assignments.map((assignment) => assignment.playerId);
  if (
    input.assignments.length !== formation.slots.length ||
    new Set(input.assignments.map((assignment) => assignment.slotId)).size !==
      formation.slots.length ||
    new Set(assignedIds).size !== assignedIds.length ||
    input.assignments.some((assignment) => !slotIds.has(assignment.slotId)) ||
    assignedIds.some((id) => !input.presentPlayerIds.includes(id))
  ) {
    throw new ORPCError('BAD_REQUEST', { message: 'Startuppställningen är inte komplett' });
  }

  const players = await context.db
    .selectFrom('players')
    .select(['id', 'name', 'number', 'is_goalkeeper'])
    .where('team_id', '=', input.teamId)
    .where('archived', '=', false)
    .where('id', 'in', input.presentPlayerIds)
    .execute();
  if (players.length !== input.presentPlayerIds.length) {
    throw new ORPCError('BAD_REQUEST', { message: 'En närvarande spelare finns inte i laget' });
  }

  const now = context.now();
  const ownerToken = randomBytes(32).toString('base64url');
  const match = await context.db.transaction().execute(async (trx) => {
    const team = await trx
      .selectFrom('teams')
      .select('id')
      .where('id', '=', input.teamId)
      .executeTakeFirst();
    if (team === undefined) throw new ORPCError('NOT_FOUND', { message: 'Laget finns inte' });

    const created = await trx
      .insertInto('matches')
      .values({
        team_id: input.teamId,
        opponent: input.opponent,
        format: input.format,
        formation_id: input.formationId,
        period_count: input.periodCount,
        period_length_seconds: input.periodLengthSeconds,
        status: 'live',
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    const owner = await trx
      .insertInto('participants')
      .values({
        match_id: created.id,
        role: 'owner',
        display_name: 'Tränare',
        token_hash: hashToken(ownerToken),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const bench = input.presentPlayerIds.filter((id) => !assignedIds.includes(id));
    const events = [
      {
        type: 'match_created',
        payload: {
          by: 'owner',
          v: 1,
          format: input.format,
          formationId: input.formationId,
          periods: input.periodCount,
          periodLengthSeconds: input.periodLengthSeconds,
          opponent: input.opponent,
        },
      },
      {
        type: 'squad_set',
        payload: {
          by: 'owner',
          v: 1,
          players: players.map((player) => ({
            playerId: player.id,
            name: player.name,
            number: player.number ?? 0,
            isGoalkeeper: player.is_goalkeeper,
          })),
        },
      },
      { type: 'lineup_set', payload: { by: 'owner', v: 1, assignments: input.assignments, bench } },
      { type: 'period_started', payload: { by: 'owner', v: 1, periodNumber: 1 } },
    ] as const;
    await trx
      .insertInto('match_events')
      .values(
        events.map((event, index) => ({
          match_id: created.id,
          event_id: randomUUID(),
          seq: index + 1,
          type: event.type,
          payload: event.payload,
          at: now,
          by_participant_id: owner.id,
        })),
      )
      .execute();
    return toMatch(created);
  });
  setParticipantCookie(context.response, ownerToken);
  return { ...match, createdAt: match.createdAt.toISOString(), endedAt: null };
});

function eventPayload(event: MatchEvent): JsonObject {
  const payload: Record<string, unknown> = { ...event };
  delete payload['eventId'];
  delete payload['matchId'];
  delete payload['type'];
  delete payload['at'];
  return payload;
}

export const getMatch = os.matches.get.handler(async ({ input, context }) => {
  const row = await context.db
    .selectFrom('matches')
    .selectAll()
    .where('id', '=', input.matchId)
    .executeTakeFirst();

  if (row === undefined) {
    throw new ORPCError('NOT_FOUND', { message: 'Matchen finns inte' });
  }

  const match = toMatch(row);

  return {
    ...match,
    createdAt: match.createdAt.toISOString(),
    endedAt: match.endedAt?.toISOString() ?? null,
  };
});

export const listMatchEvents = os.matches.listEvents.handler(async ({ input, context }) => {
  const match = await context.db
    .selectFrom('matches')
    .select('id')
    .where('id', '=', input.matchId)
    .executeTakeFirst();

  if (match === undefined) {
    throw new ORPCError('NOT_FOUND', { message: 'Matchen finns inte' });
  }

  return readMatchEventsSince(context.db, input.matchId, input.sinceSeq);
});

export const appendMatchEvent = os.matches.events.handler(async ({ input, context }) => {
  const rateLimitKey = `${context.clientId}:${input.matchId}`;

  if (Date.parse(input.at) > context.now().getTime() + MAX_EVENT_FUTURE_SKEW_MS) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'Händelsens at ligger orimligt långt före serverns tid',
    });
  }

  if (context.participantToken === undefined) {
    throw new ORPCError('UNAUTHORIZED', { message: 'En deltagarsession krävs för att skriva' });
  }

  const participant = await context.db
    .selectFrom('participants')
    .select(['id', 'role'])
    .where('match_id', '=', input.matchId)
    .where('token_hash', '=', hashToken(context.participantToken))
    .executeTakeFirst();

  if (participant === undefined) {
    throw new ORPCError('UNAUTHORIZED', {
      message: 'Deltagarsessionen gäller inte den här matchen',
    });
  }
  if (!canAppendMatchEvent(participant.role, input.type)) {
    throw new ORPCError('FORBIDDEN', { message: 'Din roll får inte skriva den här händelsen' });
  }

  // En ogiltig eller otillåten session ska inte kunna förbruka kvoten för en
  // riktig deltagare på samma IP-adress och match.
  const rateLimitAllowsWrite = context.rateLimiter.consume(rateLimitKey);

  const result = await context.db.transaction().execute(async (trx) => {
    // Alla appends för samma match tar samma radlås. Därmed kan bara en
    // transaktion i taget läsa nästa seq och skriva raden.
    const match = await trx
      .selectFrom('matches')
      .select('id')
      .where('id', '=', input.matchId)
      .forUpdate()
      .executeTakeFirst();

    if (match === undefined) {
      throw new ORPCError('NOT_FOUND', { message: 'Matchen finns inte' });
    }

    const existing = await trx
      .selectFrom('match_events')
      .select(['event_id', 'match_id', 'seq', 'received_at'])
      .where('match_id', '=', input.matchId)
      .where('event_id', '=', input.eventId)
      .executeTakeFirst();

    if (existing !== undefined) {
      return {
        created: false,
        output: {
          eventId: existing.event_id,
          matchId: existing.match_id,
          seq: existing.seq,
          receivedAt: existing.received_at.toISOString(),
        },
      };
    }

    // En omsändning ovan ska alltid få sitt tidigare seq, även om klienten
    // hunnit slå i kvoten. Begränsningen stoppar bara nya skrivningar.
    if (!rateLimitAllowsWrite) {
      throw new ORPCError('TOO_MANY_REQUESTS');
    }

    const latest = await trx
      .selectFrom('match_events')
      .select(({ fn }) => fn.max<number>('seq').as('max_seq'))
      .where('match_id', '=', input.matchId)
      .executeTakeFirstOrThrow();
    const seq = (latest.max_seq ?? 0) + 1;

    const inserted = await trx
      .insertInto('match_events')
      .values({
        match_id: input.matchId,
        event_id: input.eventId,
        seq,
        type: input.type,
        payload: eventPayload(input),
        at: new Date(input.at),
        by_participant_id: participant.id,
      })
      .returning(['event_id', 'match_id', 'seq', 'received_at'])
      .executeTakeFirstOrThrow();

    return {
      created: true,
      output: {
        eventId: inserted.event_id,
        matchId: inserted.match_id,
        seq: inserted.seq,
        receivedAt: inserted.received_at.toISOString(),
      },
    };
  });

  if (result.created) {
    context.eventBroadcast.publish({
      seq: result.output.seq,
      receivedAt: result.output.receivedAt,
      event: input,
    });
  }

  return result.output;
});
