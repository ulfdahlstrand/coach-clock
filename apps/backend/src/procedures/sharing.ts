import { createHash, randomBytes } from 'node:crypto';
import { contract } from '@coach-clock/contracts';
import { ORPCError, implement } from '@orpc/server';
import type { Kysely } from 'kysely';
import type { ServerResponse } from 'node:http';
import { requireUser } from '../auth/require-user.js';
import type { AuthUser } from '../auth/session.js';
import type { Database } from '../db/types.js';
import type { JoinRateLimiter } from '../rate-limit.js';
import { resolveMatchActor } from './match-access.js';

const os = implement(contract).$context<SharingContext>();
const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const JOIN_GRACE_PERIOD_MS = 24 * 60 * 60 * 1_000;
const MAX_SHARE_CREATION_ATTEMPTS = 5;

export interface SharingContext {
  readonly db: Kysely<Database>;
  readonly now: () => Date;
  readonly clientId: string;
  readonly joinRateLimiter: JoinRateLimiter;
  readonly response: ServerResponse;
  readonly participantToken: string | undefined;
  readonly user: AuthUser | null;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** 18 slumpbytes blir alltid exakt 24 base64url-tecken. */
export function createLinkToken(): string {
  return randomBytes(18).toString('base64url');
}

export function createParticipantToken(): string {
  return randomBytes(32).toString('base64url');
}

export function createJoinCode(): string {
  const bytes = randomBytes(6);
  const raw = Array.from(bytes, (byte) => CROCKFORD_BASE32[byte & 31]).join('');
  return `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

function isJoinable(match: { status: string; ended_at: Date | null }, now: Date): boolean {
  return (
    match.status !== 'ended' ||
    (match.ended_at !== null && now.getTime() - match.ended_at.getTime() <= JOIN_GRACE_PERIOD_MS)
  );
}

function rateLimitIdentity(code: string | undefined, linkToken: string | undefined): string {
  return code ?? sha256(linkToken ?? '');
}

function setParticipantCookie(response: ServerResponse, token: string): void {
  // Tokens är autentiseringsuppgifter: JS ska aldrig kunna läsa dem. SameSite
  // stoppar att en tredjepartssida skickar dem i vanliga cross-site-anrop.
  response.setHeader(
    'set-cookie',
    `coach_clock_participant=${token}; HttpOnly; Path=/; SameSite=Lax`,
  );
}

/**
 * Bara tränaren som äger matchens lag kan dela den. En annans match svarar som
 * en match som inte finns.
 */
export const createMatchShare = os.matches.share.handler(async ({ input, context }) => {
  const user = requireUser(context);
  return context.db.transaction().execute(async (trx) => {
    const match = await trx
      .selectFrom('matches')
      .innerJoin('teams', 'teams.id', 'matches.team_id')
      .select(['matches.id', 'matches.status', 'matches.join_code'])
      .where('matches.id', '=', input.matchId)
      .where('teams.owner_user_id', '=', user.id)
      .forUpdate('matches')
      .executeTakeFirst();

    if (match === undefined) {
      throw new ORPCError('NOT_FOUND', { message: 'Matchen finns inte' });
    }
    if (match.status === 'ended') {
      throw new ORPCError('BAD_REQUEST', { message: 'En avslutad match kan inte delas' });
    }
    if (match.join_code !== null) {
      throw new ORPCError('CONFLICT', { message: 'Matchen har redan en delningslänk' });
    }

    for (let attempt = 0; attempt < MAX_SHARE_CREATION_ATTEMPTS; attempt += 1) {
      const linkToken = createLinkToken();
      const joinCode = createJoinCode();
      try {
        await trx
          .updateTable('matches')
          .set({ join_code: joinCode.replace('-', ''), join_token_hash: sha256(linkToken) })
          .where('id', '=', input.matchId)
          .executeTakeFirstOrThrow();
        return { joinCode, linkToken };
      } catch (error: unknown) {
        // Den partiellt unika join_code-indexen kan i teorin få en krock.
        // Prova en ny kombination; andra fel ska inte maskeras.
        if (!(error instanceof Error) || !error.message.includes('matches_active_join_code_uidx')) {
          throw error;
        }
      }
    }
    throw new ORPCError('INTERNAL_SERVER_ERROR', {
      message: 'Kunde inte skapa en unik anslutningskod',
    });
  });
});

export const joinMatch = os.matches.join.handler(async ({ input, context }) => {
  const normalizedCode = input.code?.replace('-', '');
  const identity = rateLimitIdentity(normalizedCode, input.linkToken);

  if (!context.joinRateLimiter.isAllowed(context.clientId, identity)) {
    throw new ORPCError('TOO_MANY_REQUESTS');
  }

  const match = await context.db
    .selectFrom('matches')
    .select(['id', 'status', 'ended_at'])
    .where((eb) => {
      // Den korta koden frigörs av grundschemat när matchen är slut. Länken
      // (den riktiga hemligheten) kan däremot fortsätta fungera i 24 timmar.
      if (normalizedCode !== undefined) {
        return eb.and([eb('join_code', '=', normalizedCode), eb('status', '<>', 'ended')]);
      }
      return eb('join_token_hash', '=', sha256(input.linkToken ?? ''));
    })
    .executeTakeFirst();

  if (match === undefined || !isJoinable(match, context.now())) {
    context.joinRateLimiter.recordFailure(context.clientId, identity);
    // Samma svar för okänd och utgången kod så att matchstatus inte kan sonderas.
    throw new ORPCError('NOT_FOUND', { message: 'Koden eller länken är ogiltig' });
  }

  const token = createParticipantToken();
  const participant = await context.db
    .insertInto('participants')
    .values({
      match_id: match.id,
      role: 'viewer',
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
  };
});

/**
 * Deltagarlistan är avsiktligt knuten till deltagarens HttpOnly-cookie — eller
 * till kontot för tränaren som äger laget. Det räcker alltså inte att känna
 * till ett match-id för att se vilka som är med.
 * Samtidigt markerar ett aktivt anrop den aktuella enheten som sedd.
 */
export const listMatchParticipants = os.matches.participants.handler(async ({ input, context }) => {
  if (context.participantToken === undefined && context.user === null) {
    throw new ORPCError('UNAUTHORIZED', { message: 'Gå med i matchen först' });
  }

  const participant = await resolveMatchActor(
    context.db,
    input.matchId,
    context.participantToken,
    context.user,
  );
  if (participant === undefined) {
    throw new ORPCError('FORBIDDEN', { message: 'Du är inte deltagare i matchen' });
  }

  await context.db
    .updateTable('participants')
    .set({ last_seen_at: context.now() })
    .where('id', '=', participant.id)
    .execute();

  const participants = await context.db
    .selectFrom('participants')
    .select(['id', 'display_name', 'role', 'last_seen_at'])
    .where('match_id', '=', input.matchId)
    .orderBy('last_seen_at', 'desc')
    .execute();

  return participants.map((entry) => ({
    id: entry.id,
    displayName: entry.display_name,
    role: entry.role,
    lastSeenAt: entry.last_seen_at.toISOString(),
  }));
});
