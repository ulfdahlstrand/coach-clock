import webpush from 'web-push';
import { deriveFairnessState, type MatchEvent } from '@coach-clock/contracts';
import type { Kysely } from 'kysely';
import type { Env } from './env.js';
import { readMatchEventsSince } from './match-events.js';
import type { Database } from './db/types.js';

export interface PushNotifier {
  notifyWhenSwapDue(matchId: string, now: Date): Promise<void>;
}

export const noPushNotifier: PushNotifier = { notifyWhenSwapDue: () => Promise.resolve() };

const NOTIFICATION_COOLDOWN_MS = 90_000;

/** VAPID konfigureras enbart från env vid uppstart. */
export function createPushNotifier(env: Env, db: Kysely<Database>): PushNotifier {
  if (env.vapid === undefined) return noPushNotifier;
  webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey);

  return {
    async notifyWhenSwapDue(matchId, now) {
      const events = await readMatchEventsSince(db, matchId, 0);
      const fairness = deriveFairnessState(
        events.map((entry) => entry.event),
        now,
      );
      if (!fairness.substitutionDue || fairness.suggestedSubstitution === null) return;

      const subscriptions = await db
        .selectFrom('push_subscriptions as subscription')
        .innerJoin('participants as participant', 'participant.id', 'subscription.participant_id')
        .select([
          'subscription.id',
          'subscription.endpoint',
          'subscription.p256dh',
          'subscription.auth',
        ])
        .where('participant.match_id', '=', matchId)
        .where((eb) =>
          eb.or([
            eb('subscription.last_notified_at', 'is', null),
            eb(
              'subscription.last_notified_at',
              '<=',
              new Date(now.getTime() - NOTIFICATION_COOLDOWN_MS),
            ),
          ]),
        )
        .execute();
      const message = JSON.stringify({
        title: 'Dags för byte',
        body: 'Rättvisemotorn föreslår ett byte.',
        matchId,
        url: `/matches/${matchId}`,
      });

      await Promise.all(
        subscriptions.map(async (subscription) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              message,
              { TTL: 120, urgency: 'high' },
            );
            await db
              .updateTable('push_subscriptions')
              .set({ last_notified_at: now })
              .where('id', '=', subscription.id)
              .execute();
          } catch (error: unknown) {
            const statusCode =
              typeof error === 'object' && error !== null && 'statusCode' in error
                ? (error as { statusCode?: unknown }).statusCode
                : undefined;
            // En utgången prenumeration ska inte generera återkommande fel eller lagras för evigt.
            if (statusCode === 404 || statusCode === 410) {
              await db.deleteFrom('push_subscriptions').where('id', '=', subscription.id).execute();
            }
          }
        }),
      );
    },
  };
}

export function isSwapDue(events: readonly MatchEvent[], now: Date): boolean {
  return deriveFairnessState(events, now).substitutionDue;
}
