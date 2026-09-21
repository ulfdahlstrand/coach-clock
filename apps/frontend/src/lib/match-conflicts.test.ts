import { describe, expect, test } from 'vitest';
import { describeIgnoredEvent, plannedSwapDescription, plannerLabel } from './match-conflicts';

describe('conflict presentation', () => {
  test('translates folded reasons into helpful Swedish prose without raw reason codes', () => {
    const presentation = describeIgnoredEvent({
      index: 3,
      reason: 'invalid_transition',
      message: 'Anna spelar redan på st',
      raw: {},
    });

    expect(presentation.title).toBe('Ett byte eller en matchåtgärd gick inte att genomföra');
    expect(presentation.description).not.toContain('invalid_transition');
    expect(presentation.description).not.toContain('Anna spelar redan på st');
  });

  test('makes planner identities and swaps readable before confirmation', () => {
    expect(plannerLabel('coach:assistant')).toBe('assisterande tränaren');
    expect(
      plannedSwapDescription(
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
        (playerId) => (playerId.endsWith('11') ? 'Maja' : 'Nora'),
      ),
    ).toBe('Maja ut · Nora in');
  });
});
