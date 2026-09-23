import { type MatchEvent, parseMatchEventLog } from './events.js';
import { formations, outfieldSlotCount } from './formations.js';
import type { PositionMode } from './events.js';
import { deriveMatchState, type DerivedMatchState, type MatchPlayerRole } from './match-state.js';

/**
 * Skuld som får ett spelarkort att lysa som eftersatt. Sedan #82 är den bara
 * en färgskala — när ett byte är befogat avgörs av matchens bytestid.
 */
export const DEFAULT_SUBSTITUTION_DEBT_THRESHOLD_MS = 90_000;

export type FairnessOptions = {
  /** Include players marked as goalkeepers in the rotation pool. Defaults to false. */
  readonly rotateGoalkeepers?: boolean;
};

export type FairnessPlayer = {
  readonly playerId: string;
  readonly name: string;
  readonly isGoalkeeper: boolean;
  readonly available: boolean;
  /** Time earned from the fair-share model. */
  readonly shareMs: number;
  /** Actual time played in the relevant rotation pool. */
  readonly playedMs: number;
  /** `shareMs - playedMs`; a positive value means the player is underplayed. */
  readonly debtMs: number;
  /** Matchtid i det pågående passet på planen, 0 på bänken. */
  readonly currentShiftMs: number;
};

export type SuggestedSubstitution = {
  readonly outPlayerId: string;
  readonly inPlayerId: string;
};

export type FairnessState = {
  /** Minsta passlängd innan en utespelare föreslås ut. */
  readonly idealShiftMs: number;
  /** Hur förslaget väljer plats för bytet (#91). */
  readonly positionMode: PositionMode;
  readonly rotatingSlotCount: number;
  readonly players: readonly FairnessPlayer[];
  readonly rotationPlayers: readonly FairnessPlayer[];
  /** Goalkeepers are reported separately when they are not being rotated. */
  readonly goalkeeperPlayers: readonly FairnessPlayer[];
  readonly substitutionDue: boolean;
  /** Matchtid tills nästa byte blir befogat, eller null om inget byte är möjligt. */
  readonly timeToNextSubstitutionMs: number | null;
  readonly suggestedSubstitution: SuggestedSubstitution | null;
};

type AvailabilityChange = {
  readonly atMs: number;
  readonly playerId: string;
  readonly available: boolean;
};

function stablePlayerOrder(left: FairnessPlayer, right: FairnessPlayer): number {
  return left.playerId.localeCompare(right.playerId);
}

/**
 * Applies the log's undo and timestamp-correction pre-pass. The state fold is
 * intentionally still the source of truth for played time and the live lineup;
 * this small projection only supplies historical availability boundaries.
 */
function effectiveEvents(input: unknown, nowMs: number): readonly MatchEvent[] {
  const parsed = parseMatchEventLog(input);
  const byId = new Map<string, MatchEvent>();
  const unique: MatchEvent[] = [];
  let matchId: string | null = null;

  for (const event of parsed.events) {
    if (byId.has(event.eventId) || (matchId !== null && event.matchId !== matchId)) continue;
    matchId ??= event.matchId;
    byId.set(event.eventId, event);
    unique.push(event);
  }

  const inactive = new Set<string>();
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const event = unique[index];
    if (event === undefined || event.type !== 'event_undone' || Date.parse(event.at) > nowMs)
      continue;
    if (inactive.has(event.eventId)) continue;
    const target = byId.get(event.targetEventId);
    if (target !== undefined && target.eventId !== event.eventId) inactive.add(target.eventId);
  }

  const correctedAt = new Map<string, string>();
  for (const event of unique) {
    if (event.type !== 'event_time_corrected' || inactive.has(event.eventId)) continue;
    if (Date.parse(event.at) <= nowMs && !inactive.has(event.targetEventId)) {
      correctedAt.set(event.targetEventId, event.correctedAt);
    }
  }

  return unique
    .filter(
      (event) =>
        !inactive.has(event.eventId) &&
        event.type !== 'event_undone' &&
        event.type !== 'event_time_corrected',
    )
    .map((event) => ({ ...event, at: correctedAt.get(event.eventId) ?? event.at }))
    .filter((event) => Date.parse(event.at) <= nowMs)
    .sort(
      (left, right) =>
        Date.parse(left.at) - Date.parse(right.at) || left.eventId.localeCompare(right.eventId),
    );
}

function availabilityChanges(
  events: readonly MatchEvent[],
  playerIds: ReadonlySet<string>,
): AvailabilityChange[] {
  const changes: AvailabilityChange[] = [];
  const known = new Set<string>();

  for (const event of events) {
    if (event.type === 'squad_set') {
      for (const player of event.players) {
        known.add(player.playerId);
        if (playerIds.has(player.playerId)) {
          changes.push({ atMs: Date.parse(event.at), playerId: player.playerId, available: true });
        }
      }
    } else if (
      event.type === 'availability_changed' &&
      known.has(event.playerId) &&
      playerIds.has(event.playerId)
    ) {
      changes.push({
        atMs: Date.parse(event.from),
        playerId: event.playerId,
        available: event.available,
      });
    }
  }

  return changes.sort(
    (left, right) => left.atMs - right.atMs || left.playerId.localeCompare(right.playerId),
  );
}

