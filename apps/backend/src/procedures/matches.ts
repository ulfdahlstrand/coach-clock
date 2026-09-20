import { contract, type MatchEvent } from '@coach-clock/contracts';
import { ORPCError, implement } from '@orpc/server';
import type { Kysely } from 'kysely';
import { toMatch, type Database, type JsonObject } from '../db/types.js';
import type { MatchEventBroadcast } from '../match-event-broadcast.js';
import { readMatchEventsSince } from '../match-events.js';
import type { RateLimiter } from '../rate-limit.js';

/** En klientklocka får gå högst fem minuter före servern. */
export const MAX_EVENT_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export interface ApiContext {
  readonly db: Kysely<Database>;
  readonly clientId: string;
  readonly rateLimiter: RateLimiter;
  readonly now: () => Date;
  readonly eventBroadcast: MatchEventBroadcast;
}

const os = implement(contract).$context<ApiContext>();

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
  const rateLimitAllowsWrite = context.rateLimiter.consume(rateLimitKey);

  if (Date.parse(input.at) > context.now().getTime() + MAX_EVENT_FUTURE_SKEW_MS) {
    throw new ORPCError('BAD_REQUEST', {
      message: 'Händelsens at ligger orimligt långt före serverns tid',
    });
  }

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
        by_participant_id: null,
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
