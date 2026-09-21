import { describe, expect, test } from 'vitest';
import type { MatchEvent } from '@coach-clock/contracts';
import { deriveVisibleMatchClock, formatClock } from './match-clock-view';

const matchId = '00000000-0000-4000-8000-000000000001';

function periodStarted(at: string): MatchEvent {
  return {
    eventId: '00000000-0000-4000-8000-000000000002',
    matchId,
    v: 1,
    at,
    by: 'owner',
    type: 'period_started',
    periodNumber: 1,
  };
}

describe('match clock view', () => {
  test('formats readable minute and second values', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65_900)).toBe('1:05');
  });

  test('derives the display only from the log and server-adjusted now', () => {
    const events = [periodStarted('2026-09-21T10:00:00.000Z')];

    expect(deriveVisibleMatchClock(events, undefined)).toBeUndefined();
    expect(
      deriveVisibleMatchClock(events, new Date('2026-09-21T10:01:15.800Z'))?.periodElapsedMs,
    ).toBe(75_800);
  });
});
