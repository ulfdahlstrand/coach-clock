import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { MatchEvent } from '@coach-clock/contracts';
import { latestUndoableEvent, MatchEventHistory } from './match-event-history';

const matchId = '00000000-0000-4000-8000-000000000001';
let next = 0;
function event(payload: Record<string, unknown>): MatchEvent {
  next += 1;
  return {
    eventId: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    matchId,
    v: 1,
    at: '2026-09-23T10:00:00.000Z',
    by: 'owner',
    ...payload,
  } as MatchEvent;
}

afterEach(() => cleanup());

describe('ångra senaste', () => {
  const created = event({
    type: 'match_created',
    format: 5,
    formationId: '5v5-1-2-1',
    periods: 2,
    periodLengthSeconds: 600,
    opponent: 'IF',
  });
  const started = event({ type: 'period_started', periodNumber: 1 });
  const paused = event({ type: 'clock_paused', reason: 'Paus' });

  test('pekar på den senaste händelsen', () => {
    expect(latestUndoableEvent([created, started, paused])).toBe(paused);
  });

  test('hoppar över det som redan ångrats', () => {
    const undo = event({ type: 'event_undone', targetEventId: paused.eventId });
    expect(latestUndoableEvent([created, started, paused, undo])).toBe(started);
  });

  test('erbjuder aldrig att ångra matchens grund', () => {
    expect(latestUndoableEvent([created])).toBeUndefined();
  });
});

describe('händelselistan', () => {
  test('ångrar och rättar tid via sina callbacks', () => {
    const started = event({ type: 'period_started', periodNumber: 1 });
    const onUndo = vi.fn();
    const onCorrectTime = vi.fn();
    render(
      <MatchEventHistory
        events={[started]}
        disabled={false}
        onUndo={onUndo}
        onCorrectTime={onCorrectTime}
      />,
    );

    expect(screen.getByText('Period 1 startad')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Ångra' }));
    expect(onUndo).toHaveBeenCalledWith(started);

    fireEvent.click(screen.getByRole('button', { name: 'Rätta tid' }));
    fireEvent.change(screen.getByLabelText('Rätt tidpunkt'), {
      target: { value: '2026-09-23T12:05' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Spara tid' }));
    expect(onCorrectTime).toHaveBeenCalledWith(started, new Date('2026-09-23T12:05').toISOString());
  });
});
