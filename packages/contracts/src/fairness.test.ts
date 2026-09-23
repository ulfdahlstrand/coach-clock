import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deriveFairnessState, deriveMatchState, MATCH_EVENT_VERSION } from './index.js';

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

/*
 * Testerna räknar på några minuter långa matcher, så grundmatchen har en kort
 * bytestid. Förvalet på fyra minuter prövas separat nedan.
 */
function foundation(
  bench = [ids.e, ids.f],
  idealShiftSeconds: number | null = 60,
  positionMode: 'time' | 'best' | 'even' | null = null,
) {
  counter = 0;
  return [
    event('2026-09-20T13:00:00.000Z', {
      type: 'match_created',
      format: 5,
      formationId: '5v5-1-2-1',
      periods: 1,
      periodLengthSeconds: 1_200,
      opponent: 'IF Test',
      // null efterliknar en match skapad innan fältet fanns.
      ...(idealShiftSeconds === null ? {} : { idealShiftSeconds }),
      ...(positionMode === null ? {} : { positionMode }),
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
    const fairness = deriveFairnessState(foundation(), at(120));

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

describe('målvakt som roteras ut', () => {
  /**
   * Tid i mål är svår att parera för, så en målvakt får gärna mer total speltid.
   * Men hon ska inte straffas i de andra perioderna: skulden fryses medan hon
   * står i buren, och när hon byts ut konkurrerar hon om utespelartid på samma
   * villkor som alla andra.
   */
  function withKeeperSwap() {
    return [
      ...foundation(),
      // Efter två minuter går målvakten av och E tar över buren.
      event('2026-09-20T13:02:00.000Z', {
        type: 'substitution_confirmed',
        swaps: [{ slotId: 'gk', outPlayerId: ids.gk, inPlayerId: ids.e }],
      }),
    ];
  }

  it('räknar med den utbytta målvakten i rotationen', () => {
    const fairness = deriveFairnessState(withKeeperSwap(), at(240));

    const keeper = fairness.rotationPlayers.find((player) => player.playerId === ids.gk);
    expect(keeper).toBeDefined();
    expect(fairness.goalkeeperPlayers.map((player) => player.playerId)).toEqual([ids.e]);
  });

  it('fryser målvaktens skuld medan hon står i mål', () => {
    // Inget hände mellan 13:00 och 13:02 utom att hon vaktade buren.
    const duringFirstStint = deriveFairnessState(withKeeperSwap(), at(60));
    const keeperWhileKeeping = duringFirstStint.players.find(
      (player) => player.playerId === ids.gk,
    );

    expect(keeperWhileKeeping?.shareMs).toBe(0);
    expect(keeperWhileKeeping?.playedMs).toBe(0);
    expect(keeperWhileKeeping?.debtMs).toBe(0);
  });

  it('ställer henne i kön utan att tiden i mål räknas för eller emot henne', () => {
    const fairness = deriveFairnessState(withKeeperSwap(), at(240));
    const debt = (playerId: string) =>
      fairness.players.find((player) => player.playerId === playerId)?.debtMs;

    // Andelen tjänas bara de två minuter hon inte stod i mål: 4/6 × 120 s.
    expect(debt(ids.gk)).toBe(80_000);
    // F har suttit på bänken hela matchen och går därför först.
    expect(debt(ids.f)).toBe(160_000);
    expect(fairness.suggestedSubstitution?.inPlayerId).toBe(ids.f);
  });

  it('föreslår henne som utespelare när hon väntat längst', () => {
    const log = [
      ...withKeeperSwap(),
      event('2026-09-20T13:00:00.000Z', {
        type: 'availability_changed',
        playerId: ids.f,
        available: false,
        from: '2026-09-20T13:00:00.000Z',
      }),
    ];
    const fairness = deriveFairnessState(log, at(240));

    expect(fairness.substitutionDue).toBe(true);
    expect(fairness.suggestedSubstitution?.inPlayerId).toBe(ids.gk);
  });

  it('lämnar ett lag med fast målvakt oförändrat', () => {
    const fairness = deriveFairnessState(foundation(), at(120));

    expect(fairness.rotatingSlotCount).toBe(4);
    expect(fairness.goalkeeperPlayers.map((player) => player.playerId)).toEqual([ids.gk]);
    expect(fairness.rotationPlayers.some((player) => player.playerId === ids.gk)).toBe(false);
  });
});

describe('bytestid', () => {
  it('föreslår ingen utbytt spelare innan hon spelat klart sitt pass', () => {
    const fairness = deriveFairnessState(foundation(undefined, 240), at(120));

    expect(fairness.idealShiftMs).toBe(240_000);
    expect(fairness.substitutionDue).toBe(false);
    // Alla fyra utespelare gick in vid avspark och har två minuter kvar.
    expect(fairness.timeToNextSubstitutionMs).toBe(120_000);
  });

  it('gör bytet befogat när passet är slut och bänken ligger efter', () => {
    const fairness = deriveFairnessState(foundation(undefined, 240), at(240));

    expect(fairness.substitutionDue).toBe(true);
    expect(fairness.timeToNextSubstitutionMs).toBe(0);
    expect(fairness.suggestedSubstitution?.inPlayerId).toBe(ids.e);
  });

  it('startar om passet för den som byts in', () => {
    const log = [
      ...foundation(undefined, 240),
      event('2026-09-20T13:04:00.000Z', {
        type: 'substitution_confirmed',
        swaps: [{ slotId: 'cb', outPlayerId: ids.a, inPlayerId: ids.e }],
      }),
    ];
    const fairness = deriveFairnessState(log, at(300));
    const shift = (playerId: string) =>
      fairness.players.find((player) => player.playerId === playerId)?.currentShiftMs;

    expect(shift(ids.e)).toBe(60_000);
    expect(shift(ids.a)).toBe(0);
    expect(shift(ids.b)).toBe(300_000);
  });

  it('räknar inte en pausad klocka som speltid i passet', () => {
    const log = [
      ...foundation(undefined, 240),
      event('2026-09-20T13:01:00.000Z', { type: 'clock_paused', reason: 'Skada' }),
      event('2026-09-20T13:03:00.000Z', { type: 'clock_resumed' }),
    ];
    const fairness = deriveFairnessState(log, at(240));

    // Fyra minuter på väggklockan, men två av dem stod klockan still.
    expect(fairness.players.find((player) => player.playerId === ids.a)?.currentShiftMs).toBe(
      120_000,
    );
    expect(fairness.substitutionDue).toBe(false);
  });

  it('ger äldre matcher utan bytestid förvalet på fyra minuter', () => {
    const fairness = deriveFairnessState(foundation(undefined, null), at(120));

    expect(fairness.idealShiftMs).toBe(240_000);
  });
});

describe('positioner i bytesförslagen', () => {
  /*
   * 5 mot 5: MB (försvar), VM och HM (mittfält), CA (anfall). F görs otillgänglig
   * så att den inbytta spelaren är förutsägbar. Lägena ska ge olika svar —
   * annars bevisar testerna ingenting.
   */
  const fUnavailable = () =>
    event('2026-09-20T13:00:00.000Z', {
      type: 'availability_changed',
      playerId: ids.f,
      available: false,
      from: '2026-09-20T13:00:00.000Z',
    });

  /** A (startade som mittback) byts ut mot E efter en minut och ska tillbaka in. */
  function defenderReturns(mode: 'time' | 'best' | 'even') {
    return [
      ...foundation(undefined, 60, mode),
      fUnavailable(),
      event('2026-09-20T13:01:00.000Z', {
        type: 'substitution_confirmed',
        swaps: [{ slotId: 'cb', outPlayerId: ids.a, inPlayerId: ids.e }],
      }),
    ];
  }

  it('bara speltid tar ut den som spelat mest', () => {
    const fairness = deriveFairnessState(defenderReturns('time'), at(240));
    expect(fairness.suggestedSubstitution).toEqual({ outPlayerId: ids.b, inPlayerId: ids.a });
  });

  it('bästa positioner byter på den inbyttas bästa lagdel', () => {
    const fairness = deriveFairnessState(defenderReturns('best'), at(240));
    // A startade som mittback — hon tar tillbaka platsen från E.
    expect(fairness.positionMode).toBe('best');
    expect(fairness.suggestedSubstitution).toEqual({ outPlayerId: ids.e, inPlayerId: ids.a });
  });

  it('jämn fördelning byter på den lagdel den inbytta spelat minst i', () => {
    // B spelade mittfält en minut. A flyttas upp på mittfältet, så att den som
    // spelat mest (och tas ut av "bara speltid") står på B:s gamla lagdel.
    const movedToMidfield = (mode: 'time' | 'even') => [
      ...foundation(undefined, 60, mode),
      fUnavailable(),
      event('2026-09-20T13:01:00.000Z', {
        type: 'substitution_confirmed',
        swaps: [{ slotId: 'lm', outPlayerId: ids.b, inPlayerId: ids.e }],
      }),
      event('2026-09-20T13:01:00.000Z', {
        type: 'player_moved',
        playerId: ids.a,
        fromSlotId: 'cb',
        toSlotId: 'lm',
      }),
    ];
    const even = deriveFairnessState(movedToMidfield('even'), at(240));
    const time = deriveFairnessState(movedToMidfield('time'), at(240));

    expect(time.suggestedSubstitution?.outPlayerId).toBe(ids.a);
    // B har ingen tid i försvar eller anfall; anfallaren har spelat mest av de två.
    expect(even.suggestedSubstitution).toEqual({ outPlayerId: ids.d, inPlayerId: ids.b });
  });

  it('faller tillbaka på lägst skuld när den inbytta inte har någon lagdel än', () => {
    // F har suttit på bänken hela matchen och har ingen bästa lagdel.
    const fairness = deriveFairnessState(foundation(undefined, 60, 'best'), at(240));
    expect(fairness.suggestedSubstitution).toEqual({ outPlayerId: ids.a, inPlayerId: ids.e });
  });

  it('ger bänkstartaren den första lagdel hon sätts in på', () => {
    const state = deriveMatchState(defenderReturns('best'), at(240));
    expect(state.players[ids.e]?.bestRole).toBe('defender');
    expect(state.players[ids.a]?.bestRole).toBe('defender');
    expect(state.players[ids.f]?.bestRole).toBeNull();
  });

  it('ger äldre matcher läget bara speltid', () => {
    expect(deriveFairnessState(foundation(), at(120)).positionMode).toBe('time');
  });
});
