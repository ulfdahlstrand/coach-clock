import { describe, expect, it } from 'vitest';
import { addPendingSwap, plannerName, removePendingSwap } from './substitution-flow';

const first = { slotId: 'left', outPlayerId: 'out-1', inPlayerId: 'in-1' };
const second = { slotId: 'right', outPlayerId: 'out-2', inPlayerId: 'in-2' };

describe('substitution flow helpers', () => {
  it('creates independent multi-player plans without duplicate people or slots', () => {
    expect(addPendingSwap([first], second)).toEqual([first, second]);
    expect(addPendingSwap([first], { ...second, inPlayerId: 'in-1' })).toEqual([first]);
    expect(addPendingSwap([first], { ...second, slotId: 'left' })).toEqual([first]);
  });

  it('removes a single planned pair and labels planners clearly', () => {
    expect(removePendingSwap([first, second], 'left')).toEqual([second]);
    expect(plannerName('owner')).toBe('Du');
    expect(plannerName('coach:alex')).toBe('Tränare alex');
  });
});
