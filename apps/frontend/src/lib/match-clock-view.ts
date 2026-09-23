import { matchClock, type MatchClock, type MatchEvent } from '@coach-clock/contracts';

/** Formats a duration for the large sideline clock without ever owning time itself. */
export function formatClock(milliseconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * The screen's clock is deliberately only a projection of the event log at
 * server-adjusted `now`. Rendering may happen every 250 ms; no rendered tick
 * is stored or later used to calculate match time.
 */
export function deriveVisibleMatchClock(
  events: readonly MatchEvent[],
  serverAdjustedNow: Date | undefined,
): MatchClock | undefined {
  return serverAdjustedNow === undefined ? undefined : matchClock(events, serverAdjustedNow);
}

export type MatchControlState = {
  /** Märket vid rubriken. */
  readonly status: 'EJ STARTAD' | 'PÅGÅR' | 'PAUS' | 'PERIODPAUS' | 'SLUT';
  readonly startLabel: string;
  readonly notStarted: boolean;
  /** Sista perioden är avblåst men matchen inte avslutad — dags för Avsluta match. */
  readonly matchOver: boolean;
};

/**
 * Vad klockknapparna ska visa. Matchen startar inte av sig själv (#89), så
 * tillståndet före avspark måste gå att skilja från en pausad klocka.
 */
export function matchControlState(input: {
  readonly periodNumber: number | null | undefined;
  readonly running: boolean;
  readonly currentPeriodEnded: boolean;
  readonly periodCount: number | undefined;
  readonly ended: boolean;
}): MatchControlState {
  const notStarted = input.periodNumber === null || input.periodNumber === undefined;
  const activePeriod = input.periodNumber ?? 0;
  const isFinalPeriod = input.periodCount !== undefined && activePeriod >= input.periodCount;
  const matchOver = isFinalPeriod && input.currentPeriodEnded && !input.ended;
  const startLabel = input.running
    ? 'Spelar'
    : notStarted
      ? 'Starta period 1'
      : input.currentPeriodEnded
        ? `Starta period ${String(activePeriod + 1)}`
        : 'Fortsätt';
  const status = input.ended
    ? 'SLUT'
    : notStarted
      ? 'EJ STARTAD'
      : input.running
        ? 'PÅGÅR'
        : input.currentPeriodEnded
          ? 'PERIODPAUS'
          : 'PAUS';
  return { status, startLabel, notStarted, matchOver };
}
