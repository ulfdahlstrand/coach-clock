import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SequencedMatchEvent } from '@coach-clock/contracts';
import type { Kysely } from 'kysely';
import { z } from 'zod';
import type { Database } from './db/types.js';
import type { MatchEventBroadcast } from './match-event-broadcast.js';
import { readMatchEventsSince } from './match-events.js';

export const SSE_HEARTBEAT_INTERVAL_MS = 20_000;

const querySchema = z.object({ matchId: z.uuid() });
const lastEventIdSchema = z.coerce.number().int().nonnegative();

export interface MatchEventStreamDependencies {
  readonly db: Kysely<Database>;
  readonly eventBroadcast: MatchEventBroadcast;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function writeEvent(res: ServerResponse, event: SequencedMatchEvent): void {
  res.write(`id: ${event.seq}\ndata: ${JSON.stringify(event)}\n\n`);
}

/** Hanterar den råa SSE-routen utanför oRPC. */
export async function handleMatchEventStream(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  dependencies: MatchEventStreamDependencies,
): Promise<void> {
  const query = querySchema.safeParse({ matchId: url.searchParams.get('matchId') ?? undefined });
  const lastEventId = lastEventIdSchema.safeParse(req.headers['last-event-id'] ?? 0);

  if (!query.success || !lastEventId.success) {
    sendJson(res, 400, { error: 'Ogiltigt matchId eller Last-Event-ID' });
    return;
  }

  const match = await dependencies.db
    .selectFrom('matches')
    .select('id')
    .where('id', '=', query.data.matchId)
    .executeTakeFirst();

  if (match === undefined) {
    sendJson(res, 404, { error: 'Matchen finns inte' });
    return;
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders();

  let replaying = true;
  let lastSentSeq = lastEventId.data;
  const pending: SequencedMatchEvent[] = [];

  const unsubscribe = dependencies.eventBroadcast.subscribe(query.data.matchId, (event) => {
    if (replaying) {
      pending.push(event);
      return;
    }

    if (event.seq <= lastSentSeq) return;
    writeEvent(res, event);
    lastSentSeq = event.seq;
  });

  let cleanedUp = false;
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), SSE_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.once('aborted', cleanup);
  res.once('close', cleanup);

  try {
    const replay = await readMatchEventsSince(dependencies.db, query.data.matchId, lastSentSeq);
    for (const event of replay) {
      if (event.seq <= lastSentSeq) continue;
      writeEvent(res, event);
      lastSentSeq = event.seq;
    }

    replaying = false;
    pending.sort((left, right) => left.seq - right.seq);
    for (const event of pending) {
      if (event.seq <= lastSentSeq) continue;
      writeEvent(res, event);
      lastSentSeq = event.seq;
    }
  } catch (error) {
    cleanup();
    throw error;
  }
}
