import {
  parseMatchEventLog,
  type IgnoredMatchEvent,
  type MatchEvent,
  type SquadPlayer,
  type SubstitutionSwap,
} from './events.js';
import { matchClock, type MatchClock, type MatchClockSegment } from './match-clock.js';

export type MatchPlayerRole = 'goalkeeper' | 'defender' | 'midfielder' | 'forward' | 'unknown';

export type DerivedPlayerState = {
  readonly playerId: string;
  readonly name: string;
  readonly number: number | null;
  readonly isGoalkeeper: boolean;
  readonly available: boolean;
  readonly playedMs: number;
  readonly timeBySlotId: Readonly<Record<string, number>>;
  readonly timeByRole: Readonly<Partial<Record<MatchPlayerRole, number>>>;
  readonly currentSlotId: string | null;
};

export type PlannedSubstitution = {
  readonly planId: string;
  readonly swaps: readonly SubstitutionSwap[];
  readonly plannedBy: string;
  readonly plannedAt: string;
};

export type MatchStateIgnoredReason =
  | 'invalid'
  | 'unsupported_version'
  | 'unknown_type'
  | 'duplicate_event'
  | 'undone'
  | 'future'
  | 'invalid_reference'
  | 'invalid_transition';

export type MatchStateIgnoredEvent = {
  readonly index: number;
  readonly eventId?: string;
  readonly type?: string;
  readonly reason: MatchStateIgnoredReason;
  readonly message: string;
  readonly raw: unknown;
};

export type DerivedMatchState = {
  readonly matchId: string | null;
  readonly formationId: string | null;
  readonly ended: boolean;
  readonly clock: MatchClock;
  readonly players: Readonly<Record<string, DerivedPlayerState>>;
  /** `slotId -> playerId`. */
  readonly currentSlots: Readonly<Record<string, string>>;
  readonly bench: readonly string[];
  readonly plannedSubstitutions: readonly PlannedSubstitution[];
  readonly ignored: readonly MatchStateIgnoredEvent[];
};

type IndexedEvent = {
  readonly event: MatchEvent;
  readonly index: number;
  readonly raw: unknown;
};

type TimedEvent = IndexedEvent & {
  readonly atMs: number;
};

type MutablePlayer = {
  playerId: string;
  name: string;
  number: number | null;
  isGoalkeeper: boolean;
  available: boolean;
  playedMs: number;
  timeBySlotId: Record<string, number>;
  timeByRole: Partial<Record<MatchPlayerRole, number>>;
};

const EMPTY_CLOCK: MatchClock = {
  periodNumber: null,
  running: false,
  elapsedMs: 0,
  periodElapsedMs: 0,
  segments: [],
};

function emptyState(ignored: readonly MatchStateIgnoredEvent[] = []): DerivedMatchState {
  return {
    matchId: null,
    formationId: null,
    ended: false,
    clock: EMPTY_CLOCK,
    players: {},
    currentSlots: {},
    bench: [],
    plannedSubstitutions: [],
    ignored,
  };
}

function parsedIgnored(event: IgnoredMatchEvent, index: number): MatchStateIgnoredEvent {
  const base = {
    index,
    reason: event.reason,
    message: event.message,
    raw: event.raw,
  } as const;

  return event.envelope === undefined
    ? base
    : { ...base, eventId: event.envelope.eventId, type: event.envelope.type };
}

function parseIndexed(input: unknown): {
  entries: IndexedEvent[];
  ignored: MatchStateIgnoredEvent[];
} {
  if (!Array.isArray(input)) {
    const parsed = parseMatchEventLog(input);
    return { entries: [], ignored: parsed.ignored.map((item) => parsedIgnored(item, item.index)) };
  }

  const entries: IndexedEvent[] = [];
  const ignored: MatchStateIgnoredEvent[] = [];

  input.forEach((raw, index) => {
    const parsed = parseMatchEventLog([raw]);
    const event = parsed.events[0];

    if (event !== undefined) entries.push({ event, index, raw });
    for (const item of parsed.ignored) ignored.push(parsedIgnored(item, index));
  });

  return { entries, ignored };
}

function eventIgnored(
  entry: IndexedEvent,
  reason: MatchStateIgnoredReason,
  message: string,
): MatchStateIgnoredEvent {
  return {
    index: entry.index,
    eventId: entry.event.eventId,
    type: entry.event.type,
    reason,
    message,
    raw: entry.raw,
  };
}

