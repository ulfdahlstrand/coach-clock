import { expect, test } from 'vitest';
import {
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

test('tom motståndare ger ett svenskt meddelande, inte Zods engelska standardtext', () => {
  const parsed = createMatchFormSchema.safeParse({
    teamId: '00000000-0000-4000-8000-000000000001',
    opponent: '',
    format: 5,
    formationId: '5v5-1-2-1',
    periodCount: 3,
    periodLengthSeconds: 600,
    presentPlayerIds: ['00000000-0000-4000-8000-000000000002'],
    assignments: [{ slotId: 'gk', playerId: '00000000-0000-4000-8000-000000000002' }],
  });

  // Formuläret visar meddelandet rakt av, så det måste gå att läsa för en tränare.
  expect(parsed.error?.issues[0]?.message).toBe('Ange motståndare');
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
