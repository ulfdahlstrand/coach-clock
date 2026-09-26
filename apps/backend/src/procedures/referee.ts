import { createHash, randomBytes } from 'node:crypto';
import { contract } from '@coach-clock/contracts';
import { ORPCError, implement } from '@orpc/server';
import type { Kysely } from 'kysely';
import type { ServerResponse } from 'node:http';
import type { AuthUser } from '../auth/session.js';
import type { Database } from '../db/types.js';
import type { JoinRateLimiter } from '../rate-limit.js';
import { resolveMatchActor } from './match-access.js';

export interface RefereeContext {
  readonly db: Kysely<Database>;
  readonly now: () => Date;
  readonly clientId: string;
  readonly joinRateLimiter: JoinRateLimiter;
  readonly response: ServerResponse;
  readonly participantToken: string | undefined;
  readonly user: AuthUser | null;
}

const os = implement(contract).$context<RefereeContext>();

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 18 slumpbytes blir exakt 24 URL-säkra tecken och är aldrig en kort kod. */
export function createRefereeLinkToken(): string {
  return randomBytes(18).toString('base64url');
}

function setParticipantCookie(response: ServerResponse, token: string): void {
  response.setHeader(
    'set-cookie',
    `coach_clock_participant=${token}; HttpOnly; Path=/; SameSite=Lax`,
  );
}

async function requireOwner(context: RefereeContext, matchId: string): Promise<void> {
  if (context.participantToken === undefined && context.user === null) {
    throw new ORPCError('UNAUTHORIZED', { message: 'Ägarens deltagarsession krävs' });
  }
  const participant = await resolveMatchActor(
    context.db,
    matchId,
    context.participantToken,
    context.user,
  );
  if (participant === undefined || participant.role !== 'owner') {
    throw new ORPCError('FORBIDDEN', { message: 'Bara matchägaren kan skapa en domarlänk' });
  }
}

/** Rotering återkallar den föregående länken atomärt. */
export const createRefereeLink = os.matches.refereeLink.handler(async ({ input, context }) => {
  await requireOwner(context, input.matchId);
  const linkToken = createRefereeLinkToken();
  await context.db.transaction().execute(async (trx) => {
    const match = await trx
      .selectFrom('matches')
      .select(['id', 'status'])
      .where('id', '=', input.matchId)
      .forUpdate()
      .executeTakeFirst();
    if (match === undefined) throw new ORPCError('NOT_FOUND', { message: 'Matchen finns inte' });
    if (match.status === 'ended') {
      throw new ORPCError('BAD_REQUEST', { message: 'En avslutad match kan inte få en domarlänk' });
    }
    await trx
      .updateTable('match_referee_links')
      .set({ revoked_at: context.now() })
      .where('match_id', '=', input.matchId)
      .where('revoked_at', 'is', null)
      .execute();
    await trx
      .insertInto('match_referee_links')
      .values({ match_id: input.matchId, token_hash: sha256(linkToken) })
      .execute();
  });
  return { linkToken };
});

export const joinAsReferee = os.matches.refereeJoin.handler(async ({ input, context }) => {
  const identity = sha256(input.linkToken);
  if (!context.joinRateLimiter.isAllowed(context.clientId, identity)) {
    throw new ORPCError('TOO_MANY_REQUESTS');
  }

  const link = await context.db
    .selectFrom('match_referee_links')
    .innerJoin('matches', 'matches.id', 'match_referee_links.match_id')
    .select(['match_referee_links.match_id', 'matches.status'])
    .where('match_referee_links.token_hash', '=', identity)
    .where('match_referee_links.revoked_at', 'is', null)
    .executeTakeFirst();
  if (link === undefined || link.status === 'ended') {
    context.joinRateLimiter.recordFailure(context.clientId, identity);
    throw new ORPCError('NOT_FOUND', { message: 'Domarlänken är ogiltig eller återkallad' });
  }

  const token = randomBytes(32).toString('base64url');
  const participant = await context.db
    .insertInto('participants')
    .values({
      match_id: link.match_id,
      role: 'referee',
      display_name: input.displayName,
      token_hash: sha256(token),
    })
    .returning(['id', 'match_id', 'display_name'])
    .executeTakeFirstOrThrow();
  context.joinRateLimiter.clear(context.clientId, identity);
  setParticipantCookie(context.response, token);
  return {
    participantId: participant.id,
    matchId: participant.match_id,
    displayName: participant.display_name,
    role: 'referee' as const,
  };
});
