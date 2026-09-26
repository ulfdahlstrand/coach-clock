import { contract } from '@coach-clock/contracts';
import { implement } from '@orpc/server';
import {
  createPlayer,
  createTeam,
  listPlayers,
  listTeams,
  updatePlayer,
} from './procedures/teams.js';
import { getMe, logout } from './procedures/auth.js';
import type { ApiContext } from './procedures/matches.js';
import { appendMatchEvent, createMatch, getMatch, listMatchEvents } from './procedures/matches.js';
import { createRefereeLink, joinAsReferee } from './procedures/referee.js';
import { createMatchShare, joinMatch, listMatchParticipants } from './procedures/sharing.js';
import { getServerTime } from './procedures/time.js';

const os = implement(contract).$context<ApiContext>();

/**
 * Ren bindningstabell: kontraktets form till vänster, implementationen till höger.
 *
 * Ingen logik här — procedurerna bor i `src/procedures/`, en fil per domän.
 */
export const router = os.router({
  auth: {
    me: getMe,
    logout,
  },
  listTeams,
  createTeam,
  listPlayers,
  createPlayer,
  updatePlayer,
  matches: {
    create: createMatch,
    get: getMatch,
    share: createMatchShare,
    join: joinMatch,
    refereeLink: createRefereeLink,
    refereeJoin: joinAsReferee,
    participants: listMatchParticipants,
    events: appendMatchEvent,
    listEvents: listMatchEvents,
  },
  time: getServerTime,
});

export type AppRouter = typeof router;
