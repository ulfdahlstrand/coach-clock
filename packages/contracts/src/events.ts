import { z } from 'zod';

/**
 * Händelseschema v1 för matchloggen.
 *
 * En match är en append-only logg av händelser. Speltid och positionshistorik
 * lagras aldrig som ackumulerade sekunder — de härleds genom att vika loggen
 * (se #8/#9). Ingenting raderas: en felaktig händelse neutraliseras med en
 * gravsten (`event_undone`) och en feltajmad med `event_time_corrected`.
 *
 * Alla händelser bär samma kuvert: `{ eventId, matchId, v, at, by }`.
 * Nyttolasten ligger platt bredvid kuvertet och unionen diskrimineras på `type`.
 *
 * Objekten strippar okända nycklar i stället för att avvisa dem. En nyare
 * klient som lägger till ett fält ska inte få sina händelser underkända av en
 * äldre — bakåtkompatibiliteten bärs av `v`, inte av strikta objekt.
 */

/** Schemaversionen som den här modulen känner till. */
export const MATCH_EVENT_VERSION = 1;

/** Klientgenererat UUID. Idempotensnyckeln för en händelse. */
const eventId = z.uuid();

/** Identiteter. UUID överallt — allt skapas på klienten, ofta offline. */
const matchId = z.uuid();
const playerId = z.uuid();
const planId = z.uuid();

/**
 * Tidsstämpel i serverns tidsdomän: ISO 8601 i UTC (`...Z`). Klientens egen
 * klocka får aldrig bli sanning — den driver mellan telefoner och byten får
 * inte hoppa i tiden för att någon råkat ställa om.
 */
const timestamp = z.iso.datetime();

/** Den som utförde handlingen (tränare/enhet). Fri text tills auth landar. */
const actor = z.string().min(1).max(200);

/** En plats i formationen, t.ex. `lb` eller `cm-left`. Katalogen kommer i #10. */
const slotId = z.string().min(1).max(64);

/** Referens till en formation i katalogen (#10). Här bara en sträng. */
const formationId = z.string().min(1).max(64);

/** Spelform: antal spelare per lag. */
export const matchFormatSchema = z.union([z.literal(5), z.literal(7), z.literal(9), z.literal(11)]);

/** En spelare i truppen. */
export const squadPlayerSchema = z.object({
  playerId,
  name: z.string().min(1).max(120),
  number: z.int().min(0).max(999),
  isGoalkeeper: z.boolean(),
});

/** Kopplingen mellan en plats i formationen och spelaren som står där. */
export const slotAssignmentSchema = z.object({
  slotId,
  playerId,
});

/** Ett byte: spelaren på `slotId` går av, `inPlayerId` går in. */
export const substitutionSwapSchema = z.object({
  slotId,
  outPlayerId: playerId,
  inPlayerId: playerId,
});

/** Hjälpare: en lista där ett utpekat fält måste vara unikt. */
function unique<T>(select: (item: T) => string, label: string) {
  return {
    check: (items: readonly T[]) => new Set(items.map(select)).size === items.length,
    message: `${label} måste vara unika`,
  };
}

const uniquePlayers = unique<z.infer<typeof squadPlayerSchema>>((p) => p.playerId, 'playerId');
const uniqueSlots = unique<z.infer<typeof slotAssignmentSchema>>((a) => a.slotId, 'slotId');
const uniqueAssignedPlayers = unique<z.infer<typeof slotAssignmentSchema>>(
  (a) => a.playerId,
  'playerId i assignments',
);
const uniqueSwapSlots = unique<z.infer<typeof substitutionSwapSchema>>((s) => s.slotId, 'slotId');

const assignmentsSchema = z
  .array(slotAssignmentSchema)
  .refine(uniqueSlots.check, { message: uniqueSlots.message })
  .refine(uniqueAssignedPlayers.check, { message: uniqueAssignedPlayers.message });

const swapsSchema = z
  .array(substitutionSwapSchema)
  .min(1, { message: 'swaps måste innehålla minst ett byte' })
  .refine(uniqueSwapSlots.check, { message: uniqueSwapSlots.message });

