import { describe, expect, it } from 'vitest';
import { deriveMatchState, MATCH_EVENT_VERSION, type DerivedMatchState } from './index.js';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';
const PLAYERS = [
  { playerId: '10000000-0000-4000-8000-000000000001', name: 'Gina', number: 1, isGoalkeeper: true },
  { playerId: '10000000-0000-4000-8000-000000000002', name: 'Bo', number: 2, isGoalkeeper: false },
  {
    playerId: '10000000-0000-4000-8000-000000000003',
    name: 'Cleo',
    number: 3,
    isGoalkeeper: false,
  },
  {
    playerId: '10000000-0000-4000-8000-000000000004',
    name: 'Dani',
    number: 4,
    isGoalkeeper: false,
  },
  { playerId: '10000000-0000-4000-8000-000000000005', name: 'Eli', number: 5, isGoalkeeper: false },
  {
    playerId: '10000000-0000-4000-8000-000000000006',
    name: 'Fatima',
    number: 6,
    isGoalkeeper: false,
  },
  { playerId: '10000000-0000-4000-8000-000000000007', name: 'Gus', number: 7, isGoalkeeper: false },
  {
    playerId: '10000000-0000-4000-8000-000000000008',
    name: 'Anna',
    number: 8,
    isGoalkeeper: false,
  },
] as const;

const [GINA, BO, CLEO, DANI, ELI, FATIMA, GUS, ANNA] = PLAYERS.map(({ playerId }) => playerId) as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

let nextId = 0;
function event(at: string, payload: Record<string, unknown>, by = 'coach:ulf') {
  nextId += 1;
  return {
    eventId: `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`,
    matchId: MATCH_ID,
    v: MATCH_EVENT_VERSION,
    at,
    by,
    ...payload,
  };
}

function foundation(format: 5 | 7 = 7) {
  const assignments =
    format === 7
      ? [
          { slotId: 'gk', playerId: GINA },
          { slotId: 'cb-left', playerId: BO },
          { slotId: 'cb-right', playerId: CLEO },
          { slotId: 'lm', playerId: DANI },
          { slotId: 'cm', playerId: ELI },
          { slotId: 'rm', playerId: FATIMA },
          { slotId: 'st', playerId: GUS },
        ]
      : [
          { slotId: 'gk', playerId: GINA },
          { slotId: 'cb', playerId: BO },
          { slotId: 'lm', playerId: CLEO },
          { slotId: 'rm', playerId: DANI },
          { slotId: 'st', playerId: ELI },
        ];

  return [
    event('2026-09-20T12:50:00.000Z', {
      type: 'match_created',
      format,
      formationId: format === 7 ? '7v7-2-3-1' : '5v5-1-2-1',
      periods: 2,
      periodLengthSeconds: 1_500,
      opponent: 'Grön IF',
    }),
    event('2026-09-20T12:51:00.000Z', { type: 'squad_set', players: PLAYERS }),
    event('2026-09-20T12:52:00.000Z', {
      type: 'lineup_set',
      assignments,
      bench: format === 7 ? [ANNA] : [FATIMA, GUS, ANNA],
    }),
    event('2026-09-20T13:00:00.000Z', { type: 'period_started', periodNumber: 1 }),
  ];
}

function sum(values: Readonly<Record<string, number>>): number {
  return Object.values(values).reduce((total, value) => total + value, 0);
}

function assertPlayerTimePartitions(state: DerivedMatchState): void {
  for (const player of Object.values(state.players)) {
    expect(sum(player.timeBySlotId)).toBe(player.playedMs);
    expect(sum(player.timeByRole)).toBe(player.playedMs);
  }
}

