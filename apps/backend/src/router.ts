import { contract } from '@coach-clock/contracts';
import { implement } from '@orpc/server';
import type { ApiContext } from './procedures/matches.js';
import { appendMatchEvent } from './procedures/matches.js';

const os = implement(contract).$context<ApiContext>();

/**
 * Ren bindningstabell: kontraktets form till vänster, implementationen till höger.
 *
 * Ingen logik här — procedurerna bor i `src/procedures/`, en fil per domän.
 */
export const router = os.router({
  matches: {
    events: appendMatchEvent,
  },
});

export type AppRouter = typeof router;
