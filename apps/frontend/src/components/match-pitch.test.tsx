import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FORMATIONS, deriveMatchState, type MatchEvent } from '@coach-clock/contracts';
import { formationAssignments, MatchPitch, playerInitials } from './match-pitch';

const at = '2026-09-21T10:00:00.000Z';
const base = { v: 1 as const, matchId: '00000000-0000-4000-8000-000000000001', by: 'owner', at };

describe('match pitch', () => {
  it('keeps the current players while making assignments for another formation', () => {
    const formation = FORMATIONS.find((item) => item.id === '7v7-3-2-1');
    expect(formation).toBeDefined();
    if (formation === undefined) return;

    const assignments = formationAssignments(formation, {
      gk: 'a',
      'cb-left': 'b',
      'cb-right': 'c',
      lm: 'd',
      cm: 'e',
      rm: 'f',
      st: 'g',
    });

    expect(assignments.map((assignment) => assignment.playerId).sort()).toEqual([
      'a',
      'b',
      'c',
      'd',
      'e',
      'f',
      'g',
    ]);
  });

  it('renders named, touchable player tiles from formation coordinates', () => {
    const formation = FORMATIONS.find((item) => item.id === '5v5-1-2-1');
    expect(formation).toBeDefined();
    if (formation === undefined) return;
    const state = deriveMatchState(
      [
        {
          ...base,
          eventId: '00000000-0000-4000-8000-000000000001',
          type: 'match_created',
          format: 5,
          formationId: formation.id,
          periods: 3,
          periodLengthSeconds: 900,
          opponent: 'IF',
        } as MatchEvent,
        {
          ...base,
          eventId: '00000000-0000-4000-8000-000000000002',
          type: 'squad_set',
          players: [
            {
              playerId: '00000000-0000-4000-8000-000000000011',
              name: 'Ada Lovelace',
              number: 7,
              isGoalkeeper: false,
            },
            {
              playerId: '00000000-0000-4000-8000-000000000012',
              name: 'Bea',
              number: 1,
              isGoalkeeper: true,
            },
          ],
        } as MatchEvent,
        {
          ...base,
          eventId: '00000000-0000-4000-8000-000000000003',
          type: 'lineup_set',
          assignments: [
            { slotId: 'gk', playerId: '00000000-0000-4000-8000-000000000012' },
            { slotId: 'cb', playerId: '00000000-0000-4000-8000-000000000011' },
          ],
          bench: [],
        } as MatchEvent,
      ],
      new Date(at),
    );
    const select = vi.fn();
    render(
      <MatchPitch
        formation={formation}
        state={state}
        selectedSlotId={undefined}
        onSelectSlot={select}
      />,
    );

    expect(screen.getByRole('button', { name: 'MB, Ada Lovelace' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'MV, Bea' })).toBeDefined();
  });

  it('uses readable initials for compact pitch identifiers', () => {
    expect(playerInitials(' Ada Lovelace ')).toBe('AL');
  });
});
