import { describe, expect, test, vi } from 'vitest';
import type { SequencedMatchEvent } from '@coach-clock/contracts';
import {
  createMatchEventStream,
  streamUrl,
  type EventSourceLike,
  type VisibilitySource,
} from './match-event-stream';

const matchId = '00000000-0000-4000-8000-000000000001';

describe('streamUrl', () => {
  test('keeps the /api prefix the deployed rewrite depends on', () => {
    expect(streamUrl(matchId, 'https://coach-clock-web.onrender.com/api')).toBe(
      `https://coach-clock-web.onrender.com/api/matches/stream?matchId=${matchId}`,
    );
  });

  test('works against a bare origin in development', () => {
    expect(streamUrl(matchId, 'http://localhost:4002')).toBe(
      `http://localhost:4002/matches/stream?matchId=${matchId}`,
    );
  });
});

function event(seq: number): SequencedMatchEvent {
  return {
    seq,
    receivedAt: '2026-09-21T10:00:00.000Z',
    event: {
      eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
      matchId,
      v: 1,
      at: '2026-09-21T10:00:00.000Z',
      by: 'coach',
      type: 'period_started',
      periodNumber: 1,
    },
  };
}

class FakeSource implements EventSourceLike {
  onopen: ((event?: Event) => void) | null = null;
  onmessage: ((message: { readonly data: string }) => void) | null = null;
  onerror: ((event?: Event) => void) | null = null;
  closed = false;
  close() {
    this.closed = true;
  }
  open() {
    this.onopen?.();
  }
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  fail() {
    this.onerror?.();
  }
}

function visibility(): VisibilitySource & { setHidden(hidden: boolean): void } {
  let hidden = false;
  const listeners = new Set<() => void>();
  return {
    get hidden() {
      return hidden;
    },
    addEventListener: (_, listener) => void listeners.add(listener),
    removeEventListener: (_, listener) => void listeners.delete(listener),
    setHidden(next) {
      hidden = next;
      for (const listener of listeners) listener();
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('match event stream', () => {
  test('merges SSE events by sequence and fills a missed gap via the typed read endpoint', async () => {
    const source = new FakeSource();
    const applied: number[] = [];
    const readEvents = vi.fn((sinceSeq: number) =>
      Promise.resolve(sinceSeq === 1 ? [event(2)] : []),
    );
    const stream = createMatchEventStream({
      matchId,
      onEvent: (item) => applied.push(item.seq),
      readEvents,
      eventSource: () => source,
    });

    stream.start();
    source.open();
    await flush();
    source.message(event(1));
    source.message(event(3));
    await stream.catchUp();

    expect(applied).toEqual([1, 2, 3]);
    expect(readEvents).toHaveBeenCalledWith(1);
    expect(stream.lastSeq).toBe(3);
  });

  test('reconnects with exponential backoff and catches up before accepting new frames', async () => {
    const sources: FakeSource[] = [];
    const timers: Array<() => void> = [];
    const applied: number[] = [];
    const stream = createMatchEventStream({
      matchId,
      onEvent: (item) => applied.push(item.seq),
      readEvents: () => Promise.resolve([event(1)]),
      eventSource: () => {
        const source = new FakeSource();
        sources.push(source);
        return source;
      },
      setTimeout: (callback) => {
        timers.push(callback);
        return 1;
      },
      clearTimeout: () => undefined,
    });

    stream.start();
    sources[0]?.open();
    sources[0]?.fail();
    expect(sources[0]?.closed).toBe(true);
    expect(timers).toHaveLength(1);
    timers[0]?.();
    sources[1]?.open();
    await flush();

    expect(applied).toEqual([1]);
    expect(stream.status).toBe('connected');
  });

  test('pauses a hidden tab and replays the missed log before reconnecting when visible', async () => {
    const source = new FakeSource();
    const document = visibility();
    const readEvents = vi.fn(() => Promise.resolve([event(1), event(2)]));
    const applied: number[] = [];
    const stream = createMatchEventStream({
      matchId,
      onEvent: (item) => applied.push(item.seq),
      readEvents,
      eventSource: () => source,
      visibility: document,
    });

    stream.start();
    source.open();
    await flush();
    document.setHidden(true);
    expect(source.closed).toBe(true);
    expect(stream.status).toBe('paused');

    document.setHidden(false);
    await flush();
    expect(readEvents).toHaveBeenCalled();
    expect(applied).toEqual([1, 2]);
  });

  test('ignores duplicate, malformed, and cross-match stream data', async () => {
    const source = new FakeSource();
    const applied: number[] = [];
    const stream = createMatchEventStream({
      matchId,
      onEvent: (item) => applied.push(item.seq),
      readEvents: () => Promise.resolve([]),
      eventSource: () => source,
    });
    stream.start();
    source.open();
    source.message(event(1));
    source.message(event(1));
    source.message({ ...event(2), event: { ...event(2).event, matchId: 'other' } });
    await stream.catchUp();
    expect(applied).toEqual([1]);
  });
});
