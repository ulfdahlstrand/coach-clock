import { isContractProcedure, oc } from '@orpc/contract';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { contract } from './index.js';

describe('contract', () => {
  it('är tomt tills domänens endpoints landar', () => {
    expect(Object.keys(contract)).toHaveLength(0);
  });

  it('tar emot procedurer validerade med Zod 4', () => {
    const extended = oc.router({
      ping: oc.input(z.object({ name: z.string() })).output(z.string()),
    });

    expect(isContractProcedure(extended.ping)).toBe(true);
  });
});
