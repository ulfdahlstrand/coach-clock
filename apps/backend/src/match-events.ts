import { parseMatchEvent, type SequencedMatchEvent } from '@coach-clock/contracts';
import type { Kysely } from 'kysely';
import type { Database } from './db/types.js';

/** Hämtar en replaybar del av loggen i serverns kanoniska seq-ordning. */
export async function readMatchEventsSince(
  db: Kysely<Database>,
  matchId: string,
  sinceSeq: number,
): Promise<SequencedMatchEvent[]> {
  const rows = await db
    .selectFrom('match_events')
    .select(['event_id', 'match_id', 'seq', 'type', 'payload', 'at', 'received_at'])
    .where('match_id', '=', matchId)
    .where('seq', '>', sinceSeq)
    .orderBy('seq')
    .execute();

  return rows.map((row) => ({
    seq: row.seq,
    receivedAt: row.received_at.toISOString(),
    event: parseMatchEvent({
      ...row.payload,
      eventId: row.event_id,
      matchId: row.match_id,
      type: row.type,
      at: row.at.toISOString(),
    }),
  }));
}
