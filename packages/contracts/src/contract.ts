import { oc } from '@orpc/contract';
import { z } from 'zod';
import { matchEventSchema, matchFormatSchema, slotAssignmentSchema } from './events.js';
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

const uniqueIds = (values: readonly string[]) => new Set(values).size === values.length;

/** Allt som behövs för att skapa en match och dess första, spelbara uppställning. */
export const createMatchInputSchema = z.object({
  teamId: z.uuid(),
  opponent: z.string().trim().min(1).max(200),
  format: matchFormatSchema,
  formationId: z.string().min(1).max(64),
  periodCount: z.int().min(1).max(10),
  periodLengthSeconds: z.int().min(1).max(7200),
  presentPlayerIds: z.array(z.uuid()).min(1).refine(uniqueIds, 'Spelarna måste vara unika'),
  assignments: z.array(slotAssignmentSchema).min(1),
});

export type CreateMatchInput = z.infer<typeof createMatchInputSchema>;

export const createMatchContract = oc
  .route({
    method: 'POST',
    path: '/matches',
    operationId: 'createMatch',
    summary: 'Skapa och starta en match med trupp och startuppställning',
  })
  .input(createMatchInputSchema)
  .output(matchMetadataSchema);

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

/** En separat, högentropisk länk för domaren. Den ger aldrig coachbehörighet. */
export const createRefereeLinkContract = oc
  .route({
    method: 'POST',
    path: '/matches/referee-link',
    operationId: 'createRefereeLink',
    summary: 'Skapa eller rotera en säker domarlänk för matchen',
  })
  .input(z.object({ matchId: matchIdSchema }))
  .output(z.object({ linkToken: linkTokenSchema }));

export const joinAsRefereeContract = oc
  .route({
    method: 'POST',
    path: '/matches/referee-join',
    operationId: 'joinAsReferee',
    summary: 'Gå med i en match som domare via säker länk',
  })
  .input(
    z.object({
      displayName: z.string().trim().min(1).max(100),
      linkToken: linkTokenSchema,
    }),
  )
  .output(
    z.object({
      participantId: z.uuid(),
      matchId: matchIdSchema,
      displayName: z.string(),
      role: z.literal('referee'),
    }),
  );

/** Delas bara med en deltagare i matchen; tokenhashar lämnar aldrig servern. */
export const matchParticipantSchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  role: z.enum(['owner', 'coach', 'referee', 'viewer']),
  lastSeenAt: z.iso.datetime(),
});

export const listMatchParticipantsContract = oc
  .route({
    method: 'GET',
    path: '/matches/participants',
    operationId: 'listMatchParticipants',
    summary: 'Visa deltagare som är anslutna till en match',
  })
  .input(z.object({ matchId: matchIdSchema }))
  .output(z.array(matchParticipantSchema));

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
    create: createMatchContract,
    get: getMatchContract,
    share: createMatchShareContract,
    join: joinMatchContract,
    refereeLink: createRefereeLinkContract,
    refereeJoin: joinAsRefereeContract,
    participants: listMatchParticipantsContract,
    events: appendMatchEventContract,
    listEvents: listMatchEventsContract,
  },
  time: getServerTimeContract,
});

export type AppRouter = typeof contract;