describe('deriveMatchState', () => {
  it('viker en skriptad match till speltid, platser, roller och planerade byten', () => {
    const events = foundation();
    events.push(
      event('2026-09-20T13:10:00.000Z', {
        type: 'substitution_confirmed',
        swaps: [{ slotId: 'st', outPlayerId: GUS, inPlayerId: ANNA }],
      }),
      event('2026-09-20T13:15:00.000Z', {
        type: 'player_moved',
        playerId: ANNA,
        fromSlotId: 'st',
        toSlotId: 'cm',
      }),
      event(
        '2026-09-20T13:18:00.000Z',
        {
          type: 'substitution_planned',
          planId: '20000000-0000-4000-8000-000000000001',
          swaps: [{ slotId: 'st', outPlayerId: ELI, inPlayerId: GUS }],
        },
        'coach:assistant',
      ),
    );

    const state = deriveMatchState(events, new Date('2026-09-20T13:20:00.000Z'));

    expect(state.clock.elapsedMs).toBe(20 * 60_000);
    expect(state.currentSlots).toMatchObject({ st: ELI, cm: ANNA });
    expect(state.players[GUS]?.playedMs).toBe(10 * 60_000);
    expect(state.players[ANNA]).toMatchObject({
      playedMs: 10 * 60_000,
      currentSlotId: 'cm',
      timeBySlotId: { st: 5 * 60_000, cm: 5 * 60_000 },
      timeByRole: { forward: 5 * 60_000, midfielder: 5 * 60_000 },
    });
    expect(state.players[ELI]?.timeBySlotId).toEqual({ cm: 15 * 60_000, st: 5 * 60_000 });
    expect(state.plannedSubstitutions).toEqual([
      {
        planId: '20000000-0000-4000-8000-000000000001',
        swaps: [{ slotId: 'st', outPlayerId: ELI, inPlayerId: GUS }],
        plannedBy: 'coach:assistant',
        plannedAt: '2026-09-20T13:18:00.000Z',
      },
    ]);
    expect(state.ignored).toEqual([]);

    const totalPlayed = Object.values(state.players).reduce(
      (total, player) => total + player.playedMs,
      0,
    );
    expect(totalPlayed).toBe(7 * state.clock.elapsedMs);
    expect(state.players[GINA]?.timeByRole.goalkeeper).toBe(state.clock.elapsedMs);
    assertPlayerTimePartitions(state);
  });

  it('räknar inte paus och fortsätter över flera perioder', () => {
    const events = foundation(5);
    events.push(
      event('2026-09-20T13:10:00.000Z', { type: 'clock_paused' }),
      event('2026-09-20T13:15:00.000Z', { type: 'clock_resumed' }),
      event('2026-09-20T13:25:00.000Z', { type: 'period_ended', periodNumber: 1 }),
      event('2026-09-20T13:35:00.000Z', { type: 'period_started', periodNumber: 2 }),
    );

    const state = deriveMatchState(events, new Date('2026-09-20T13:40:00.000Z'));

    expect(state.clock.elapsedMs).toBe(25 * 60_000);
    expect(state.players[GINA]?.playedMs).toBe(25 * 60_000);
    expect(Object.values(state.players).reduce((total, player) => total + player.playedMs, 0)).toBe(
      5 * state.clock.elapsedMs,
    );
    expect(state.players[GINA]?.timeByRole.goalkeeper).toBe(state.clock.elapsedMs);
    assertPlayerTimePartitions(state);
  });

  it('tillämpar tidsrättningar och gravstenar före vikningen', () => {
    const events = foundation(5);
    const corrected = event('2026-09-20T13:10:00.000Z', {
      type: 'substitution_confirmed',
      swaps: [{ slotId: 'st', outPlayerId: ELI, inPlayerId: ANNA }],
    });
    const undone = event('2026-09-20T13:12:00.000Z', {
      type: 'substitution_confirmed',
      swaps: [{ slotId: 'st', outPlayerId: ANNA, inPlayerId: ELI }],
    });
    events.push(
      corrected,
      undone,
      event('2026-09-20T13:13:00.000Z', {
        type: 'event_undone',
        targetEventId: undone.eventId,
      }),
      event('2026-09-20T13:15:00.000Z', {
        type: 'event_time_corrected',
        targetEventId: corrected.eventId,
        correctedAt: '2026-09-20T13:05:00.000Z',
      }),
    );

    const state = deriveMatchState(events, new Date('2026-09-20T13:20:00.000Z'));

    expect(state.currentSlots.st).toBe(ANNA);
    expect(state.players[ELI]?.playedMs).toBe(5 * 60_000);
    expect(state.players[ANNA]?.playedMs).toBe(15 * 60_000);
    expect(state.ignored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventId: undone.eventId, reason: 'undone' }),
      ]),
    );
  });

  it('ignorerar ett ogiltigt byte atomärt med en läsbar orsak', () => {
    const events = foundation(5);
    events.push(
      event('2026-09-20T13:12:31.000Z', {
        type: 'substitution_confirmed',
        swaps: [{ slotId: 'st', outPlayerId: ELI, inPlayerId: ANNA }],
      }),
      event('2026-09-20T13:14:00.000Z', {
        type: 'substitution_confirmed',
        swaps: [{ slotId: 'rm', outPlayerId: DANI, inPlayerId: ANNA }],
      }),
    );

    const state = deriveMatchState(events, new Date('2026-09-20T13:20:00.000Z'));

    expect(state.currentSlots).toMatchObject({ st: ANNA, rm: DANI });
    expect(state.ignored).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'invalid_transition',
          message: 'Anna byttes redan in 12:31',
        }),
      ]),
    );
    expect(state.players[DANI]?.playedMs).toBe(20 * 60_000);
  });

  it('behåller en plan när en bekräftelse inte stämmer och redovisar felet', () => {
    const events = foundation(5);
    const planId = '20000000-0000-4000-8000-000000000002';
    events.push(
      event('2026-09-20T13:03:00.000Z', {
        type: 'substitution_planned',
        planId,
        swaps: [{ slotId: 'st', outPlayerId: ELI, inPlayerId: ANNA }],
      }),
      event('2026-09-20T13:05:00.000Z', {
        type: 'substitution_confirmed',
        planId,
        swaps: [{ slotId: 'rm', outPlayerId: DANI, inPlayerId: ANNA }],
      }),
    );

    const state = deriveMatchState(events, new Date('2026-09-20T13:06:00.000Z'));

    expect(state.plannedSubstitutions).toHaveLength(1);
    expect(state.currentSlots.st).toBe(ELI);
    expect(state.ignored.at(-1)?.message).toContain('stämmer inte med bytesplanen');
  });

  it('hoppar över okända typer, trasiga poster och ogiltiga klockövergångar', () => {
    const events: unknown[] = foundation(5);
    events.unshift(null, { type: 'period_started' });
    events.push(
      event('2026-09-20T12:59:00.000Z', { type: 'weather_changed', condition: 'hagel' }),
      event('2026-09-20T13:05:00.000Z', { type: 'period_started', periodNumber: 2 }),
      event('2026-09-20T14:00:00.000Z', { type: 'match_ended' }),
    );

    expect(() => deriveMatchState(events, new Date('2026-09-20T13:10:00.000Z'))).not.toThrow();
    const state = deriveMatchState(events, new Date('2026-09-20T13:10:00.000Z'));

    expect(state.clock.elapsedMs).toBe(10 * 60_000);
    expect(state.ignored.map(({ reason }) => reason)).toEqual(
      expect.arrayContaining(['invalid', 'unknown_type', 'invalid_transition', 'future']),
    );
  });

  it('är total även för ett icke-arrayvärde och ogiltigt now', () => {
    expect(deriveMatchState({ events: [] }, new Date('2026-09-20T13:00:00.000Z'))).toMatchObject({
      clock: { elapsedMs: 0 },
      ignored: [expect.objectContaining({ reason: 'invalid' })],
    });
    expect(deriveMatchState([], new Date(Number.NaN))).toMatchObject({
      clock: { elapsedMs: 0 },
      ignored: [expect.objectContaining({ message: 'now måste vara ett giltigt datum' })],
    });
  });
});

