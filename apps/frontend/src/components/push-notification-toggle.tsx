import { useState } from 'react';
import { BellIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';
import { createPushSubscription, getPushSupport } from '@/lib/push-notifications';

export function PushNotificationToggle({ matchId }: { readonly matchId: string }) {
  const [message, setMessage] = useState<string | undefined>();
  const support = getPushSupport();
  if (!support.supported) {
    return <p className="text-muted-foreground text-sm">{support.reason}</p>;
  }
  async function enable(): Promise<void> {
    try {
      const subscription = await createPushSubscription();
      const json = subscription.toJSON();
      if (
        json.endpoint === undefined ||
        json.keys?.p256dh === undefined ||
        json.keys.auth === undefined
      ) {
        throw new Error('Kunde inte läsa notisprenumerationen.');
      }
      await apiClient.matches.pushSubscribe({
        matchId,
        subscription: {
          endpoint: json.endpoint,
          expirationTime: json.expirationTime ?? null,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        },
      });
      setMessage('Bytesnotiser är aktiverade på den här enheten.');
    } catch (error: unknown) {
      setMessage(error instanceof Error ? error.message : 'Kunde inte aktivera notiser.');
    }
  }
  return (
    <div className="rounded-2xl border border-white/10 bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-semibold">Bytesnotiser</p>
          <p className="text-muted-foreground text-sm">
            Få en notis när det är dags för ett rättvist byte, även med skärmen släckt.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void enable()}>
          <BellIcon aria-hidden="true" /> Aktivera
        </Button>
      </div>
      {message === undefined ? null : (
        <p role="status" className="mt-3 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
