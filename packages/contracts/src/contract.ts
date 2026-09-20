import { oc } from '@orpc/contract';
import { z } from 'zod';
import { matchEventSchema, matchFormatSchema } from './events.js';

const matchIdSchema = z.uuid();

export const matchMetadataSchema = z.object({
  id: matchIdSchema,
  teamId: z.uuid(),
  opponent: z.string(),
  format: matchFormatSchema,
  formationId: z.string(),
  periodCount: z.int().positive(),
  periodLengthSeconds: z.int().positive(),
  status: z.enum(['scheduled', 'live', 'ended']),
  joinCode: z.string().nullable(),
  createdAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
});

export type MatchMetadata = z.infer<typeof matchMetadataSchema>;

export const getMatchContract = oc
  .route({
    method: 'GET',
    path: '/matches',
    operationId: 'getMatch',
    summary: 'Hämta metadata för en match',
  })
  .input(z.object({ matchId: matchIdSchema }))
  .output(matchMetadataSchema);

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

export const sequencedMatchEventSchema = z.object({
  seq: z.int().positive(),
  receivedAt: z.iso.datetime(),
  event: matchEventSchema,
});

export type SequencedMatchEvent = z.infer<typeof sequencedMatchEventSchema>;

export const listMatchEventsContract = oc
  .route({
    method: 'GET',
    path: '/matches/events',
    operationId: 'listMatchEvents',
    summary: 'Hämta händelser efter ett ordningsnummer',
  })
  .input(
    z.object({
      matchId: matchIdSchema,
      sinceSeq: z.coerce.number().int().nonnegative(),
    }),
  )
  .output(z.array(sequencedMatchEventSchema));

export const serverTimeSchema = z.object({ now: z.iso.datetime() });

export type ServerTime = z.infer<typeof serverTimeSchema>;

export const getServerTimeContract = oc
  .route({
    method: 'GET',
    path: '/time',
    operationId: 'getServerTime',
    summary: 'Hämta serverns aktuella tid',
  })
  .output(serverTimeSchema);

/**
 * Rotkontraktet för coach-clock.
 *
 * Allt som läggs till här blir både serverns bindningstabell och klientens
 * typer — kontraktet är enda källan.
 */
export const contract = oc.router({
  matches: {
    get: getMatchContract,
    events: appendMatchEventContract,
    listEvents: listMatchEventsContract,
  },
  time: getServerTimeContract,
});

export type AppRouter = typeof contract;
