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

function memoryRepository(initial: readonly OutboxEntry[] = []): OutboxRepository & { entries: Map<string, OutboxEntry> } {
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
    const repository = memoryRepository([{ event: item, attempts: 0, nextAttemptAt: 0, queuedAt: 1 }]);
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
    expect(repository.entries.get(first.eventId)).toMatchObject({ attempts: 2, nextAttemptAt: 1_200 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('leaves a deferred retry untouched until its retry time', async () => {
    const item = event();
    const repository = memoryRepository([{ event: item, attempts: 1, nextAttemptAt: 100, queuedAt: 1 }]);
    const send = vi.fn();

    await expect(drainOutbox(repository, send, { now: () => 99 })).resolves.toEqual({ sent: [], nextAttemptAt: 100 });
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
    expect(created.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});
