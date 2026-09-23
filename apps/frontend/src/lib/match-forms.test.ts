import { describe, expect, test } from 'vitest';
import {
  applyTeamDefaults,
  createMatchFormSchema,
  loadMatchSetupDefaults,
  saveMatchSetupDefaults,
} from './match-forms';

test('matchstartformuläret använder kontraktets regler för startelvan', () => {
  const input = {
    teamId: '00000000-0000-4000-8000-000000000001',
    opponent: 'Grön IF',
    format: 5,
    formationId: '5v5-1-2-1',
    periodCount: 3,
    periodLengthSeconds: 600,
    presentPlayerIds: ['00000000-0000-4000-8000-000000000002'],
    assignments: [{ slotId: 'gk', playerId: '00000000-0000-4000-8000-000000000002' }],
  };
  expect(createMatchFormSchema.safeParse(input).success).toBe(true);
  expect(createMatchFormSchema.safeParse({ ...input, opponent: ' ' }).success).toBe(false);
});

test('lagets förval minns bytestiden till nästa match', () => {
  const teamId = '00000000-0000-4000-8000-000000000009';
  saveMatchSetupDefaults(teamId, {
    format: 7,
    formationId: '7v7-2-3-1',
    periodCount: 3,
    periodLengthSeconds: 900,
    idealShiftSeconds: 300,
  });

  expect(loadMatchSetupDefaults(teamId)?.idealShiftSeconds).toBe(300);
});

describe('lagets förval', () => {
  const teamDefaults = {
    format: 7,
    formationId: '7v7-2-3-1',
    periodCount: 3,
    periodLengthSeconds: 900,
    idealShiftSeconds: 240,
  } as const;
  const chosen = {
    format: 5,
    formationId: '5v5-1-2-1',
    periodCount: 2,
    periodLengthSeconds: 600,
    idealShiftSeconds: 180,
  } as const;

  test('skriver inte över en spelform tränaren redan valt', () => {
    const merged = applyTeamDefaults(chosen, teamDefaults, new Set(['format']));

    expect(merged.format).toBe(5);
    // Formationen följer spelformen, annars får uppställningen fel antal platser.
    expect(merged.formationId).toBe('5v5-1-2-1');
    // Det tränaren inte rört fylls i från laget.
    expect(merged.periodCount).toBe(3);
  });

  test('fyller i allt från laget när inget är ändrat', () => {
    expect(applyTeamDefaults(chosen, teamDefaults, new Set())).toEqual(teamDefaults);
  });

  test('behåller nuvarande värden när laget saknar förval', () => {
    expect(applyTeamDefaults(chosen, undefined, new Set())).toEqual(chosen);
  });
});
