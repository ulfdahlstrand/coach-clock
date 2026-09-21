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
