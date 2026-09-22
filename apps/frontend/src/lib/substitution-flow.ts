import type { SubstitutionSwap } from '@coach-clock/contracts';

/** Adds a pending pair without allowing a player or slot to appear twice. */
export function addPendingSwap(
  swaps: readonly SubstitutionSwap[],
  swap: SubstitutionSwap,
): readonly SubstitutionSwap[] {
  if (
    swaps.some(
      (current) =>
        current.slotId === swap.slotId ||
        current.outPlayerId === swap.outPlayerId ||
        current.inPlayerId === swap.inPlayerId,
    )
  ) {
    return swaps;
  }
  return [...swaps, swap];
}

export function removePendingSwap(
  swaps: readonly SubstitutionSwap[],
  slotId: string,
): readonly SubstitutionSwap[] {
  return swaps.filter((swap) => swap.slotId !== slotId);
}

export function plannerName(plannedBy: string): string {
  return plannedBy === 'owner' ? 'Du' : plannedBy.replace(/^coach:/, 'Tränare ');
}
