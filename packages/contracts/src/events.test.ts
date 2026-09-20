import { describe, expect, it } from 'vitest';
import {
  MATCH_EVENT_TYPES,
  MATCH_EVENT_VERSION,
  isKnownMatchEventType,
  matchEventSchema,
  matchEventSchemas,
  parseMatchEvent,
  parseMatchEventLog,
  safeParseMatchEvent,
  type MatchEvent,
} from './index.js';

const MATCH_ID = '11111111-1111-4111-8111-111111111111';
const COACH = 'coach:ulf';

/** Löpnummer så varje testhändelse får ett eget, giltigt UUID. */
let nextId = 0;
function id(): string {
  nextId += 1;
  return `00000000-0000-4000-8000-${String(nextId).padStart(12, '0')}`;
}

const ERLING = '22222222-2222-4222-8222-222222222222';
const LINNEA = '33333333-3333-4333-8333-333333333333';
const NOOR = '44444444-4444-4444-8444-444444444444';

/** Kuvertet, färdigt att sprida ut i en testhändelse. */
function envelope(at = '2026-09-20T13:00:00.000Z') {
  return { eventId: id(), matchId: MATCH_ID, v: MATCH_EVENT_VERSION, at, by: COACH } as const;
}

/** En giltig händelse per typ — underlaget för roundtrip och täckningskontroll. */
function oneOfEach(): MatchEvent[] {
  return [
    {
      ...envelope(),
      type: 'match_created',
      format: 7,
      formationId: '2-3-1',
      periods: 2,
      periodLengthSeconds: 1500,
      opponent: 'Bromma IF',
    },
    {
      ...envelope(),
      type: 'squad_set',
      players: [
        { playerId: ERLING, name: 'Erling', number: 1, isGoalkeeper: true },
        { playerId: LINNEA, name: 'Linnéa', number: 9, isGoalkeeper: false },
        { playerId: NOOR, name: 'Noor', number: 14, isGoalkeeper: false },
      ],
    },
    {
      ...envelope(),
      type: 'availability_changed',
      playerId: NOOR,
      available: false,
      from: '2026-09-20T13:05:00.000Z',
    },
    {
      ...envelope(),
      type: 'lineup_set',
      assignments: [
        { slotId: 'gk', playerId: ERLING },
        { slotId: 'st', playerId: LINNEA },
      ],
      bench: [NOOR],
    },
    { ...envelope(), type: 'period_started', periodNumber: 1 },
    { ...envelope(), type: 'period_ended', periodNumber: 1 },
    { ...envelope(), type: 'clock_paused', reason: 'skada' },
    { ...envelope(), type: 'clock_resumed' },
    {
      ...envelope(),
      type: 'substitution_planned',
      planId: '55555555-5555-4555-8555-555555555555',
      swaps: [{ slotId: 'st', outPlayerId: LINNEA, inPlayerId: NOOR }],
    },
    {
      ...envelope(),
      type: 'substitution_cancelled',
      planId: '55555555-5555-4555-8555-555555555555',
    },
    {
      ...envelope(),
      type: 'substitution_confirmed',
      swaps: [{ slotId: 'st', outPlayerId: LINNEA, inPlayerId: NOOR }],
    },
    { ...envelope(), type: 'player_moved', playerId: NOOR, fromSlotId: 'st', toSlotId: 'cm' },
    {
      ...envelope(),
      type: 'formation_changed',
      formationId: '3-2-1',
      assignments: [{ slotId: 'gk', playerId: ERLING }],
    },
    { ...envelope(), type: 'match_ended' },
    { ...envelope(), type: 'event_undone', targetEventId: id() },
    {
      ...envelope(),
      type: 'event_time_corrected',
      targetEventId: id(),
      correctedAt: '2026-09-20T13:02:30.000Z',
    },
  ];
}

