import type {
  DerivedMatchState,
  MatchStateIgnoredEvent,
  PlannedSubstitution,
} from '@coach-clock/contracts';

export type ConflictPresentation = {
  readonly title: string;
  readonly description: string;
};

/**
 * The fold intentionally keeps detailed machine reasons for diagnostics.  The
 * sideline UI must never expose those codes: a coach needs to know what to do,
 * not how the reducer represents it.
 */
export function describeIgnoredEvent(event: MatchStateIgnoredEvent): ConflictPresentation {
  switch (event.reason) {
    case 'undone':
      return {
        title: 'En händelse är ångrad',
        description: 'Den räknas inte längre med i matchen.',
      };
    case 'duplicate_event':
      return {
        title: 'En händelse kom in två gånger',
        description: 'Bara den första registreringen räknas med.',
      };
    case 'future':
      return {
        title: 'En händelse väntar på rätt tid',
        description: 'Den visas när matchtiden har hunnit ikapp.',
      };
    case 'invalid_reference':
      return {
        title: 'En händelse saknar något i matchen',
        description: 'Kontrollera spelare eller tidigare händelser innan ni fortsätter.',
      };
    case 'invalid_transition':
      return {
        title: 'Ett byte eller en matchåtgärd gick inte att genomföra',
        description: 'Matchläget är oförändrat. Kontrollera uppställningen och försök igen.',
      };
    case 'unsupported_version':
      return {
        title: 'En händelse kommer från en nyare appversion',
        description: 'Uppdatera appen för att kunna använda den händelsen.',
      };
    case 'unknown_type':
      return {
        title: 'En händelse känns inte igen',
        description: 'Matchläget är säkert och resten av loggen fortsätter fungera.',
      };
    case 'invalid':
      return {
        title: 'En händelse kunde inte läsas',
        description: 'Matchläget är säkert och den här registreringen räknas inte med.',
      };
  }
}

/** Turns internal actor identifiers into a label suitable for another coach. */
export function plannerLabel(identity: string): string {
  if (identity === 'coach:assistant') return 'assisterande tränaren';
  if (identity === 'coach') return 'tränaren';
  if (identity.startsWith('coach:')) return 'en annan tränare';
  if (identity.startsWith('device:')) return 'en annan enhet';
  return identity;
}

export function plannedSwapDescription(
  plan: PlannedSubstitution,
  playerName: (playerId: string) => string,
): string {
  return plan.swaps
    .map((swap) => `${playerName(swap.outPlayerId)} ut · ${playerName(swap.inPlayerId)} in`)
    .join(', ');
}

export function conflictCount(state: Pick<DerivedMatchState, 'ignored'>): number {
  return state.ignored.length;
}
