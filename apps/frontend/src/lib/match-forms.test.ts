import { expect, test } from 'vitest';
import { createMatchFormSchema } from './match-forms';

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