/*
 * Lika tidsstämplar avgörs av loggens ordning, inte av eventId. Backenden
 * skriver matchens fyra skapelsehändelser i en och samma transaktion med ett
 * gemensamt `now`, så tiden skiljer dem inte åt — men `squad_set` måste ändå
 * läsas före `lineup_set`. Ett slumpat uuid som likabrytare kastade om dem i
 * ungefär varannan match, och då förkastades hela uppställningen eftersom
 * ingen spelare fanns i truppen ännu (#79). Determinismen mellan enheter
 * behålls: alla klienter läser samma logg i serverns ordning.
 */
function sortTimed(left: TimedEvent, right: TimedEvent): number {
  return left.atMs - right.atMs || left.index - right.index;
}

function playerRole(slotId: string): MatchPlayerRole {
  const base = slotId.split('-')[0] ?? slotId;
  if (base === 'gk') return 'goalkeeper';
  if (base === 'lb' || base === 'cb' || base === 'rb') return 'defender';
  if (base === 'lm' || base === 'cm' || base === 'rm' || base === 'dm' || base === 'am') {
    return 'midfielder';
  }
  if (base === 'lw' || base === 'st' || base === 'rw' || base === 'fw') return 'forward';
  return 'unknown';
}

function segmentOverlap(segment: MatchClockSegment, fromMs: number, toMs: number): number {
  const start = Math.max(Date.parse(segment.startedAt), fromMs);
  const end = Math.min(Date.parse(segment.endedAt), toMs);
  return Math.max(0, end - start);
}

function elapsedBetween(
  segments: readonly MatchClockSegment[],
  fromMs: number,
  toMs: number,
): number {
  if (toMs <= fromMs) return 0;
  return segments.reduce((sum, segment) => sum + segmentOverlap(segment, fromMs, toMs), 0);
}

function elapsedAt(segments: readonly MatchClockSegment[], atMs: number): number {
  return segments.reduce((sum, segment) => {
    const startedAt = Date.parse(segment.startedAt);
    return sum + segmentOverlap(segment, startedAt, atMs);
  }, 0);
}

function matchMinute(elapsedMs: number): string {
  const wholeSeconds = Math.floor(elapsedMs / 1_000);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function sameSwaps(left: readonly SubstitutionSwap[], right: readonly SubstitutionSwap[]): boolean {
  return (
    left.length === right.length &&
    left.every((swap, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        swap.slotId === other.slotId &&
        swap.outPlayerId === other.outPlayerId &&
        swap.inPlayerId === other.inPlayerId
      );
    })
  );
}

function validClockEvents(
  events: readonly TimedEvent[],
  ignored: MatchStateIgnoredEvent[],
): Set<string> {
  const accepted = new Set<string>();
  let periodNumber: number | null = null;
  let periodActive = false;
  let running = false;

  for (const entry of events) {
    const event = entry.event;
    let message: string | null = null;

    switch (event.type) {
      case 'period_started':
        if (periodActive) message = `period ${String(periodNumber)} pågår redan`;
        else {
          periodNumber = event.periodNumber;
          periodActive = true;
          running = true;
        }
        break;
      case 'clock_paused':
        if (!periodActive) message = 'klockan kan inte pausas före periodstart';
        else if (!running) message = 'klockan är redan pausad';
        else running = false;
        break;
      case 'clock_resumed':
        if (!periodActive) message = 'klockan kan inte återupptas före periodstart';
        else if (running) message = 'klockan går redan';
        else running = true;
        break;
      case 'period_ended':
        if (!periodActive || periodNumber !== event.periodNumber) {
          message = `period ${String(event.periodNumber)} kan inte avslutas nu`;
        } else {
          periodActive = false;
          running = false;
        }
        break;
      default:
        continue;
    }

    if (message === null) accepted.add(event.eventId);
    else ignored.push(eventIgnored(entry, 'invalid_transition', message));
  }

  return accepted;
}

function playerFromSquad(player: SquadPlayer): MutablePlayer {
  return {
    playerId: player.playerId,
    name: player.name,
    number: player.number,
    isGoalkeeper: player.isGoalkeeper,
    available: true,
    playedMs: 0,
    timeBySlotId: {},
    timeByRole: {},
  };
}

