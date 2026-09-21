import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { MatchConflictPanel } from './match-conflict-panel';

const state = {
  ignored: [
    {
      index: 8,
      reason: 'invalid_transition' as const,
      message: 'technical detail that must not leak',
      raw: {},
    },
  ],
  plannedSubstitutions: [
    {
      planId: '00000000-0000-4000-8000-000000000010',
      plannedBy: 'coach:assistant',
      plannedAt: '2026-09-21T12:00:00.000Z',
      swaps: [
        {
          slotId: 'st',
          outPlayerId: '00000000-0000-4000-8000-000000000011',
          inPlayerId: '00000000-0000-4000-8000-000000000012',
        },
      ],
    },
  ],
  players: {
    '00000000-0000-4000-8000-000000000011': { name: 'Maja' },
    '00000000-0000-4000-8000-000000000012': { name: 'Nora' },
  },
};

test('shows the planner before a planned substitution can be confirmed', () => {
  const confirmed: string[] = [];
  render(
    <MatchConflictPanel
      state={state as never}
      onConfirmPlan={(plan) => confirmed.push(plan.planId)}
    />,
  );

  expect(screen.getByText('Planerat av assisterande tränaren')).toBeDefined();
  expect(screen.getByText('Maja ut · Nora in')).toBeDefined();
  expect(screen.getByRole('button', { name: 'Bekräfta planerat byte' })).toBeDefined();
  expect(screen.queryByText('technical detail that must not leak')).toBeNull();
});
