import { createHash } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { AuthUser } from '../auth/session.js';
import type { Database, ParticipantRole } from '../db/types.js';

export interface MatchActor {
  readonly id: string;
  readonly role: ParticipantRole;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Vem som agerar i matchen. Kontot går före enheten: en inloggad tränare som
 * äger matchens lag är matchens ägardeltagare på vilken enhet som helst, även
 * om den enheten tidigare gått med som tittare. Annars gäller deltagarcookien
 * — det enda domare och tittare har, eftersom de saknar konto.
 *
 * Ägarens händelser skrivs fortsatt på matchens ägardeltagare, så loggen ser
 * likadan ut oavsett vilken av tränarens enheter som skrev.
 */
export async function resolveMatchActor(
  db: Kysely<Database>,
  matchId: string,
  participantToken: string | undefined,
  user: AuthUser | null,
): Promise<MatchActor | undefined> {
  if (user !== null) {
    const owner = await db
      .selectFrom('participants')
      .innerJoin('matches', 'matches.id', 'participants.match_id')
      .innerJoin('teams', 'teams.id', 'matches.team_id')
      .select(['participants.id', 'participants.role'])
      .where('participants.match_id', '=', matchId)
      .where('participants.role', '=', 'owner')
      .where('teams.owner_user_id', '=', user.id)
      .orderBy('participants.created_at')
      .executeTakeFirst();
    if (owner !== undefined) return owner;
  }

  if (participantToken === undefined) return undefined;
  return db
    .selectFrom('participants')
    .select(['id', 'role'])
    .where('match_id', '=', matchId)
    .where('token_hash', '=', sha256(participantToken))
    .executeTakeFirst();
}
