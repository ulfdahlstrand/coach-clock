import { contract } from '@coach-clock/contracts';
import { implement } from '@orpc/server';
import type { ApiContext } from './procedures/matches.js';
import { appendMatchEvent, getMatch, listMatchEvents } from './procedures/matches.js';
import { getServerTime } from './procedures/time.js';

const os = implement(contract).$context<ApiContext>();

/**
 * Ren bindningstabell: kontraktets form till vänster, implementationen till höger.
 *
 * Ingen logik här — procedurerna bor i `src/procedures/`, en fil per domän.
 */
export const router = os.router({
  matches: {
    get: getMatch,
    events: appendMatchEvent,
    listEvents: listMatchEvents,
  },
  time: getServerTime,
});

export type AppRouter = typeof router;
