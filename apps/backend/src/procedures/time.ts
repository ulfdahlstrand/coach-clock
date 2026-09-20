import { contract } from '@coach-clock/contracts';
import { implement } from '@orpc/server';
import type { ApiContext } from './matches.js';

const os = implement(contract).$context<ApiContext>();

/** Publik serverklocka för klienternas offsetmätning. */
export const getServerTime = os.time.handler(({ context }) => ({
  now: context.now().toISOString(),
}));
