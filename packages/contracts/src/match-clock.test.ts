import { describe, expect, it } from 'vitest';
import { MATCH_EVENT_VERSION, matchClock, type MatchEvent } from './index.js';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';
let nextId = 0;

function event(
  at: string,
  payload:
    | { type: 'period_started'; periodNumber: number }
    | { type: 'period_ended'; periodNumber: number }
    | { type: 'clock_paused' }
    | { type: 'clock_resumed' },
): MatchEvent {
  nextId += 1;
  return {
    eventId: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    matchId: MATCH_ID,
    v: MATCH_EVENT_VERSION,
    at,
    by: 'coach:ulf',
    ...payload,
  };
}

describe('matchClock', () => {
  it('räknar bara segmentet före en paus mitt i perioden', () => {
    const clock = matchClock(
      [
        event('2026-09-20T13:00:00.000Z', { type: 'period_started', periodNumber: 1 }),
        event('2026-09-20T13:12:30.000Z', { type: 'clock_paused' }),
      ],
      new Date('2026-09-20T13:20:00.000Z'),
    );

    expect(clock).toEqual({
      periodNumber: 1,
      running: false,
      elapsedMs: 750_000,
      periodElapsedMs: 750_000,
      segments: [
        {
          periodNumber: 1,
          startedAt: '2026-09-20T13:00:00.000Z',
          endedAt: '2026-09-20T13:12:30.000Z',
          elapsedMs: 750_000,
        },
      ],
    });
  });

  it('avslutar en pausad period utan att lägga till paustid', () => {
    const clock = matchClock(
      [
        event('2026-09-20T13:00:00.000Z', { type: 'period_started', periodNumber: 1 }),
        event('2026-09-20T13:10:00.000Z', { type: 'clock_paused' }),
        event('2026-09-20T13:30:00.000Z', { type: 'period_ended', periodNumber: 1 }),
      ],
      new Date('2026-09-20T14:00:00.000Z'),
    );

    expect(clock.running).toBe(false);
    expect(clock.elapsedMs).toBe(600_000);
    expect(clock.periodElapsedMs).toBe(600_000);
    expect(clock.segments).toHaveLength(1);
  });

  it('sorterar händelser som anländer i fel ordning utan att ändra indatan', () => {
    const pause = event('2026-09-20T13:08:00.000Z', { type: 'clock_paused' });
    const start = event('2026-09-20T13:00:00.000Z', {
      type: 'period_started',
      periodNumber: 1,
    });
    const events = [pause, start];

    const clock = matchClock(events, new Date('2026-09-20T13:20:00.000Z'));

    expect(clock.elapsedMs).toBe(480_000);
    expect(clock.running).toBe(false);
    expect(events).toEqual([pause, start]);
  });

  it('härleder en lång offline-period från återupptagningens tidsstämpel och now', () => {
    const clock = matchClock(
      [
        event('2026-09-20T13:00:00.000Z', { type: 'period_started', periodNumber: 1 }),
        event('2026-09-20T13:05:00.000Z', { type: 'clock_paused' }),
        event('2026-09-20T13:10:00.000Z', { type: 'clock_resumed' }),
      ],
      new Date('2026-09-20T14:10:00.000Z'),
    );

    expect(clock.running).toBe(true);
    expect(clock.elapsedMs).toBe(3_900_000);
    expect(clock.periodElapsedMs).toBe(3_900_000);
    expect(clock.segments).toEqual([
      {
        periodNumber: 1,
        startedAt: '2026-09-20T13:00:00.000Z',
        endedAt: '2026-09-20T13:05:00.000Z',
        elapsedMs: 300_000,
      },
      {
        periodNumber: 1,
        startedAt: '2026-09-20T13:10:00.000Z',
        endedAt: '2026-09-20T14:10:00.000Z',
        elapsedMs: 3_600_000,
      },
    ]);
  });

  it('skiljer total matchtid från tiden i aktuell period', () => {
    const clock = matchClock(
      [
        event('2026-09-20T13:00:00.000Z', { type: 'period_started', periodNumber: 1 }),
        event('2026-09-20T13:25:00.000Z', { type: 'period_ended', periodNumber: 1 }),
        event('2026-09-20T13:35:00.000Z', { type: 'period_started', periodNumber: 2 }),
      ],
      new Date('2026-09-20T13:40:00.000Z'),
    );

    expect(clock.periodNumber).toBe(2);
    expect(clock.running).toBe(true);
    expect(clock.elapsedMs).toBe(1_800_000);
    expect(clock.periodElapsedMs).toBe(300_000);
  });

  it('ignorerar ogiltiga övergångar, orelaterade och framtida händelser', () => {
    const clock = matchClock(
      [
        event('2026-09-20T12:59:00.000Z', { type: 'clock_resumed' }),
        {
          eventId: '99999999-9999-4999-8999-999999999999',
          matchId: MATCH_ID,
          v: MATCH_EVENT_VERSION,
          at: '2026-09-20T13:00:00.000Z',
          by: 'coach:ulf',
          type: 'match_ended',
        },
        event('2026-09-20T13:05:00.000Z', { type: 'period_started', periodNumber: 1 }),
        event('2026-09-20T14:00:00.000Z', { type: 'clock_paused' }),
      ],
      new Date('2026-09-20T13:10:00.000Z'),
    );

    expect(clock.running).toBe(true);
    expect(clock.elapsedMs).toBe(300_000);
  });

  it('ger ett tomt, stoppat resultat för ogiltigt now', () => {
    expect(matchClock([], new Date(Number.NaN))).toEqual({
      periodNumber: null,
      running: false,
      elapsedMs: 0,
      periodElapsedMs: 0,
      segments: [],
    });
  });
});
