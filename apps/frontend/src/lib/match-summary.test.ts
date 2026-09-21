import { describe, expect, test } from 'vitest';
import type { MatchEvent } from '@coach-clock/contracts';
import { createMatchSummary, formatMatchDuration } from './match-summary';

const matchId = '00000000-0000-4000-8000-000000000001';
const first = '00000000-0000-4000-8000-000000000011';
const second = '00000000-0000-4000-8000-000000000012';
const third = '00000000-0000-4000-8000-000000000013';
const fourth = '00000000-0000-4000-8000-000000000014';
const fifth = '00000000-0000-4000-8000-000000000015';
const at = (second: number) =>
  `2026-09-21T10:${String(Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}.000Z`;
const base = { matchId, v: 1 as const, by: 'coach' };

const events: MatchEvent[] = [
  {
    ...base,
    eventId: '00000000-0000-4000-8000-000000000101',
    at: at(0),
    type: 'match_created',
    format: 5,
    formationId: '5v5-1-2-1',
    periods: 1,
    periodLengthSeconds: 600,
    opponent: 'BK Test',
  },
  {
    ...base,
    eventId: '00000000-0000-4000-8000-000000000102',
    at: at(0),
    type: 'squad_set',
    players: [
      { playerId: first, name: 'Ada', number: 1, isGoalkeeper: true },
      { playerId: second, name: 'Bea', number: 2, isGoalkeeper: false },
      { playerId: third, name: 'Cia', number: 3, isGoalkeeper: false },
      { playerId: fourth, name: 'Dia', number: 4, isGoalkeeper: false },
      { playerId: fifth, name: 'Eja', number: 5, isGoalkeeper: false },
    ],
  },
  {
    ...base,
    eventId: '00000000-0000-4000-8000-000000000103',
    at: at(0),
    type: 'lineup_set',
    assignments: [
      { slotId: 'gk', playerId: first },
      { slotId: 'cb', playerId: second },
      { slotId: 'lm', playerId: third },
      { slotId: 'rm', playerId: fourth },
      { slotId: 'st', playerId: fifth },
    ],
    bench: [],
  },
  {
    ...base,
    eventId: '00000000-0000-4000-8000-000000000104',
    at: at(0),
    type: 'period_started',
    periodNumber: 1,
  },
  {
    ...base,
    eventId: '00000000-0000-4000-8000-000000000105',
    at: at(120),
    type: 'clock_paused',
    reason: 'Skada',
  },
  { ...base, eventId: '00000000-0000-4000-8000-000000000106', at: at(180), type: 'clock_resumed' },
  {
    ...base,
    eventId: '00000000-0000-4000-8000-000000000107',
    at: at(240),
    type: 'period_ended',
    periodNumber: 1,
  },
];

describe('createMatchSummary', () => {
  test('sorts playing time and validates player minutes against running time', () => {
    const summary = createMatchSummary(events, new Date(at(300)));
    expect(summary.runningMs).toBe(180_000);
    expect(summary.actualPlayerMs).toBe(summary.expectedPlayerMs);
    expect(summary.playerTimeIsBalanced).toBe(true);
    expect(summary.players.map((player) => player.name)).toEqual([
      'Ada',
      'Bea',
      'Cia',
      'Dia',
      'Eja',
    ]);
    expect(summary.players.find((player) => player.name === 'Bea')?.roles[0]).toEqual({
      role: 'defender',
      playedMs: 180_000,
    });
  });

  test('creates a compact period, pause and substitution timeline', () => {
    const summary = createMatchSummary(events, new Date(at(300)));
    expect(summary.timeline.map((item) => item.kind)).toEqual([
      'period',
      'pause',
      'pause',
      'period',
    ]);
    expect(summary.timeline[1]?.label).toBe('Paus: Skada');
    expect(formatMatchDuration(summary.runningMs)).toBe('3:00');
  });
});