/** Kuvertet som varje händelse bär. */
const envelope = {
  eventId,
  matchId,
  v: z.literal(MATCH_EVENT_VERSION),
  at: timestamp,
  by: actor,
};

/** Bygger ett händelseschema: kuvert + diskriminator + nyttolast. */
function event<T extends string, P extends z.ZodRawShape>(type: T, payload: P) {
  return z.object({ ...envelope, type: z.literal(type), ...payload });
}

/** Förvald bytestid: så länge en utespelare spelar innan hon föreslås ut. */
export const DEFAULT_IDEAL_SHIFT_SECONDS = 240;

/** Matchen skapas: spelform, startformation, periodupplägg och motståndare. */
export const matchCreatedSchema = event('match_created', {
  format: matchFormatSchema,
  formationId,
  periods: z.int().min(1).max(10),
  periodLengthSeconds: z.int().min(1).max(7200),
  opponent: z.string().min(1).max(200),
  /**
   * Önskad bytestid (#82). Valfri, så att matcher skapade innan fältet fanns
   * fortfarande går att läsa — de får DEFAULT_IDEAL_SHIFT_SECONDS.
   */
  idealShiftSeconds: z.int().min(60).max(1200).optional(),
});

/** Truppen sätts (eller sätts om innan avspark). */
export const squadSetSchema = event('squad_set', {
  players: z
    .array(squadPlayerSchema)
    .refine(uniquePlayers.check, { message: uniquePlayers.message }),
});

/**
 * Tillgänglighet ändras — sen ankomst eller skada. `from` är tidpunkten
 * ändringen gäller från, vilket kan skilja sig från när den registrerades (`at`):
 * spelaren kom kvart över, tränaren hann knappa in det först i halvlek.
 */
export const availabilityChangedSchema = event('availability_changed', {
  playerId,
  available: z.boolean(),
  from: timestamp,
});

/** Startelvan (eller startfemman) ställs upp. */
export const lineupSetSchema = event('lineup_set', {
  assignments: assignmentsSchema,
  bench: z.array(playerId),
});

/** Perioden startar — klockan börjar ticka. */
export const periodStartedSchema = event('period_started', {
  periodNumber: z.int().min(1).max(10),
});

/** Perioden blåses av. */
export const periodEndedSchema = event('period_ended', {
  periodNumber: z.int().min(1).max(10),
});

/** Klockan stoppas (skada, domarens paus). Speltid ackumuleras inte under paus. */
export const clockPausedSchema = event('clock_paused', {
  reason: z.string().min(1).max(200).optional(),
});

/** Klockan startas igen. */
export const clockResumedSchema = event('clock_resumed', {
  reason: z.string().min(1).max(200).optional(),
});

/** Ett byte planeras men är inte genomfört — det syns i appen, inte på planen. */
export const substitutionPlannedSchema = event('substitution_planned', {
  planId,
  swaps: swapsSchema,
});

/** Planen rivs innan den genomförts. */
export const substitutionCancelledSchema = event('substitution_cancelled', {
  planId,
});

/**
 * Bytet är genomfört. `planId` utelämnas vid direktbyte — tränaren vinkar in
 * någon utan att ha planerat det först.
 */
export const substitutionConfirmedSchema = event('substitution_confirmed', {
  planId: planId.optional(),
  swaps: swapsSchema,
});

/** Positionsbyte utan spelarbyte: samma elva, ny plats. */
export const playerMovedSchema = event('player_moved', {
  playerId,
  fromSlotId: slotId,
  toSlotId: slotId,
}).refine((e) => e.fromSlotId !== e.toSlotId, {
  message: 'fromSlotId och toSlotId måste skilja sig åt',
  path: ['toSlotId'],
});

/** Formationen läggs om, med den nya uppställningen i samma händelse. */
export const formationChangedSchema = event('formation_changed', {
  formationId,
  assignments: assignmentsSchema,
});

/** Matchen är slut. */
export const matchEndedSchema = event('match_ended', {});

/**
 * Gravsten: händelsen `targetEventId` ska inte räknas när loggen viks.
 * Ingenting raderas — ångra är en händelse som alla andra.
 */
export const eventUndoneSchema = event('event_undone', {
  targetEventId: eventId,
});

