import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deriveFairnessState, MATCH_EVENT_VERSION } from './index.js';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';
const ids = {
  gk: '10000000-0000-4000-8000-000000000001',
  a: '10000000-0000-4000-8000-000000000002',
  b: '10000000-0000-4000-8000-000000000003',
  c: '10000000-0000-4000-8000-000000000004',
  d: '10000000-0000-4000-8000-000000000005',
  e: '10000000-0000-4000-8000-000000000006',
  f: '10000000-0000-4000-8000-000000000007',
} as const;
const allPlayers = Object.entries(ids).map(([key, playerId], index) => ({
  playerId,
  name: key.toUpperCase(),
  number: index + 1,
  isGoalkeeper: key === 'gk',
}));

let counter = 0;
function event(at: string, payload: Record<string, unknown>) {
  counter += 1;
  return {
    eventId: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    matchId: MATCH_ID,
    v: MATCH_EVENT_VERSION,
    at,
    by: 'coach',
    ...payload,
  };
}

function foundation(bench = [ids.e, ids.f]) {
  counter = 0;
  return [
    event('2026-09-20T13:00:00.000Z', {
      type: 'match_created',
      format: 5,
      formationId: '5v5-1-2-1',
      periods: 1,
      periodLengthSeconds: 1_200,
      opponent: 'IF Test',
    }),
    event('2026-09-20T13:00:00.000Z', { type: 'squad_set', players: allPlayers }),
    event('2026-09-20T13:00:00.000Z', {
      type: 'lineup_set',
      assignments: [
        { slotId: 'gk', playerId: ids.gk },
        { slotId: 'cb', playerId: ids.a },
        { slotId: 'lm', playerId: ids.b },
        { slotId: 'rm', playerId: ids.c },
        { slotId: 'st', playerId: ids.d },
      ],
      bench,
    }),
    event('2026-09-20T13:00:00.000Z', { type: 'period_started', periodNumber: 1 }),
  ];
}

function at(seconds: number): Date {
  return new Date(
    `2026-09-20T13:${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}.000Z`,
  );
}

describe('deriveFairnessState', () => {
  it('uses fair share, reports when a swap is due, and suggests the two extremes', () => {
    const fairness = deriveFairnessState(foundation(), at(120), { debtThresholdMs: 60_000 });

    expect(fairness.rotatingSlotCount).toBe(4);
    expect(fairness.goalkeeperPlayers).toHaveLength(1);
    expect(fairness.rotationPlayers.find((player) => player.playerId === ids.e)).toMatchObject({
      shareMs: 80_000,
      playedMs: 0,
      debtMs: 80_000,
    });
    expect(fairness.substitutionDue).toBe(true);
    expect(fairness.timeToNextSubstitutionMs).toBe(0);
    expect(fairness.suggestedSubstitution).toEqual({ outPlayerId: ids.a, inPlayerId: ids.e });
  });

  it('starts a late arrival earning only when they become available', () => {
    const events = foundation();
    events.push(
      event('2026-09-20T13:01:05.000Z', {
        type: 'availability_changed',
        playerId: ids.e,
        available: false,
        from: '2026-09-20T13:00:00.000Z',
      }),
      event('2026-09-20T13:01:05.000Z', {
        type: 'availability_changed',
        playerId: ids.e,
        available: true,
        from: '2026-09-20T13:01:00.000Z',
      }),
    );

    const fairness = deriveFairnessState(events, at(120));
    expect(fairness.rotationPlayers.find((player) => player.playerId === ids.e)).toMatchObject({
      shareMs: 40_000,
      playedMs: 0,
      debtMs: 40_000,
    });
    expect(fairness.rotationPlayers.find((player) => player.playerId === ids.a)?.shareMs).toBe(
      88_000,
    );
  });

  it('stops an injured player earning share from the recorded effective time', () => {
    const events = foundation();
    events.push(
      event('2026-09-20T13:01:00.000Z', {
        type: 'substitution_confirmed',
        swaps: [{ slotId: 'st', outPlayerId: ids.d, inPlayerId: ids.e }],
      }),
      event('2026-09-20T13:01:05.000Z', {
        type: 'availability_changed',
        playerId: ids.d,
        available: false,
        from: '2026-09-20T13:01:00.000Z',
      }),
    );

    const fairness = deriveFairnessState(events, at(120));
    expect(fairness.rotationPlayers.find((player) => player.playerId === ids.d)).toMatchObject({
      available: false,
      shareMs: 40_000,
      playedMs: 60_000,
      debtMs: -20_000,
    });
  });

  it('can rotate the goalkeeper into the same pool when requested', () => {
    const fairness = deriveFairnessState(foundation(), at(120), { rotateGoalkeepers: true });

    expect(fairness.rotatingSlotCount).toBe(5);
    expect(fairness.goalkeeperPlayers).toEqual([]);
    expect(fairness.rotationPlayers.find((player) => player.playerId === ids.gk)).toMatchObject({
      shareMs: 85_714.28571428571,
      playedMs: 120_000,
      debtMs: -34_285.71428571429,
    });
  });

  it('preserves share accounting invariants for random availability histories', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            second: fc.integer({ min: 0, max: 119 }),
            player: fc.constantFrom(ids.e, ids.f),
            available: fc.boolean(),
          }),
          { maxLength: 20 },
        ),
        (changes) => {
          const events = foundation();
          for (const change of changes) {
            const timestamp = at(change.second).toISOString();
            events.push(
              event(timestamp, {
                type: 'availability_changed',
                playerId: change.player,
                available: change.available,
                from: timestamp,
              }),
            );
          }
          const fairness = deriveFairnessState(events, at(120));
          const earned = fairness.rotationPlayers.reduce(
            (total, player) => total + player.shareMs,
            0,
          );
          expect(earned).toBeCloseTo(4 * 120_000, 6);
          for (const player of fairness.rotationPlayers) {
            expect(Number.isFinite(player.debtMs)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
