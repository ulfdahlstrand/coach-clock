import { oc } from '@orpc/contract';
import { z } from 'zod';

/** Den inloggade tränaren. Tränaren loggar in; domare och åskådare gör det aldrig (#16). */
export const authUserSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.string(),
  imageUrl: z.string().nullable(),
});

export type AuthUser = z.infer<typeof authUserSchema>;

/** `user` är null för en utloggad besökare — det är ett svar, inte ett fel. */
export const meOutputSchema = z.object({ user: authUserSchema.nullable() });

export type MeOutput = z.infer<typeof meOutputSchema>;

export const getMeContract = oc
  .route({
    method: 'GET',
    path: '/auth/me',
    operationId: 'getMe',
    summary: 'Hämta den inloggade tränaren, eller null',
  })
  .output(meOutputSchema);

export const logoutContract = oc
  .route({
    method: 'POST',
    path: '/auth/logout',
    operationId: 'logout',
    summary: 'Avsluta sessionen och rensa sessionscookien',
  })
  .output(z.object({ ok: z.literal(true) }));
