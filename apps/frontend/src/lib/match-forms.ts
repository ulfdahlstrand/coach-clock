import { zodResolver } from '@hookform/resolvers/zod';
import { createMatchInputSchema } from '@coach-clock/contracts';
import { z } from 'zod';

/** Matchstartens formulär delar exakt samma validering som API:t. */
export const createMatchFormSchema = createMatchInputSchema;
export type CreateMatchFormValues = z.infer<typeof createMatchFormSchema>;
export const createMatchResolver = zodResolver(createMatchFormSchema);

export type MatchSetupDefaults = Pick<
  CreateMatchFormValues,
  'format' | 'formationId' | 'periodCount' | 'periodLengthSeconds'
>;

const defaultPrefix = 'coach-clock.match-setup.';

export function loadMatchSetupDefaults(teamId: string): MatchSetupDefaults | undefined {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(`${defaultPrefix}${teamId}`) ?? 'null');
    const parsed = createMatchFormSchema
      .pick({ format: true, formationId: true, periodCount: true, periodLengthSeconds: true })
      .safeParse(saved);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function saveMatchSetupDefaults(teamId: string, values: MatchSetupDefaults): void {
  localStorage.setItem(`${defaultPrefix}${teamId}`, JSON.stringify(values));
}