function deriveMatchStateInternal(input: unknown, now: Date): DerivedMatchState {
  const parsed = parseIndexed(input);
  const ignored = [...parsed.ignored];
  const nowMs = now.getTime();

  if (!Number.isFinite(nowMs)) {
    ignored.push({
      index: -1,
      reason: 'invalid',
      message: 'now måste vara ett giltigt datum',
      raw: now,
    });
    return emptyState(ignored);
  }

  const unique: IndexedEvent[] = [];
  const byId = new Map<string, IndexedEvent>();
  let matchId: string | null = null;

  for (const entry of parsed.entries) {
    if (byId.has(entry.event.eventId)) {
      ignored.push(eventIgnored(entry, 'duplicate_event', 'eventId förekommer redan i loggen'));
      continue;
    }
    if (matchId !== null && entry.event.matchId !== matchId) {
      ignored.push(
        eventIgnored(entry, 'invalid_reference', `händelsen tillhör en annan match än ${matchId}`),
      );
      continue;
    }

    matchId ??= entry.event.matchId;
    unique.push(entry);
    byId.set(entry.event.eventId, entry);
  }

  // Gravstenar behandlas bakifrån. Om en senare gravsten pekar på en tidigare
  // gravsten blir den tidigare inaktiv och dess mål återställs.
  const inactive = new Set<string>();
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const entry = unique[index];
    if (entry === undefined || entry.event.type !== 'event_undone') continue;
    if (Date.parse(entry.event.at) > nowMs || inactive.has(entry.event.eventId)) continue;

    const target = byId.get(entry.event.targetEventId);
    if (target === undefined || target.event.eventId === entry.event.eventId) {
      ignored.push(
        eventIgnored(entry, 'invalid_reference', 'händelsen som skulle ångras finns inte'),
      );
      continue;
    }
    inactive.add(target.event.eventId);
  }

  for (const entry of unique) {
    if (inactive.has(entry.event.eventId)) {
      ignored.push(eventIgnored(entry, 'undone', 'händelsen har ångrats'));
    }
  }

  const corrections = new Map<string, string>();
  for (const entry of unique) {
    if (entry.event.type !== 'event_time_corrected' || inactive.has(entry.event.eventId)) continue;
    if (Date.parse(entry.event.at) > nowMs) continue;

    const target = byId.get(entry.event.targetEventId);
    if (target === undefined || inactive.has(target.event.eventId)) {
      ignored.push(
        eventIgnored(entry, 'invalid_reference', 'händelsen som skulle tidskorrigeras finns inte'),
      );
      continue;
    }
    corrections.set(entry.event.targetEventId, entry.event.correctedAt);
  }

  const timed: TimedEvent[] = [];
  for (const entry of unique) {
    if (inactive.has(entry.event.eventId)) continue;
    if (entry.event.type === 'event_undone' || entry.event.type === 'event_time_corrected') {
      if (Date.parse(entry.event.at) > nowMs) {
        ignored.push(eventIgnored(entry, 'future', 'händelsen ligger efter now'));
      }
      continue;
    }

    const at = corrections.get(entry.event.eventId) ?? entry.event.at;
    const atMs = Date.parse(at);
    if (atMs > nowMs) {
      ignored.push(eventIgnored(entry, 'future', 'händelsen ligger efter now'));
      continue;
    }
    timed.push({ ...entry, event: { ...entry.event, at }, atMs });
  }
  timed.sort(sortTimed);

  const acceptedClockIds = validClockEvents(timed, ignored);
  const effective = timed.filter((entry) => {
    const type = entry.event.type;
    return (
      (type !== 'period_started' &&
        type !== 'period_ended' &&
        type !== 'clock_paused' &&
        type !== 'clock_resumed') ||
      acceptedClockIds.has(entry.event.eventId)
    );
  });
  const clock = matchClock(
    effective.map((entry) => entry.event),
    now,
  );

  const players = new Map<string, MutablePlayer>();
  const slots = new Map<string, string>();
  const bench = new Set<string>();
  const plans = new Map<string, PlannedSubstitution>();
  const substitutedInAt = new Map<string, number>();
  let formationId: string | null = null;
  let ended = false;
  let lineupWasSet = false;
  let cursorMs = effective[0]?.atMs ?? nowMs;

  const name = (playerId: string) => players.get(playerId)?.name ?? playerId;
  const addTime = (fromMs: number, toMs: number) => {
    const duration = elapsedBetween(clock.segments, fromMs, toMs);
    if (slots.size === 0 || duration === 0) return;

    for (const [slotId, playerId] of slots) {
      const player = players.get(playerId);
      if (player === undefined) continue;
      const role = playerRole(slotId);
      player.playedMs += duration;
      player.timeBySlotId[slotId] = (player.timeBySlotId[slotId] ?? 0) + duration;
      player.timeByRole[role] = (player.timeByRole[role] ?? 0) + duration;
    }
  };
  const ignoreTransition = (entry: TimedEvent, message: string) => {
    ignored.push(eventIgnored(entry, 'invalid_transition', message));
  };
  const knownPlayer = (playerId: string) => players.has(playerId);

  for (const entry of effective) {
    addTime(cursorMs, entry.atMs);
    cursorMs = entry.atMs;
    const event = entry.event;

    switch (event.type) {
      case 'match_created':
        if (formationId !== null) ignoreTransition(entry, 'matchen har redan skapats');
        else formationId = event.formationId;
        break;

      case 'squad_set':
        for (const squadPlayer of event.players) {
          const current = players.get(squadPlayer.playerId);
          if (current === undefined)
            players.set(squadPlayer.playerId, playerFromSquad(squadPlayer));
          else {
            current.name = squadPlayer.name;
            current.number = squadPlayer.number;
            current.isGoalkeeper = squadPlayer.isGoalkeeper;
          }
        }
        break;

      case 'availability_changed': {
        const player = players.get(event.playerId);
        if (player === undefined) {
          ignoreTransition(entry, `spelaren ${event.playerId} finns inte i truppen`);
        } else if (Date.parse(event.from) <= nowMs) {
          player.available = event.available;
        }
        break;
      }

      case 'lineup_set': {
        const unknown = [...event.assignments.map((item) => item.playerId), ...event.bench].find(
          (playerId) => !knownPlayer(playerId),
        );
        const onField = new Set(event.assignments.map((item) => item.playerId));
        const duplicateBench = new Set(event.bench).size !== event.bench.length;
        const overlap = event.bench.find((playerId) => onField.has(playerId));

        if (lineupWasSet) ignoreTransition(entry, 'startuppställningen har redan satts');
        else if (unknown !== undefined) ignoreTransition(entry, `${unknown} finns inte i truppen`);
        else if (duplicateBench)
          ignoreTransition(entry, 'bänken innehåller samma spelare flera gånger');
        else if (overlap !== undefined) {
          ignoreTransition(entry, `${name(overlap)} kan inte vara både på planen och på bänken`);
        } else {
          slots.clear();
          bench.clear();
          for (const assignment of event.assignments) {
            slots.set(assignment.slotId, assignment.playerId);
          }
          for (const playerId of event.bench) bench.add(playerId);
          lineupWasSet = true;
        }
        break;
      }

      case 'formation_changed': {
        const currentPlayers = [...slots.values()].sort();
        const nextPlayers = event.assignments.map((item) => item.playerId).sort();
        const samePlayers =
          currentPlayers.length === nextPlayers.length &&
          currentPlayers.every((playerId, index) => playerId === nextPlayers[index]);

        if (!samePlayers) {
          ignoreTransition(entry, 'en formationsändring måste behålla samma spelare på planen');
        } else {
          formationId = event.formationId;
          slots.clear();
          for (const assignment of event.assignments) {
            slots.set(assignment.slotId, assignment.playerId);
          }
        }
        break;
      }

      case 'player_moved': {
        if (slots.get(event.fromSlotId) !== event.playerId) {
          ignoreTransition(entry, `${name(event.playerId)} spelar inte på ${event.fromSlotId}`);
          break;
        }
        const displaced = slots.get(event.toSlotId);
        slots.set(event.toSlotId, event.playerId);
        if (displaced === undefined) slots.delete(event.fromSlotId);
        else slots.set(event.fromSlotId, displaced);
        break;
      }

      case 'substitution_planned': {
        if (plans.has(event.planId)) {
          ignoreTransition(entry, `bytesplanen ${event.planId} finns redan`);
          break;
        }
        const incoming = event.swaps.map((swap) => swap.inPlayerId);
        const invalidSwap = event.swaps.find(
          (swap) =>
            slots.get(swap.slotId) !== swap.outPlayerId ||
            [...slots.values()].includes(swap.inPlayerId) ||
            !knownPlayer(swap.inPlayerId),
        );
        if (new Set(incoming).size !== incoming.length) {
          ignoreTransition(entry, 'samma spelare kan inte planeras in på flera platser');
          break;
        }
        if (invalidSwap !== undefined) {
          ignoreTransition(entry, 'bytesplanen stämmer inte med spelarna på planen');
          break;
        }
        plans.set(event.planId, {
          planId: event.planId,
          swaps: event.swaps,
          plannedBy: event.by,
          plannedAt: event.at,
        });
        break;
      }

      case 'substitution_cancelled':
        if (!plans.delete(event.planId)) {
          ignoreTransition(entry, `bytesplanen ${event.planId} finns inte`);
        }
        break;

      case 'substitution_confirmed': {
        const plan = event.planId === undefined ? undefined : plans.get(event.planId);
        if (event.planId !== undefined && plan === undefined) {
          ignoreTransition(entry, `bytesplanen ${event.planId} finns inte`);
          break;
        }
        if (plan !== undefined && !sameSwaps(plan.swaps, event.swaps)) {
          ignoreTransition(entry, 'det bekräftade bytet stämmer inte med bytesplanen');
          break;
        }

        const onField = new Set(slots.values());
        const incoming = new Set<string>();
        let error: string | null = null;
        for (const swap of event.swaps) {
          if (slots.get(swap.slotId) !== swap.outPlayerId) {
            error = `${name(swap.outPlayerId)} spelar inte på ${swap.slotId}`;
            break;
          }
          if (!knownPlayer(swap.inPlayerId)) {
            error = `${swap.inPlayerId} finns inte i truppen`;
            break;
          }
          if (onField.has(swap.inPlayerId)) {
            const previous = substitutedInAt.get(swap.inPlayerId);
            error =
              previous === undefined
                ? `${name(swap.inPlayerId)} är redan på planen`
                : `${name(swap.inPlayerId)} byttes redan in ${matchMinute(previous)}`;
            break;
          }
          if (incoming.has(swap.inPlayerId)) {
            error = `${name(swap.inPlayerId)} kan inte bytas in på flera platser`;
            break;
          }
          incoming.add(swap.inPlayerId);
        }

        if (error !== null) {
          ignoreTransition(entry, error);
          break;
        }

        const atElapsedMs = elapsedAt(clock.segments, entry.atMs);
        for (const swap of event.swaps) {
          slots.set(swap.slotId, swap.inPlayerId);
          bench.delete(swap.inPlayerId);
          bench.add(swap.outPlayerId);
          substitutedInAt.set(swap.inPlayerId, atElapsedMs);
        }
        if (event.planId !== undefined) plans.delete(event.planId);
        break;
      }

      case 'match_ended':
        if (ended) ignoreTransition(entry, 'matchen är redan avslutad');
        else ended = true;
        break;

      case 'period_started':
      case 'period_ended':
      case 'clock_paused':
      case 'clock_resumed':
      case 'event_undone':
      case 'event_time_corrected':
        break;
    }
  }

  addTime(cursorMs, nowMs);

  const currentSlotByPlayer = new Map<string, string>();
  for (const [slotId, playerId] of slots) currentSlotByPlayer.set(playerId, slotId);

  const playerOutput: Record<string, DerivedPlayerState> = {};
  for (const [playerId, player] of players) {
    playerOutput[playerId] = {
      ...player,
      currentSlotId: currentSlotByPlayer.get(playerId) ?? null,
    };
  }

  return {
    matchId,
    formationId,
    ended,
    clock,
    players: playerOutput,
    currentSlots: Object.fromEntries(slots),
    bench: [...bench],
    plannedSubstitutions: [...plans.values()],
    ignored: ignored.sort((left, right) => left.index - right.index),
  };
}

/**
 * Viker hela den append-only matchloggen till en läsmodell vid `now`.
 *
 * Funktionen är total: okänd, nyare eller motsägelsefull data redovisas i
 * `ignored` i stället för att kasta eller göra resten av matchen oläsbar.
 */
export function deriveMatchState(events: unknown, now: Date): DerivedMatchState {
  try {
    return deriveMatchStateInternal(events, now);
  } catch (error: unknown) {
    return emptyState([
      {
        index: -1,
        reason: 'invalid',
        message: error instanceof Error ? error.message : 'matchloggen kunde inte läsas',
        raw: events,
      },
    ]);
  }
}
