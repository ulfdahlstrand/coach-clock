import { oc } from '@orpc/contract';
import { z } from 'zod';
import { matchEventSchema } from './events.js';
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

/** Svaret är samma oavsett om händelsen skapades eller redan fanns. */
export const appendMatchEventOutputSchema = z.object({
  eventId: z.uuid(),
  matchId: z.uuid(),
  seq: z.int().positive(),
  receivedAt: z.iso.datetime(),
});

export type AppendMatchEventOutput = z.infer<typeof appendMatchEventOutputSchema>;

export const appendMatchEventContract = oc
  .route({
    method: 'POST',
    path: '/matches/events',
    operationId: 'appendMatchEvent',
    summary: 'Lägg till en händelse i en matchlogg',
  })
  .input(matchEventSchema)
  .output(appendMatchEventOutputSchema);

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
  matches: {
    events: appendMatchEventContract,
  },
});

export type AppRouter = typeof contract;
