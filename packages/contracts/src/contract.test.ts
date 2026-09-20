import { isContractProcedure, oc } from '@orpc/contract';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contract, createPlayerInputSchema, updatePlayerInputSchema } from './index.js';

describe('contract', () => {
  it('exponerar lag- och spelarprocedurerna', () => {
    expect(Object.keys(contract)).toEqual([
      'listTeams',
      'createTeam',
      'listPlayers',
      'createPlayer',
      'updatePlayer',
    ]);

    for (const procedure of Object.values(contract)) {
      expect(isContractProcedure(procedure)).toBe(true);
    }
  });

  it('tar emot procedurer validerade med Zod 4', () => {
    const extended = oc.router({
      ping: oc.input(z.object({ name: z.string() })).output(z.string()),
    });

    expect(isContractProcedure(extended.ping)).toBe(true);
  });

  it('validerar spelarens tröjnummer och kräver en faktisk uppdatering', () => {
    const teamId = '00000000-0000-4000-8000-000000000001';
    const playerId = '00000000-0000-4000-8000-000000000002';

    expect(createPlayerInputSchema.safeParse({ teamId, name: 'Alva', number: 0 }).success).toBe(
      false,
    );
    expect(updatePlayerInputSchema.safeParse({ teamId, playerId }).success).toBe(false);
    expect(updatePlayerInputSchema.safeParse({ teamId, playerId, archived: true }).success).toBe(
      true,
    );
  });
});
