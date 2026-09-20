import { contract } from '@coach-clock/contracts';
import { implement } from '@orpc/server';

const os = implement(contract);

/**
 * Ren bindningstabell: kontraktets form till vänster, implementationen till höger.
 *
 * Ingen logik här — procedurerna bor i `src/procedures/`, en fil per domän.
 * Tom så länge kontraktet är tomt.
 */
export const router = os.router({});

export type AppRouter = typeof router;
