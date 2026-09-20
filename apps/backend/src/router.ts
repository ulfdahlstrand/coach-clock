import { contract } from '@coach-clock/contracts';
import { implement } from '@orpc/server';
import {
  createPlayer,
  createTeam,
  listPlayers,
  listTeams,
  updatePlayer,
} from './procedures/teams.js';

const os = implement(contract);

/**
 * Ren bindningstabell: kontraktets form till vänster, implementationen till höger.
 *
 * Ingen logik här — procedurerna bor i `src/procedures/`, en fil per domän.
 */
export const router = os.router({
  listTeams,
  createTeam,
  listPlayers,
  createPlayer,
  updatePlayer,
});

export type AppRouter = typeof router;
