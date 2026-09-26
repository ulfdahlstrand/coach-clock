import { contract } from '@coach-clock/contracts';
import { ORPCError, implement } from '@orpc/server';
import type { Kysely, Updateable } from 'kysely';
import { requireUser } from '../auth/require-user.js';
import { toPlayer, toTeam, type Database, type PlayerTable } from '../db/types.js';
import type { ApiContext } from './matches.js';

const os = implement(contract).$context<ApiContext>();

/**
 * Laget måste finnas och tillhöra tränaren. Någon annans lag svarar exakt som
 * ett lag som inte finns, så att lag-id:n inte kan sonderas.
 */
async function requireOwnedTeam(
  db: Kysely<Database>,
  teamId: string,
  userId: string,
): Promise<void> {
  const team = await db
    .selectFrom('teams')
    .select('id')
    .where('id', '=', teamId)
    .where('owner_user_id', '=', userId)
    .executeTakeFirst();

  if (team === undefined) {
    throw new ORPCError('NOT_FOUND', { message: 'Laget finns inte' });
  }
}

export const listTeams = os.listTeams.handler(async ({ context }) => {
  const user = requireUser(context);
  const rows = await context.db
    .selectFrom('teams')
    .selectAll()
    .where('owner_user_id', '=', user.id)
    .orderBy('created_at')
    .orderBy('id')
    .execute();

  return rows.map(toTeam);
});

export const createTeam = os.createTeam.handler(async ({ input, context }) => {
  const user = requireUser(context);
  const row = await context.db
    .insertInto('teams')
    .values({ name: input.name, owner_user_id: user.id })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toTeam(row);
});

export const listPlayers = os.listPlayers.handler(async ({ input, context }) => {
  const user = requireUser(context);
  const db = context.db;
  await requireOwnedTeam(db, input.teamId, user.id);

  const rows = await db
    .selectFrom('players')
    .selectAll()
    .where('team_id', '=', input.teamId)
    .orderBy('archived')
    .orderBy('name')
    .orderBy('id')
    .execute();

  return rows.map(toPlayer);
});

export const createPlayer = os.createPlayer.handler(async ({ input, context }) => {
  const user = requireUser(context);
  const db = context.db;
  await requireOwnedTeam(db, input.teamId, user.id);

  const row = await db
    .insertInto('players')
    .values({
      team_id: input.teamId,
      name: input.name,
      number: input.number ?? null,
      is_goalkeeper: input.isGoalkeeper ?? false,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toPlayer(row);
});

export const updatePlayer = os.updatePlayer.handler(async ({ input, context }) => {
  const user = requireUser(context);
  await requireOwnedTeam(context.db, input.teamId, user.id);
  const updates: Updateable<PlayerTable> = {};

  if (input.name !== undefined) updates.name = input.name;
  if (input.number !== undefined) updates.number = input.number;
  if (input.isGoalkeeper !== undefined) updates.is_goalkeeper = input.isGoalkeeper;
  if (input.archived !== undefined) updates.archived = input.archived;

  const row = await context.db
    .updateTable('players')
    .set(updates)
    .where('id', '=', input.playerId)
    .where('team_id', '=', input.teamId)
    .returningAll()
    .executeTakeFirst();

  if (row === undefined) {
    throw new ORPCError('NOT_FOUND', { message: 'Spelaren finns inte i laget' });
  }

  return toPlayer(row);
});
