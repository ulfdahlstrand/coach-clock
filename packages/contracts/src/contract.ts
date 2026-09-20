import { oc } from '@orpc/contract';
import {
  createPlayerInputSchema,
  createPlayerOutputSchema,
  createTeamInputSchema,
  createTeamOutputSchema,
  listPlayersInputSchema,
  listPlayersOutputSchema,
  listTeamsInputSchema,
  listTeamsOutputSchema,
  updatePlayerInputSchema,
  updatePlayerOutputSchema,
} from './teams.js';

/**
 * Rotkontraktet för coach-clock.
 *
 * Allt som läggs till här blir både serverns bindningstabell och klientens
 * typer — kontraktet är enda källan.
 */
export const contract = oc.router({
  listTeams: oc
    .route({ method: 'GET', path: '/teams' })
    .input(listTeamsInputSchema)
    .output(listTeamsOutputSchema),
  createTeam: oc
    .route({ method: 'POST', path: '/teams' })
    .input(createTeamInputSchema)
    .output(createTeamOutputSchema),
  listPlayers: oc
    .route({ method: 'GET', path: '/players' })
    .input(listPlayersInputSchema)
    .output(listPlayersOutputSchema),
  createPlayer: oc
    .route({ method: 'POST', path: '/players' })
    .input(createPlayerInputSchema)
    .output(createPlayerOutputSchema),
  updatePlayer: oc
    .route({ method: 'POST', path: '/players/update' })
    .input(updatePlayerInputSchema)
    .output(updatePlayerOutputSchema),
});

export type AppRouter = typeof contract;