/**
 * Rättar tidpunkten för en tidigare händelse. Fältet heter `correctedAt` och
 * inte `at` eftersom `at` redan är kuvertets egen tid: när rättelsen gjordes.
 */
export const eventTimeCorrectedSchema = event('event_time_corrected', {
  targetEventId: eventId,
  correctedAt: timestamp,
});

/** Alla händelsescheman, uppslagsbara på sin typ. */
export const matchEventSchemas = {
  match_created: matchCreatedSchema,
  squad_set: squadSetSchema,
  availability_changed: availabilityChangedSchema,
  lineup_set: lineupSetSchema,
  period_started: periodStartedSchema,
  period_ended: periodEndedSchema,
  clock_paused: clockPausedSchema,
  clock_resumed: clockResumedSchema,
  substitution_planned: substitutionPlannedSchema,
  substitution_cancelled: substitutionCancelledSchema,
  substitution_confirmed: substitutionConfirmedSchema,
  player_moved: playerMovedSchema,
  formation_changed: formationChangedSchema,
  match_ended: matchEndedSchema,
  event_undone: eventUndoneSchema,
  event_time_corrected: eventTimeCorrectedSchema,
} as const;

/** Händelsetyperna den här versionen känner till. */
export const MATCH_EVENT_TYPES = Object.keys(matchEventSchemas) as readonly MatchEventType[];

/** Unionen av alla kända händelser. */
export const matchEventSchema = z.discriminatedUnion('type', [
  matchCreatedSchema,
  squadSetSchema,
  availabilityChangedSchema,
  lineupSetSchema,
  periodStartedSchema,
  periodEndedSchema,
  clockPausedSchema,
  clockResumedSchema,
  substitutionPlannedSchema,
  substitutionCancelledSchema,
  substitutionConfirmedSchema,
  playerMovedSchema,
  formationChangedSchema,
  matchEndedSchema,
  eventUndoneSchema,
  eventTimeCorrectedSchema,
]);

export type MatchFormat = z.infer<typeof matchFormatSchema>;
export type SquadPlayer = z.infer<typeof squadPlayerSchema>;
export type SlotAssignment = z.infer<typeof slotAssignmentSchema>;
export type SubstitutionSwap = z.infer<typeof substitutionSwapSchema>;

export type MatchCreatedEvent = z.infer<typeof matchCreatedSchema>;
export type SquadSetEvent = z.infer<typeof squadSetSchema>;
export type AvailabilityChangedEvent = z.infer<typeof availabilityChangedSchema>;
export type LineupSetEvent = z.infer<typeof lineupSetSchema>;
export type PeriodStartedEvent = z.infer<typeof periodStartedSchema>;
export type PeriodEndedEvent = z.infer<typeof periodEndedSchema>;
export type ClockPausedEvent = z.infer<typeof clockPausedSchema>;
export type ClockResumedEvent = z.infer<typeof clockResumedSchema>;
export type SubstitutionPlannedEvent = z.infer<typeof substitutionPlannedSchema>;
export type SubstitutionCancelledEvent = z.infer<typeof substitutionCancelledSchema>;
export type SubstitutionConfirmedEvent = z.infer<typeof substitutionConfirmedSchema>;
export type PlayerMovedEvent = z.infer<typeof playerMovedSchema>;
export type FormationChangedEvent = z.infer<typeof formationChangedSchema>;
export type MatchEndedEvent = z.infer<typeof matchEndedSchema>;
export type EventUndoneEvent = z.infer<typeof eventUndoneSchema>;
export type EventTimeCorrectedEvent = z.infer<typeof eventTimeCorrectedSchema>;

/** En känd händelse i matchloggen. */
export type MatchEvent = z.infer<typeof matchEventSchema>;

/** Diskriminatorn. */
export type MatchEventType = keyof typeof matchEventSchemas;

/** Kuvertet utan nyttolast — det enda vi kan lita på hos en okänd händelse. */
export const matchEventEnvelopeSchema = z.object({
  eventId,
  matchId,
  v: z.int().min(1),
  at: timestamp,
  by: actor,
  type: z.string().min(1),
});

