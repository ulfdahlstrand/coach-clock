import { describe, expect, test } from 'vitest';
import type { MatchEvent } from '@coach-clock/contracts';
import { deriveVisibleMatchClock, formatClock, matchControlState } from './match-clock-view';

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

describe('klockknapparna', () => {
  const base = {
    periodNumber: null,
    running: false,
    currentPeriodEnded: false,
    periodCount: 3,
    ended: false,
  };

  test('en nyskapad match står still och väntar på avspark', () => {
    expect(matchControlState(base)).toEqual({
      status: 'EJ STARTAD',
      startLabel: 'Starta period 1',
      notStarted: true,
      matchOver: false,
    });
  });

  test('skiljer en pausad klocka från en avblåst period', () => {
    const paused = matchControlState({ ...base, periodNumber: 1 });
    expect([paused.status, paused.startLabel]).toEqual(['PAUS', 'Fortsätt']);

    const between = matchControlState({ ...base, periodNumber: 1, currentPeriodEnded: true });
    expect([between.status, between.startLabel]).toEqual(['PERIODPAUS', 'Starta period 2']);
  });

  test('erbjuder Avsluta match först när sista perioden är avblåst', () => {
    expect(matchControlState({ ...base, periodNumber: 3, running: true }).matchOver).toBe(false);
    expect(
      matchControlState({ ...base, periodNumber: 3, currentPeriodEnded: true }).matchOver,
    ).toBe(true);
  });

  test('visar SLUT och inga fler knappar när matchen är avslutad', () => {
    const ended = matchControlState({
      ...base,
      periodNumber: 3,
      currentPeriodEnded: true,
      ended: true,
    });
    expect([ended.status, ended.matchOver]).toEqual(['SLUT', false]);
  });
});
