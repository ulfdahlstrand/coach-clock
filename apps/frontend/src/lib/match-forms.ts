import { zodResolver } from '@hookform/resolvers/zod';
import { createMatchInputSchema, type PositionMode } from '@coach-clock/contracts';
import { z } from 'zod';

/** Matchstartens formulär delar exakt samma validering som API:t. */
export const createMatchFormSchema = createMatchInputSchema;
export type CreateMatchFormValues = z.infer<typeof createMatchFormSchema>;
const validateCreateMatch = zodResolver(createMatchFormSchema);

/**
 * Valideras som det skickas: en klockmatch utan trupp och uppställning. Annars
 * skulle de dolda, automatiskt ifyllda platserna kunna stoppa matchstarten.
 */
export const createMatchResolver: typeof validateCreateMatch = (values, context, options) =>
  validateCreateMatch(toCreateMatchInput(values), context, options);

export type MatchSetupDefaults = Pick<
  CreateMatchFormValues,
  | 'format'
  | 'formationId'
  | 'periodCount'
  | 'periodLengthSeconds'
  | 'idealShiftSeconds'
  | 'positionMode'
  | 'clockOnly'
>;

const defaultPrefix = 'coach-clock.match-setup.';

export function loadMatchSetupDefaults(teamId: string): MatchSetupDefaults | undefined {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(`${defaultPrefix}${teamId}`) ?? 'null');
    const parsed = createMatchFormSchema
      .pick({
        format: true,
        formationId: true,
        periodCount: true,
        periodLengthSeconds: true,
        idealShiftSeconds: true,
        positionMode: true,
        clockOnly: true,
      })
      .safeParse(saved);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function saveMatchSetupDefaults(teamId: string, values: MatchSetupDefaults): void {
  localStorage.setItem(`${defaultPrefix}${teamId}`, JSON.stringify(values));
}

/** Vilka matchinställningar tränaren själv har ändrat i formuläret. */
export type TouchedSetupFields = ReadonlySet<keyof MatchSetupDefaults>;

/**
 * Lägger lagets sparade förval över det som redan står i formuläret, men bara
 * där tränaren inte själv gjort ett val (#92). Annars hoppade en vald spelform
 * tillbaka till förra matchens när laget valdes.
 *
 * Spelform och formation hör ihop: en formation tillhör en spelform, och
 * uppställningen byggs av formationens platser. Har tränaren rört någon av dem
 * behålls båda.
 */
export function applyTeamDefaults(
  current: MatchSetupDefaults,
  defaults: MatchSetupDefaults | undefined,
  touched: TouchedSetupFields,
): MatchSetupDefaults {
  if (defaults === undefined) return current;
  const keepShape = touched.has('format') || touched.has('formationId');
  const pick = <K extends keyof MatchSetupDefaults>(key: K): MatchSetupDefaults[K] =>
    touched.has(key) ? current[key] : defaults[key];

  return {
    format: keepShape ? current.format : defaults.format,
    formationId: keepShape ? current.formationId : defaults.formationId,
    periodCount: pick('periodCount'),
    periodLengthSeconds: pick('periodLengthSeconds'),
    ...(pick('idealShiftSeconds') === undefined
      ? {}
      : { idealShiftSeconds: pick('idealShiftSeconds') }),
    ...(pick('positionMode') === undefined ? {} : { positionMode: pick('positionMode') }),
    ...(pick('clockOnly') === undefined ? {} : { clockOnly: pick('clockOnly') }),
  };
}

/**
 * En klockmatch skickar varken trupp eller uppställning. Formuläret fyller
 * dem automatiskt i bakgrunden, så de töms här i stället för i varje fält.
 */
export function toCreateMatchInput(values: CreateMatchFormValues): CreateMatchFormValues {
  return values.clockOnly === true ? { ...values, presentPlayerIds: [], assignments: [] } : values;
}

/** Etiketter för positionslägena i bytesförslagen (#91). */
export const POSITION_MODE_LABELS: Readonly<Record<PositionMode, string>> = {
  time: 'Bara speltid',
  best: 'Bästa positioner',
  even: 'Jämn fördelning',
};
