import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AppendMatchEventOutput, MatchEvent } from '@coach-clock/contracts';

/** A pending event is durable before it is sent, so a page reload cannot lose it. */
export interface OutboxEntry {
  readonly event: MatchEvent;
  readonly attempts: number;
  readonly nextAttemptAt: number;
  readonly queuedAt: number;
}

export interface OutboxRepository {
  list(): Promise<readonly OutboxEntry[]>;
  put(entry: OutboxEntry): Promise<void>;
  delete(eventId: string): Promise<void>;
}

export interface EventOutbox {
  enqueue(event: MatchEvent): Promise<OutboxEntry>;
  pending(): Promise<readonly OutboxEntry[]>;
  drain(sender: MatchEventSender, options?: DrainOptions): Promise<DrainResult>;
}

export type MatchEventSender = (event: MatchEvent) => Promise<AppendMatchEventOutput>;

export interface DrainOptions {
  readonly now?: () => number;
  readonly baseRetryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
}

export interface DrainResult {
  readonly sent: readonly AppendMatchEventOutput[];
  readonly failedEventId?: string;
  readonly nextAttemptAt?: number;
}

const defaultBaseRetryDelayMs = 1_000;
const defaultMaxRetryDelayMs = 5 * 60_000;

/**
 * Builds the event envelope ID on the device. The server treats this UUID as
 * an idempotency key, which lets a retry safely receive its already-created
 * sequence number after the connection drops during a response.
 */
export function withClientEventId<T extends MatchEvent>(event: Omit<T, 'eventId'>, eventId = crypto.randomUUID()): T {
  return { ...event, eventId } as T;
}

/** Applies a newly recorded event to local state immediately, then persists it for delivery. */
export async function queueOptimisticEvent(
  outbox: EventOutbox,
  event: MatchEvent,
  applyOptimistically: (event: MatchEvent) => void,
): Promise<OutboxEntry> {
  applyOptimistically(event);
  return outbox.enqueue(event);
}

export function createEventOutbox(repository: OutboxRepository): EventOutbox {
  return {
    async enqueue(event) {
      const entries = await repository.list();
      const existing = entries.find((entry) => entry.event.eventId === event.eventId);
      if (existing !== undefined) return existing;

      const entry: OutboxEntry = {
        event,
        attempts: 0,
        nextAttemptAt: 0,
        queuedAt: Date.now(),
      };
      await repository.put(entry);
      return entry;
    },
    pending: () => repository.list(),
    drain: (sender, options) => drainOutbox(repository, sender, options),
  };
}

/**
 * Sends ready entries in queue order. A successful response removes an entry
 * even when the server says it had already seen the UUID: that response is the
 * deduplication acknowledgement. On the first failure we stop, preserving
 * event order and scheduling only that entry for retry.
 */
export async function drainOutbox(
  repository: OutboxRepository,
  sender: MatchEventSender,
  {
    now = Date.now,
    baseRetryDelayMs = defaultBaseRetryDelayMs,
    maxRetryDelayMs = defaultMaxRetryDelayMs,
  }: DrainOptions = {},
): Promise<DrainResult> {
  if (baseRetryDelayMs <= 0 || maxRetryDelayMs < baseRetryDelayMs) {
    throw new RangeError('Ogiltig retry-konfiguration för outboxen.');
  }

  const sent: AppendMatchEventOutput[] = [];
  const entries = [...(await repository.list())].sort(
    (left, right) => left.queuedAt - right.queuedAt || left.event.eventId.localeCompare(right.event.eventId),
  );

  for (const entry of entries) {
    if (entry.nextAttemptAt > now()) {
      return { sent, nextAttemptAt: entry.nextAttemptAt };
    }

    try {
      const acknowledged = await sender(entry.event);
      if (acknowledged.eventId !== entry.event.eventId || acknowledged.matchId !== entry.event.matchId) {
        throw new Error('Servern bekräftade inte rätt händelse.');
      }
      await repository.delete(entry.event.eventId);
      sent.push(acknowledged);
    } catch {
      const attempts = entry.attempts + 1;
      const delay = Math.min(maxRetryDelayMs, baseRetryDelayMs * 2 ** (attempts - 1));
      const nextAttemptAt = now() + delay;
      await repository.put({ ...entry, attempts, nextAttemptAt });
      return { sent, failedEventId: entry.event.eventId, nextAttemptAt };
    }
  }

  return { sent };
}

/** Starts a small browser-only worker and retries immediately when connectivity returns. */
export function startOutboxDrainer(outbox: EventOutbox, sender: MatchEventSender): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = (at?: number) => {
    if (stopped || timer !== undefined) return;
    const delay = at === undefined ? 0 : Math.max(0, at - Date.now());
    timer = setTimeout(() => {
      timer = undefined;
      void run();
    }, delay);
  };

  const run = async () => {
    if (stopped || !navigator.onLine) return;
    const result = await outbox.drain(sender);
    schedule(result.nextAttemptAt);
  };
  const onOnline = () => schedule();

  window.addEventListener('online', onOnline);
  schedule();
  return () => {
    stopped = true;
    window.removeEventListener('online', onOnline);
    if (timer !== undefined) clearTimeout(timer);
  };
}

interface OutboxDb extends DBSchema {
  events: {
    key: string;
    value: OutboxEntry;
  };
}

const databaseName = 'coach-clock';
const databaseVersion = 1;
let database: Promise<IDBPDatabase<OutboxDb>> | undefined;

function getDatabase() {
  database ??= openDB<OutboxDb>(databaseName, databaseVersion, {
    upgrade(db) {
      db.createObjectStore('events', { keyPath: 'event.eventId' });
    },
  });
  return database;
}

/** The production repository. `idb` keeps the queue intact across reloads and browser restarts. */
export const indexedDbOutboxRepository: OutboxRepository = {
  async list() {
    return (await getDatabase()).getAll('events');
  },
  async put(entry) {
    await (await getDatabase()).put('events', entry);
  },
  async delete(eventId) {
    await (await getDatabase()).delete('events', eventId);
  },
};

export const eventOutbox = createEventOutbox(indexedDbOutboxRepository);
