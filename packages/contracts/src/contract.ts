import { oc } from '@orpc/contract';

/**
 * Rotkontraktet för coach-clock.
 *
 * Tomt tills domänens endpoints landar. Allt som läggs till här blir både
 * serverns bindningstabell och klientens typer — kontraktet är enda källan.
 */
export const contract = oc.router({});

export type AppRouter = typeof contract;
