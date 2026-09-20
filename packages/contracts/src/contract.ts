import { oc } from '@orpc/contract';
import { z } from 'zod';
import { matchEventSchema, matchFormatSchema } from './events.js';
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

const joinCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.replace('-', '').toUpperCase())
  .pipe(z.string().regex(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{6}$/));

const linkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{24}$/);

export const createMatchShareContract = oc
  .route({
    method: 'POST',
    path: '/matches/share',
    operationId: 'createMatchShare',
    summary: 'Skapa en säker delningslänk och kort anslutningskod',
  })
  .input(z.object({ matchId: matchIdSchema }))
  .output(
    z.object({
      joinCode: z.string().regex(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{3}-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{3}$/),
      linkToken: linkTokenSchema,
    }),
  );

export const joinMatchContract = oc
  .route({
    method: 'POST',
    path: '/matches/join',
    operationId: 'joinMatch',
    summary: 'Gå med i en delad match utan konto',
  })
  .input(
    z
      .object({
        displayName: z.string().trim().min(1).max(100),
        code: joinCodeSchema.optional(),
        linkToken: linkTokenSchema.optional(),
      })
      .refine(({ code, linkToken }) => code !== undefined || linkToken !== undefined, {
        message: 'Ange kod eller länktoken',
      }),
  )
  .output(
    z.object({
      participantId: z.uuid(),
      matchId: matchIdSchema,
      displayName: z.string(),
    }),
  );

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
    get: getMatchContract,
    share: createMatchShareContract,
    join: joinMatchContract,
    events: appendMatchEventContract,
    listEvents: listMatchEventsContract,
  },
  time: getServerTimeContract,
});

export type AppRouter = typeof contract;
