import {
  deriveFairnessState,
  deriveMatchState,
  formations,
  type MatchEvent,
  type MatchPlayerRole,
} from '@coach-clock/contracts';

export type SummaryPlayer = {
  readonly playerId: string;
  readonly name: string;
  readonly number: number | null;
  readonly playedMs: number;
  readonly fairShareMs: number;
  readonly differenceMs: number;
  readonly roles: readonly { readonly role: MatchPlayerRole; readonly playedMs: number }[];
};

export type SummaryTimelineItem = {
  readonly id: string;
  readonly at: string;
  readonly kind: 'period' | 'pause' | 'substitution';
  readonly label: string;
};

export type MatchSummary = {
  readonly runningMs: number;
  readonly expectedPlayerMs: number;
  readonly actualPlayerMs: number;
  readonly playerTimeIsBalanced: boolean;
  readonly players: readonly SummaryPlayer[];
  readonly timeline: readonly SummaryTimelineItem[];
};

const roleLabels: Readonly<Record<MatchPlayerRole, string>> = {
  goalkeeper: 'Målvakt',
  defender: 'Försvar',
  midfielder: 'Mittfält',
  forward: 'Anfall',
  unknown: 'Övrigt',
};

function eventLabel(event: MatchEvent): SummaryTimelineItem | null {
  switch (event.type) {
    case 'period_started':
      return {
        id: event.eventId,
        at: event.at,
        kind: 'period',
        label: `Period ${event.periodNumber} startar`,
      };
    case 'period_ended':
      return {
        id: event.eventId,
        at: event.at,
        kind: 'period',
        label: `Period ${event.periodNumber} slutar`,
      };
    case 'clock_paused':
      return {
        id: event.eventId,
        at: event.at,
        kind: 'pause',
        label: event.reason ? `Paus: ${event.reason}` : 'Klockan pausas',
      };
    case 'clock_resumed':
      return {
        id: event.eventId,
        at: event.at,
        kind: 'pause',
        label: event.reason ? `Spelet återupptas: ${event.reason}` : 'Spelet återupptas',
      };
    case 'substitution_confirmed':
      return {
        id: event.eventId,
        at: event.at,
        kind: 'substitution',
        label: `${event.swaps.length} ${event.swaps.length === 1 ? 'byte' : 'byten'} genomförs`,
      };
    default:
      return null;
  }
}

/** A pure, share-safe projection. All playing time is derived from the event log. */
export function createMatchSummary(events: readonly MatchEvent[], now: Date): MatchSummary {
  const state = deriveMatchState(events, now);
  const fairness = deriveFairnessState(events, now);
  const fairByPlayer = new Map(fairness.players.map((player) => [player.playerId, player]));
  const players = Object.values(state.players)
    .map((player) => {
      const fair = fairByPlayer.get(player.playerId);
      return {
        playerId: player.playerId,
        name: player.name,
        number: player.number,
        playedMs: player.playedMs,
        fairShareMs: fair?.shareMs ?? 0,
        differenceMs: (fair?.shareMs ?? 0) - player.playedMs,
        roles: (Object.entries(player.timeByRole) as [MatchPlayerRole, number][])
          .filter(([, playedMs]) => playedMs > 0)
          .map(([role, playedMs]) => ({ role, playedMs }))
          .sort(
            (left, right) => right.playedMs - left.playedMs || left.role.localeCompare(right.role),
          ),
      };
    })
    .sort((left, right) => right.playedMs - left.playedMs || left.name.localeCompare(right.name));
  const fieldSlots =
    formations.find((formation) => formation.id === state.formationId)?.slots.length ?? 0;
  const actualPlayerMs = players.reduce((total, player) => total + player.playedMs, 0);

  return {
    runningMs: state.clock.elapsedMs,
    expectedPlayerMs: fieldSlots * state.clock.elapsedMs,
    actualPlayerMs,
    playerTimeIsBalanced: actualPlayerMs === fieldSlots * state.clock.elapsedMs,
    players,
    timeline: events
      .map(eventLabel)
      .filter((item): item is SummaryTimelineItem => item !== null)
      .sort(
        (left, right) =>
          Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id),
      ),
  };
}

export function formatMatchDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function roleLabel(role: MatchPlayerRole): string {
  return roleLabels[role];
}
