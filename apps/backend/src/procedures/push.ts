import { createHash } from 'node:crypto';
import { contract } from '@coach-clock/contracts';
import { ORPCError, implement } from '@orpc/server';
import type { ApiContext } from './matches.js';

const os = implement(contract).$context<ApiContext>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function currentParticipant(context: ApiContext, matchId: string) {
  if (context.participantToken === undefined) {
    throw new ORPCError('UNAUTHORIZED', { message: 'Gå med i matchen först' });
  }
  const participant = await context.db
    .selectFrom('participants')
    .select('id')
    .where('match_id', '=', matchId)
    .where('token_hash', '=', hash(context.participantToken))
    .executeTakeFirst();
  if (participant === undefined) {
    throw new ORPCError('FORBIDDEN', { message: 'Deltagarsessionen gäller inte matchen' });
  }
  return participant;
}

export const subscribeToPush = os.matches.pushSubscribe.handler(async ({ input, context }) => {
  const participant = await currentParticipant(context, input.matchId);
  await context.db
    .insertInto('push_subscriptions')
    .values({
      participant_id: participant.id,
      endpoint: input.subscription.endpoint,
      p256dh: input.subscription.keys.p256dh,
      auth: input.subscription.keys.auth,
      expiration_time:
        input.subscription.expirationTime === null
          ? null
          : new Date(input.subscription.expirationTime),
    })
    .onConflict((conflict) =>
      conflict.column('endpoint').doUpdateSet({
        participant_id: participant.id,
        p256dh: input.subscription.keys.p256dh,
        auth: input.subscription.keys.auth,
        expiration_time:
          input.subscription.expirationTime === null
            ? null
            : new Date(input.subscription.expirationTime),
      }),
    )
    .execute();
  return { enabled: true } as const;
});

export const unsubscribeFromPush = os.matches.pushUnsubscribe.handler(
  async ({ input, context }) => {
    const participant = await currentParticipant(context, input.matchId);
    await context.db
      .deleteFrom('push_subscriptions')
      .where('participant_id', '=', participant.id)
      .where('endpoint', '=', input.endpoint)
      .execute();
    return { enabled: false } as const;
  },
);
