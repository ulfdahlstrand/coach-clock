import type { MatchEvent } from './events.js';

/** A contiguous interval during which the match clock was running. */
export type MatchClockSegment = {
  readonly periodNumber: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly elapsedMs: number;
};

/** The clock derived from the event log at one explicit point in time. */
export type MatchClock = {
  /** The current period, or the most recently ended one. */
  readonly periodNumber: number | null;
  readonly running: boolean;
  /** Running time across all periods. */
  readonly elapsedMs: number;
  /** Running time in `periodNumber`. */
  readonly periodElapsedMs: number;
  readonly segments: readonly MatchClockSegment[];
};

type ClockEvent = Extract<
  MatchEvent,
  { type: 'period_started' | 'period_ended' | 'clock_paused' | 'clock_resumed' }
>;

type OrderedClockEvent = {
  readonly event: ClockEvent;
  readonly atMs: number;
};

function isClockEvent(event: MatchEvent): event is ClockEvent {
  return (
    event.type === 'period_started' ||
    event.type === 'period_ended' ||
    event.type === 'clock_paused' ||
    event.type === 'clock_resumed'
  );
}

function iso(atMs: number): string {
  return new Date(atMs).toISOString();
}

/**
 * Derives match time from timestamped events; it never owns or accumulates timer ticks.
 *
 * The input may arrive out of order. Equal timestamps are ordered by event id so every
 * device derives the same result. Events after `now`, unrelated events, and invalid
 * clock transitions are ignored. Undo and timestamp-correction events are intentionally
 * applied by the match-state pre-pass before this function is called.
 */
export function matchClock(events: readonly MatchEvent[], now: Date): MatchClock {
  const nowMs = now.getTime();

  if (!Number.isFinite(nowMs)) {
    return {
      periodNumber: null,
      running: false,
      elapsedMs: 0,
      periodElapsedMs: 0,
      segments: [],
    };
  }

  const clockEvents: OrderedClockEvent[] = events
    .filter(isClockEvent)
    .map((event) => ({ event, atMs: Date.parse(event.at) }))
    .filter(({ atMs }) => Number.isFinite(atMs) && atMs <= nowMs)
    .sort(
      (left, right) =>
        left.atMs - right.atMs ||
        (left.event.eventId < right.event.eventId
          ? -1
          : Number(left.event.eventId > right.event.eventId)),
    );

  const segments: MatchClockSegment[] = [];
  let periodNumber: number | null = null;
  let periodActive = false;
  let runningSinceMs: number | null = null;

  const closeSegment = (endedAtMs: number) => {
    if (periodNumber === null || runningSinceMs === null || endedAtMs < runningSinceMs) return;

    segments.push({
      periodNumber,
      startedAt: iso(runningSinceMs),
      endedAt: iso(endedAtMs),
      elapsedMs: endedAtMs - runningSinceMs,
    });
    runningSinceMs = null;
  };

  for (const { event, atMs } of clockEvents) {
    switch (event.type) {
      case 'period_started':
        if (periodActive) break;
        periodNumber = event.periodNumber;
        periodActive = true;
        runningSinceMs = atMs;
        break;

      case 'clock_paused':
        if (!periodActive || runningSinceMs === null) break;
        closeSegment(atMs);
        break;

      case 'clock_resumed':
        if (!periodActive || runningSinceMs !== null) break;
        runningSinceMs = atMs;
        break;

      case 'period_ended':
        if (!periodActive || periodNumber !== event.periodNumber) break;
        closeSegment(atMs);
        periodActive = false;
        break;
    }
  }

  const running = periodActive && runningSinceMs !== null;
  if (running) closeSegment(nowMs);

  const elapsedMs = segments.reduce((sum, segment) => sum + segment.elapsedMs, 0);
  const periodElapsedMs = segments.reduce(
    (sum, segment) => sum + (segment.periodNumber === periodNumber ? segment.elapsedMs : 0),
    0,
  );

  return {
    periodNumber,
    running,
    elapsedMs,
    periodElapsedMs,
    segments,
  };
}
