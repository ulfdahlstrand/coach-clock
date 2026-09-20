import { oc } from '@orpc/contract';
import { z } from 'zod';
import { matchEventSchema } from './events.js';

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
  matches: {
    events: appendMatchEventContract,
  },
});

export type AppRouter = typeof contract;