function playedInRotation(
  state: DerivedMatchState,
  playerId: string,
  rotateGoalkeepers: boolean,
): number {
  const player = state.players[playerId];
  if (player === undefined) return 0;
  return rotateGoalkeepers
    ? player.playedMs
    : player.playedMs - (player.timeByRole.goalkeeper ?? 0);
}

/**
 * Derives equal-playing-time debts from the event log at an explicit instant.
 * Fair share is accrued separately for every running-clock and availability
 * segment, which makes late arrivals and injuries naturally fair.
 */
export function deriveFairnessState(
  events: unknown,
  now: Date,
  options: FairnessOptions = {},
): FairnessState {
  const state = deriveMatchState(events, now);
  const rotateGoalkeepers = options.rotateGoalkeepers ?? false;
  const idealShiftMs = state.idealShiftMs;
  const formation = formations.find((item) => item.id === state.formationId);
  const rotatingSlotCount =
    formation === undefined
      ? 0
      : rotateGoalkeepers
        ? formation.slots.length
        : outfieldSlotCount(formation);
  const playerEntries = Object.entries(state.players);
  /*
   * Rotationen avgörs av vad spelaren gör, inte av en flagga. En målvakt som
   * byts ut ska konkurrera om utespelartid som alla andra; en flaggbaserad
   * pool gjorde henne permanent osynlig och gav henne minst speltid av alla
   * så fort laget roterade målvakt (#81).
   */
  const rotationIds = new Set(playerEntries.map(([playerId]) => playerId));
  const goalkeeperSlotIds = new Set<string>(
    (formation?.slots ?? []).filter((slot) => slot.role === 'goalkeeper').map((slot) => slot.id),
  );
  /** Stod spelaren i mål vid den här tidpunkten? */
  const keptGoalAt = (playerId: string, atMs: number): boolean =>
    !rotateGoalkeepers &&
    state.goalkeeperStints.some(
      (stint) => stint.playerId === playerId && stint.fromMs <= atMs && atMs < stint.toMs,
    );
  const currentGoalkeepers = new Set(
    rotateGoalkeepers
      ? []
      : Object.entries(state.currentSlots)
          .filter(([slotId]) => goalkeeperSlotIds.has(slotId))
          .map(([, playerId]) => playerId),
  );
  const shares = new Map<string, number>([...rotationIds].map((playerId) => [playerId, 0]));
  const changes = availabilityChanges(effectiveEvents(events, now.getTime()), rotationIds);

  for (const segment of state.clock.segments) {
    const startMs = Date.parse(segment.startedAt);
    const endMs = Date.parse(segment.endedAt);
    const boundaries = [startMs, endMs];
    for (const change of changes) {
      if (change.atMs > startMs && change.atMs < endMs) boundaries.push(change.atMs);
    }
    // Ett målvaktsbyte mitt i ett avsnitt måste dela det, annars skulle halva
    // stunden i buren räknas som utespelartid eller tvärtom.
    for (const stint of state.goalkeeperStints) {
      for (const edge of [stint.fromMs, stint.toMs]) {
        if (edge > startMs && edge < endMs) boundaries.push(edge);
      }
    }
    boundaries.sort((left, right) => left - right);

    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const fromMs = boundaries[index];
      const toMs = boundaries[index + 1];
      if (fromMs === undefined || toMs === undefined || toMs <= fromMs) continue;
      const available = new Set<string>();
      for (const playerId of rotationIds) {
        let isAvailable = false;
        for (const change of changes) {
          if (change.playerId === playerId && change.atMs <= fromMs) isAvailable = change.available;
        }
        // Den som står i mål tjänar ingen utespelarandel — skulden fryses och
        // hon återvänder till rotationen på samma villkor som hon lämnade den.
        if (isAvailable && !keptGoalAt(playerId, fromMs)) available.add(playerId);
      }
      if (available.size === 0 || rotatingSlotCount === 0) continue;
      const earned = ((toMs - fromMs) * rotatingSlotCount) / available.size;
      for (const playerId of available) shares.set(playerId, (shares.get(playerId) ?? 0) + earned);
    }
  }

  const players = playerEntries
    .map(([playerId, player]) => {
      const isRotating = rotationIds.has(playerId);
      const shareMs = isRotating ? (shares.get(playerId) ?? 0) : 0;
      const playedMs = isRotating
        ? playedInRotation(state, playerId, rotateGoalkeepers)
        : player.playedMs;
      return {
        playerId,
        name: player.name,
        isGoalkeeper: player.isGoalkeeper,
        available: player.available,
        shareMs,
        playedMs,
        debtMs: shareMs - playedMs,
        currentShiftMs: player.currentShiftMs,
      };
    })
    .sort(stablePlayerOrder);
  const rotationPlayers = players.filter((player) => !currentGoalkeepers.has(player.playerId));
  const goalkeeperPlayers = players.filter((player) => currentGoalkeepers.has(player.playerId));
  const bench = new Set(state.bench);
  const availableBench = rotationPlayers.filter(
    (player) => bench.has(player.playerId) && player.available,
  );
  // Slots are keyed by slot id, so compare the player ids held in their values.
  const onFieldIds = new Set(Object.values(state.currentSlots));
  const rotatingOnField = rotationPlayers.filter((player) => onFieldIds.has(player.playerId));
  const incoming = [...availableBench].sort(
    (left, right) => right.debtMs - left.debtMs || stablePlayerOrder(left, right),
  )[0];
  /*
   * Bytestiden (#82) gäller bara motorns förslag. En spelare föreslås inte ut
   * förrän hon spelat klart sitt pass — men tränaren kan alltid byta för hand,
   * till exempel vid en skada. Reducern spärrar inga byten på passlängd.
   */
  const shiftDone = rotatingOnField.filter((player) => player.currentShiftMs >= idealShiftMs);
  const lowestDebt = (left: FairnessPlayer, right: FairnessPlayer) =>
    left.debtMs - right.debtMs || stablePlayerOrder(left, right);
  const outgoing =
    [...shiftDone].sort(lowestDebt)[0] ??
    // Ingen har spelat klart än: förhandsvisa den som blir först klar.
    [...rotatingOnField].sort(
      (left, right) => right.currentShiftMs - left.currentShiftMs || lowestDebt(left, right),
    )[0];
  const outgoingDone = outgoing !== undefined && outgoing.currentShiftMs >= idealShiftMs;

  /*
   * Positionsläget (#91) avgör bara vem av dem som spelat klart sitt pass som
   * går ut — alltså på vilken plats bytet görs. När ett byte är befogat och
   * vem som går in styrs av bytestid och skuld som vanligt, så tidsrättvisan
   * inte urholkas. Passar ingen plats faller förslaget tillbaka på lägst skuld.
   */
  const positionMode = state.positionMode;
  const slotRoles = new Map<string, string>(
    (formation?.slots ?? []).map((slot) => [slot.id, slot.role]),
  );
  const roleOnPitch = (playerId: string): MatchPlayerRole | undefined => {
    const slotId = state.players[playerId]?.currentSlotId;
    const role = slotId === null || slotId === undefined ? undefined : slotRoles.get(slotId);
    return role as MatchPlayerRole | undefined;
  };
  const incomingState = incoming === undefined ? undefined : state.players[incoming.playerId];
  const suggestedOutgoing = ((): FairnessPlayer | undefined => {
    if (incomingState === undefined || shiftDone.length === 0 || positionMode === 'time') {
      return outgoing;
    }
    if (positionMode === 'best') {
      const best = incomingState.bestRole;
      // En målvakts bästa plats är i mål; som utespelare kan hon gå in var som helst.
      if (best === null || best === 'goalkeeper' || best === 'unknown') return outgoing;
      return (
        [...shiftDone]
          .filter((player) => roleOnPitch(player.playerId) === best)
          .sort(lowestDebt)[0] ?? outgoing
      );
    }
    const timeInRole = (player: FairnessPlayer) => {
      const role = roleOnPitch(player.playerId);
      return role === undefined ? Number.POSITIVE_INFINITY : (incomingState.timeByRole[role] ?? 0);
    };
    return (
      [...shiftDone].sort(
        (left, right) => timeInRole(left) - timeInRole(right) || lowestDebt(left, right),
      )[0] ?? outgoing
    );
  })();
  const substitutionDue =
    incoming !== undefined && outgoingDone && incoming.debtMs > outgoing.debtMs;
  const timeToNextSubstitutionMs =
    incoming === undefined || outgoing === undefined
      ? null
      : substitutionDue
        ? 0
        : outgoingDone
          ? // Passet är slut men bänken ligger inte efter. Skulderna möts med
            // summan av bänkens och planens hastighet, som alltid är 1.
            Math.max(0, outgoing.debtMs - incoming.debtMs)
          : idealShiftMs - outgoing.currentShiftMs;

  return {
    idealShiftMs,
    positionMode,
    rotatingSlotCount,
    players,
    rotationPlayers,
    goalkeeperPlayers,
    substitutionDue,
    timeToNextSubstitutionMs,
    suggestedSubstitution:
      incoming === undefined || suggestedOutgoing === undefined
        ? null
        : { outPlayerId: suggestedOutgoing.playerId, inPlayerId: incoming.playerId },
  };
}

/** Concise alias for consumers that treat fairness as an analysis rather than a fold. */
export const deriveFairness = deriveFairnessState;