describe('händelser med samma tidsstämpel', () => {
  /*
   * Backenden skriver alla fyra skapelsehändelser i en och samma transaktion,
   * med ett gemensamt `now`. Ordningen dem emellan bärs därför inte av tiden
   * utan av loggens ordning. Uuid:na här är valda så att en likabrytning på
   * eventId skulle lägga lineup_set före squad_set — då känner reducern inte
   * igen någon spelare och förkastar hela uppställningen.
   */
  const AT = '2026-09-20T12:50:00.000Z';
  const created = {
    eventId: '00000000-0000-4000-8000-0000000000aa',
    matchId: MATCH_ID,
    v: MATCH_EVENT_VERSION,
    at: AT,
    by: 'owner',
    type: 'match_created',
    format: 7,
    formationId: '7v7-2-3-1',
    periods: 2,
    periodLengthSeconds: 1_500,
    opponent: 'Grön IF',
  };
  const squad = {
    eventId: '00000000-0000-4000-8000-0000000000ff',
    matchId: MATCH_ID,
    v: MATCH_EVENT_VERSION,
    at: AT,
    by: 'owner',
    type: 'squad_set',
    players: PLAYERS,
  };
  const lineup = {
    eventId: '00000000-0000-4000-8000-000000000011',
    matchId: MATCH_ID,
    v: MATCH_EVENT_VERSION,
    at: AT,
    by: 'owner',
    type: 'lineup_set',
    assignments: [
      { slotId: 'gk', playerId: GINA },
      { slotId: 'cb-left', playerId: BO },
      { slotId: 'cb-right', playerId: CLEO },
      { slotId: 'lm', playerId: DANI },
      { slotId: 'cm', playerId: ELI },
      { slotId: 'rm', playerId: FATIMA },
      { slotId: 'st', playerId: GUS },
    ],
    bench: [ANNA],
  };
  const started = {
    eventId: '00000000-0000-4000-8000-0000000000bb',
    matchId: MATCH_ID,
    v: MATCH_EVENT_VERSION,
    at: AT,
    by: 'owner',
    type: 'period_started',
    periodNumber: 1,
  };

  it('behåller loggens ordning i stället för att lotta om den', () => {
    const state = deriveMatchState(
      [created, squad, lineup, started],
      new Date('2026-09-20T13:00:00.000Z'),
    );

    expect(state.ignored).toEqual([]);
    expect(Object.keys(state.currentSlots)).toHaveLength(7);
    expect(state.currentSlots['gk']).toBe(GINA);
    expect(state.bench).toEqual([ANNA]);
  });
});
