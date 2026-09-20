import { isContractProcedure, oc } from '@orpc/contract';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contract } from './index.js';

describe('contract', () => {
  it('exponerar append-proceduren', () => {
    expect(isContractProcedure(contract.matches.events)).toBe(true);
    expect(contract.matches.events['~orpc'].route).toMatchObject({
      method: 'POST',
      path: '/matches/events',
    });
  });

  it('exponerar läsprocedurerna på sina HTTP-routes', () => {
    expect(contract.matches.get['~orpc'].route).toMatchObject({
      method: 'GET',
      path: '/matches',
    });
    expect(contract.matches.listEvents['~orpc'].route).toMatchObject({
      method: 'GET',
      path: '/matches/events',
    });
    expect(contract.time['~orpc'].route).toMatchObject({ method: 'GET', path: '/time' });
  });

  it('tar emot procedurer validerade med Zod 4', () => {
    const extended = oc.router({
      ping: oc.input(z.object({ name: z.string() })).output(z.string()),
    });

    expect(isContractProcedure(extended.ping)).toBe(true);
  });
});