describe('matchEventSchema', () => {
  it('täcker varje händelsetyp i unionen', () => {
    const covered = oneOfEach().map((event) => event.type);

    expect(new Set(covered)).toEqual(new Set(MATCH_EVENT_TYPES));
    expect(MATCH_EVENT_TYPES).toHaveLength(Object.keys(matchEventSchemas).length);
  });

  it('roundtrippar varje händelse genom JSON utan att tappa fält', () => {
    for (const event of oneOfEach()) {
      const roundtripped = parseMatchEvent(JSON.parse(JSON.stringify(event)));

      expect(roundtripped).toEqual(event);
    }
  });

  it('accepterar direktbyte utan planId', () => {
    const parsed = parseMatchEvent({
      ...envelope(),
      type: 'substitution_confirmed',
      swaps: [{ slotId: 'st', outPlayerId: LINNEA, inPlayerId: NOOR }],
    });

    expect(parsed.type).toBe('substitution_confirmed');
    expect('planId' in parsed && parsed.planId).toBeFalsy();
  });

  it('strippar okända fält i stället för att avvisa händelsen', () => {
    const parsed = parseMatchEvent({
      ...envelope(),
      type: 'period_started',
      periodNumber: 2,
      // Ett fält som en nyare klient hittat på.
      refereeName: 'Kim',
    });

    expect(parsed).not.toHaveProperty('refereeName');
  });

  it('smalnar av typen på diskriminatorn', () => {
    const parsed = parseMatchEvent({
      ...envelope(),
      type: 'period_started',
      periodNumber: 2,
    });

    if (parsed.type !== 'period_started') throw new Error('fel typ');

    // Kompilatorn ska ha smalnat av unionen här — `periodNumber` finns bara på
    // period_started/period_ended.
    const periodNumber: number = parsed.periodNumber;
    expect(periodNumber).toBe(2);
  });
});

