import { zodResolver } from '@hookform/resolvers/zod';
import { createPlayerInputSchema, createTeamInputSchema } from '@coach-clock/contracts';
import { z } from 'zod';

/** Formulärfält härleds från API-kontraktets skrivfält, inte dubblerade regler. */
export const createTeamFormSchema = createTeamInputSchema;
export type CreateTeamFormValues = z.infer<typeof createTeamFormSchema>;
export const createTeamResolver = zodResolver(createTeamFormSchema);

export const createPlayerFormSchema = createPlayerInputSchema.omit({ teamId: true });
export type CreatePlayerFormValues = z.infer<typeof createPlayerFormSchema>;
export const createPlayerResolver = zodResolver(createPlayerFormSchema);

// updatePlayerInputSchema innehåller en refine och kan därför inte omit:as i
// Zod v4. Basfälten delas ändå med create-kontraktet; arkivering är det enda
// extra skrivfältet i uppdateringskontraktet.
export const updatePlayerFormSchema = createPlayerInputSchema
  .omit({ teamId: true })
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine(
    ({ name, number, isGoalkeeper, archived }) =>
      name !== undefined ||
      number !== undefined ||
      isGoalkeeper !== undefined ||
      archived !== undefined,
    { message: 'Minst ett spelarfält måste uppdateras' },
  );
export type UpdatePlayerFormValues = z.infer<typeof updatePlayerFormSchema>;
export const updatePlayerResolver = zodResolver(updatePlayerFormSchema);
