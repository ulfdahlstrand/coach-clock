import { describe, expect, test, vi } from 'vitest';
import type { MatchEvent } from '@coach-clock/contracts';
import {
  createEventOutbox,
  drainOutbox,
  queueOptimisticEvent,
  withClientEventId,
  type OutboxEntry,
  type OutboxRepository,
} from './event-outbox';

const matchId = '00000000-0000-4000-8000-000000000001';
let nextId = 10;
function event(): MatchEvent {
  nextId += 1;
  return {
    eventId: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    matchId,
    v: 1,
    at: '2026-09-21T10:00:00.000Z',
    by: 'coach',
    type: 'period_started',
    periodNumber: 1,
  };
}

function memoryRepository(
  initial: readonly OutboxEntry[] = [],
): OutboxRepository & { entries: Map<string, OutboxEntry> } {
  const entries = new Map(initial.map((entry) => [entry.event.eventId, entry]));
  return {
    entries,
    list: () => Promise.resolve([...entries.values()]),
    put: (entry) => Promise.resolve(void entries.set(entry.event.eventId, entry)),
    delete: (eventId) => Promise.resolve(void entries.delete(eventId)),
  };
}

describe('event outbox', () => {
  test('keeps an event durable and does not enqueue the same UUID twice', async () => {
    const repository = memoryRepository();
    const outbox = createEventOutbox(repository);
    const item = event();

    await outbox.enqueue(item);
    await outbox.enqueue(item);

    expect(await outbox.pending()).toHaveLength(1);
  });

  test('acknowledges a duplicate server response and removes the durable entry', async () => {
    const item = event();
    const repository = memoryRepository([
      { event: item, attempts: 0, nextAttemptAt: 0, queuedAt: 1 },
    ]);
    const send = vi.fn().mockResolvedValue({
      eventId: item.eventId,
      matchId: item.matchId,
      seq: 7,
      receivedAt: '2026-09-21T10:00:05.000Z',
    });

    const result = await drainOutbox(repository, send, { now: () => 10 });

    expect(result.sent).toHaveLength(1);
    expect(send).toHaveBeenCalledWith(item);
    expect(repository.entries).toHaveLength(0);
  });

  test('backs off exponentially after a failed send and does not overtake the failed event', async () => {
    const first = event();
    const second = event();
    const repository = memoryRepository([
      { event: first, attempts: 1, nextAttemptAt: 0, queuedAt: 1 },
      { event: second, attempts: 0, nextAttemptAt: 0, queuedAt: 2 },
    ]);
    const send = vi.fn().mockRejectedValue(new Error('offline'));

    const result = await drainOutbox(repository, send, {
      now: () => 1_000,
      baseRetryDelayMs: 100,
      maxRetryDelayMs: 500,
    });

    expect(result).toMatchObject({ failedEventId: first.eventId, nextAttemptAt: 1_200 });
    expect(repository.entries.get(first.eventId)).toMatchObject({
      attempts: 2,
      nextAttemptAt: 1_200,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('leaves a deferred retry untouched until its retry time', async () => {
    const item = event();
    const repository = memoryRepository([
      { event: item, attempts: 1, nextAttemptAt: 100, queuedAt: 1 },
    ]);
    const send = vi.fn();

    await expect(drainOutbox(repository, send, { now: () => 99 })).resolves.toEqual({
      sent: [],
      rejected: [],
      nextAttemptAt: 100,
    });
    expect(send).not.toHaveBeenCalled();
  });

  test('applies an event immediately before storing it for eventual delivery', async () => {
    const repository = memoryRepository();
    const item = event();
    const apply = vi.fn();

    await queueOptimisticEvent(createEventOutbox(repository), item, apply);

    expect(apply).toHaveBeenCalledWith(item);
    expect(repository.entries.get(item.eventId)?.event).toEqual(item);
  });

  test('adds a client UUID without changing the event payload', () => {
    const item = event();
    const { eventId: ignoredEventId, ...withoutEventId } = item;
    void ignoredEventId;
    const created = withClientEventId(withoutEventId as never);
    expect(created).toMatchObject(withoutEventId);
    expect(created.eventId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});

describe('nekade händelser', () => {
  /** Efterliknar oRPC:s ORPCError, som bär statuskoden som ett tal. */
  function httpError(status: number) {
    return Object.assign(new Error(`HTTP ${String(status)}`), { status });
  }

  test('en obehörig händelse kastas ur kön i stället för att köas för evigt', async () => {
    const repository = memoryRepository();
    const outbox = createEventOutbox(repository);
    const item = event();
    await outbox.enqueue(item);

    const result = await outbox.drain(() => Promise.reject(httpError(401)));

    expect(result.rejected.map((entry) => entry.event.eventId)).toEqual([item.eventId]);
    expect(result.failedEventId).toBeUndefined();
    expect(repository.entries.size).toBe(0);
  });

  test('ett serverfel köas som förut', async () => {
    const repository = memoryRepository();
    const outbox = createEventOutbox(repository);
    const item = event();
    await outbox.enqueue(item);

    const result = await outbox.drain(() => Promise.reject(httpError(500)));

    expect(result.rejected).toEqual([]);
    expect(result.failedEventId).toBe(item.eventId);
    expect(repository.entries.size).toBe(1);
  });

  test('en nekad händelse blockerar inte de som står efter i kön', async () => {
    const repository = memoryRepository();
    const outbox = createEventOutbox(repository);
    const denied = event();
    const accepted = event();
    await outbox.enqueue(denied);
    await outbox.enqueue(accepted);

    const result = await outbox.drain((pending) =>
      pending.eventId === denied.eventId
        ? Promise.reject(httpError(403))
        : Promise.resolve({
            eventId: pending.eventId,
            matchId: pending.matchId,
            seq: 1,
            receivedAt: '2026-09-21T10:00:01.000Z',
          }),
    );

    expect(result.rejected.map((entry) => entry.event.eventId)).toEqual([denied.eventId]);
    expect(result.sent.map((entry) => entry.eventId)).toEqual([accepted.eventId]);
    expect(repository.entries.size).toBe(0);
  });

  test('429 och 408 är uppmaningar att vänta, inte slutgiltiga nej', async () => {
    for (const status of [408, 429]) {
      const repository = memoryRepository();
      const outbox = createEventOutbox(repository);
      await outbox.enqueue(event());

      const result = await outbox.drain(() => Promise.reject(httpError(status)));

      expect(result.rejected).toEqual([]);
      expect(repository.entries.size).toBe(1);
    }
  });
});
