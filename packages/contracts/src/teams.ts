import { z } from 'zod';

const idSchema = z.uuid();
const nameSchema = z.string().trim().min(1).max(100);

export const teamSchema = z.object({
  id: idSchema,
  name: z.string(),
  createdAt: z.date(),
});

export const playerSchema = z.object({
  id: idSchema,
  teamId: idSchema,
  name: z.string(),
  number: z.number().int().positive().nullable(),
  isGoalkeeper: z.boolean(),
  archived: z.boolean(),
});

export const listTeamsInputSchema = z.object({});
export const listTeamsOutputSchema = z.array(teamSchema);

export const createTeamInputSchema = z.object({
  name: nameSchema,
});
export const createTeamOutputSchema = teamSchema;

export const listPlayersInputSchema = z.object({
  teamId: idSchema,
});
export const listPlayersOutputSchema = z.array(playerSchema);

export const createPlayerInputSchema = z.object({
  teamId: idSchema,
  name: nameSchema,
  number: z.number().int().positive().nullable().optional(),
  isGoalkeeper: z.boolean().optional(),
});
export const createPlayerOutputSchema = playerSchema;

export const updatePlayerInputSchema = z
  .object({
    teamId: idSchema,
    playerId: idSchema,
    name: nameSchema.optional(),
    number: z.number().int().positive().nullable().optional(),
    isGoalkeeper: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    ({ name, number, isGoalkeeper, archived }) =>
      name !== undefined ||
      number !== undefined ||
      isGoalkeeper !== undefined ||
      archived !== undefined,
    { message: 'Minst ett spelarfält måste uppdateras' },
  );
export const updatePlayerOutputSchema = playerSchema;

export type Team = z.infer<typeof teamSchema>;
export type Player = z.infer<typeof playerSchema>;