describe('ogiltiga händelser', () => {
  it('avvisar ett eventId som inte är ett UUID, med läsbart fel', () => {
    const result = safeParseMatchEvent({
      ...envelope(),
      eventId: 'inte-ett-uuid',
      type: 'match_ended',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    const issue = result.error.issues.find((i) => i.path[0] === 'eventId');
    expect(issue).toBeDefined();
    expect(issue?.message).toMatch(/uuid/i);
  });

  it('avvisar en spelform som inte finns', () => {
    const result = safeParseMatchEvent({
      ...envelope(),
      type: 'match_created',
      format: 8,
      formationId: '2-3-1',
      periods: 2,
      periodLengthSeconds: 1500,
      opponent: 'Bromma IF',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((i) => i.path[0] === 'format')).toBe(true);
  });

  it('avvisar en tidsstämpel utan tidszon', () => {
    const result = safeParseMatchEvent({
      ...envelope('2026-09-20 13:00:00'),
      type: 'match_ended',
    });

    expect(result.success).toBe(false);
  });

  it('avvisar dubblerade spelare i truppen med en begriplig text', () => {
    const result = safeParseMatchEvent({
      ...envelope(),
      type: 'squad_set',
      players: [
        { playerId: ERLING, name: 'Erling', number: 1, isGoalkeeper: true },
        { playerId: ERLING, name: 'Erling igen', number: 2, isGoalkeeper: false },
      ],
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.message)).toContain('playerId måste vara unika');
  });

  it('avvisar två spelare på samma plats i uppställningen', () => {
    const result = safeParseMatchEvent({
      ...envelope(),
      type: 'lineup_set',
      assignments: [
        { slotId: 'gk', playerId: ERLING },
        { slotId: 'gk', playerId: LINNEA },
      ],
      bench: [],
    });

    expect(result.success).toBe(false);
  });

  it('avvisar ett positionsbyte till samma plats', () => {
    const result = safeParseMatchEvent({
      ...envelope(),
      type: 'player_moved',
      playerId: NOOR,
      fromSlotId: 'st',
      toSlotId: 'st',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.message)).toContain(
      'fromSlotId och toSlotId måste skilja sig åt',
    );
  });

  it('avvisar ett bekräftat byte utan swaps', () => {
    const result = safeParseMatchEvent({
      ...envelope(),
      type: 'substitution_confirmed',
      swaps: [],
    });

    expect(result.success).toBe(false);
  });

  it('kastar från parseMatchEvent', () => {
    expect(() => parseMatchEvent({ type: 'match_ended' })).toThrow();
  });
});

describe('parseMatchEventLog', () => {
  it('parsar en hel logg i ordning', () => {
    const log = oneOfEach();

    const { events, ignored } = parseMatchEventLog(JSON.parse(JSON.stringify(log)));

    expect(ignored).toEqual([]);
    expect(events).toEqual(log);
  });

  it('hoppar över okända händelsetyper utan att kasta', () => {
    const known = { ...envelope(), type: 'period_started', periodNumber: 1 };
    const future = { ...envelope(), type: 'weather_changed', condition: 'hagel' };

    const { events, ignored } = parseMatchEventLog([known, future]);

    expect(events).toEqual([known]);
    expect(ignored).toHaveLength(1);
    expect(ignored[0]?.reason).toBe('unknown_type');
    expect(ignored[0]?.index).toBe(1);
    expect(ignored[0]?.message).toContain('weather_changed');
    // Rådatan bevaras så att en nyare klient kan tolka den senare.
    expect(ignored[0]?.raw).toEqual(future);
    expect(ignored[0]?.envelope?.type).toBe('weather_changed');
  });

  it('hoppar över nyare schemaversioner av en känd typ', () => {
    const v2 = { ...envelope(), v: 2, type: 'period_started', periodNumber: 1 };

    const { events, ignored } = parseMatchEventLog([v2]);

    expect(events).toEqual([]);
    expect(ignored[0]?.reason).toBe('unsupported_version');
    expect(ignored[0]?.message).toContain('2');
  });

  it('redovisar trasig data som invalid i stället för att kasta', () => {
    const broken = { ...envelope(), type: 'period_started', periodNumber: 'första' };

    const { events, ignored } = parseMatchEventLog([broken]);

    expect(events).toEqual([]);
    expect(ignored[0]?.reason).toBe('invalid');
    expect(ignored[0]?.message).toMatch(/periodNumber/);
  });

  it('redovisar en post utan giltigt kuvert som invalid', () => {
    const { events, ignored } = parseMatchEventLog([null, 'nej', { type: 'period_started' }]);

    expect(events).toEqual([]);
    expect(ignored.map((i) => i.reason)).toEqual(['invalid', 'invalid', 'invalid']);
    expect(ignored.every((i) => i.envelope === undefined)).toBe(true);
  });

  it('ger ett läsbart fel när loggen inte ens är en lista', () => {
    const { events, ignored } = parseMatchEventLog({ events: [] });

    expect(events).toEqual([]);
    expect(ignored[0]?.message).toBe('matchloggen måste vara en lista');
  });

  it('släpper igenom kända händelser mellan okända', () => {
    const first = { ...envelope(), type: 'period_started', periodNumber: 1 };
    const last = { ...envelope(), type: 'period_ended', periodNumber: 1 };

    const { events, ignored } = parseMatchEventLog([
      first,
      { ...envelope(), type: 'var_review_started' },
      last,
    ]);

    expect(events.map((e) => e.type)).toEqual(['period_started', 'period_ended']);
    expect(ignored).toHaveLength(1);
  });
});

describe('isKnownMatchEventType', () => {
  it('känner igen varje typ i unionen', () => {
    for (const type of MATCH_EVENT_TYPES) {
      expect(isKnownMatchEventType(type)).toBe(true);
    }
  });

  it('säger nej till okända typer och till nedärvda nycklar', () => {
    expect(isKnownMatchEventType('weather_changed')).toBe(false);
    expect(isKnownMatchEventType('toString')).toBe(false);
    expect(isKnownMatchEventType('constructor')).toBe(false);
  });
});

describe('schemaversion', () => {
  it('är 1 och krävs på varje händelse', () => {
    expect(MATCH_EVENT_VERSION).toBe(1);

    const utanVersion: Record<string, unknown> = { ...envelope(), type: 'match_ended' };
    delete utanVersion['v'];

    expect(matchEventSchema.safeParse(utanVersion).success).toBe(false);
  });
});