export type MatchEventEnvelope = z.infer<typeof matchEventEnvelopeSchema>;

/** Varför en post i loggen hoppades över. */
export type IgnoredReason =
  /** Kuvertet håller, men `v` är nyare än vad den här klienten kan tolka. */
  | 'unsupported_version'
  /** Kuvertet håller, men `type` är okänd här — en nyare klient skrev den. */
  | 'unknown_type'
  /** Känd typ, men nyttolasten håller inte. Trasig data, inte ny data. */
  | 'invalid';

/** En post som inte blev en känd händelse. Ingenting kastas, allt redovisas. */
export type IgnoredMatchEvent = {
  /** Postens plats i indatalistan, så anroparen kan peka ut den. */
  readonly index: number;
  readonly reason: IgnoredReason;
  /** Kuvertet om det gick att läsa, annars `undefined`. */
  readonly envelope?: MatchEventEnvelope;
  /** Läsbar förklaring, redan formaterad av Zod. */
  readonly message: string;
  /** Rådatan oförändrad, så den kan loggas eller spelas upp senare. */
  readonly raw: unknown;
};

/** Resultatet av att läsa en hel logg. */
export type ParsedMatchEventLog = {
  /** De händelser den här klienten förstår, i indatans ordning. */
  readonly events: readonly MatchEvent[];
  /** De som hoppades över, med anledning. */
  readonly ignored: readonly IgnoredMatchEvent[];
};

/** Parsar en enskild händelse och kastar vid fel. För egen, färsk data. */
export function parseMatchEvent(input: unknown): MatchEvent {
  return matchEventSchema.parse(input);
}

/** Som `parseMatchEvent` men returnerar ett resultat i stället för att kasta. */
export function safeParseMatchEvent(input: unknown) {
  return matchEventSchema.safeParse(input);
}

/** Är `type` en händelsetyp den här versionen känner till? */
export function isKnownMatchEventType(type: string): type is MatchEventType {
  return Object.hasOwn(matchEventSchemas, type);
}

function ignore(
  index: number,
  reason: IgnoredReason,
  message: string,
  raw: unknown,
  envelope?: MatchEventEnvelope,
): IgnoredMatchEvent {
  return envelope === undefined
    ? { index, reason, message, raw }
    : { index, reason, message, raw, envelope };
}

/**
 * Läser en hel matchlogg utan att kasta.
 *
 * Poängen: en klient som inte uppdaterats ska kunna visa en match som en nyare
 * klient skrivit. Okända typer och nyare `v` hoppas över och redovisas i
 * `ignored` — de får aldrig ta ner appen mitt i en match. Trasig data hamnar
 * också där, med Zods läsbara felmeddelande, så att den går att felsöka.
 */
export function parseMatchEventLog(input: unknown): ParsedMatchEventLog {
  if (!Array.isArray(input)) {
    return {
      events: [],
      ignored: [ignore(0, 'invalid', 'matchloggen måste vara en lista', input)],
    };
  }

  const events: MatchEvent[] = [];
  const ignored: IgnoredMatchEvent[] = [];

  input.forEach((raw, index) => {
    const envelope = matchEventEnvelopeSchema.safeParse(raw);
    if (!envelope.success) {
      ignored.push(ignore(index, 'invalid', z.prettifyError(envelope.error), raw));
      return;
    }

    if (envelope.data.v !== MATCH_EVENT_VERSION) {
      ignored.push(
        ignore(
          index,
          'unsupported_version',
          `okänd schemaversion ${envelope.data.v}, den här klienten läser v${MATCH_EVENT_VERSION}`,
          raw,
          envelope.data,
        ),
      );
      return;
    }

    if (!isKnownMatchEventType(envelope.data.type)) {
      ignored.push(
        ignore(
          index,
          'unknown_type',
          `okänd händelsetyp "${envelope.data.type}"`,
          raw,
          envelope.data,
        ),
      );
      return;
    }

    const parsed = matchEventSchema.safeParse(raw);
    if (!parsed.success) {
      ignored.push(ignore(index, 'invalid', z.prettifyError(parsed.error), raw, envelope.data));
      return;
    }

    events.push(parsed.data);
  });

  return { events, ignored };
}
