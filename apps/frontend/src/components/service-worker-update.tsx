import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { liveMatchUpdateGuard } from '@/lib/live-match-update-guard';

type UpdateServiceWorker = () => void;

/** Offers an update only after the active match has stopped. */
export function ServiceWorkerUpdate() {
  const [updateServiceWorker, setUpdateServiceWorker] = useState<UpdateServiceWorker>();
  const [waiting, setWaiting] = useState(false);
  const [matchIsLive, setMatchIsLive] = useState(liveMatchUpdateGuard.isLive);

  useEffect(
    () => liveMatchUpdateGuard.subscribe(() => setMatchIsLive(liveMatchUpdateGuard.isLive())),
    [],
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let registration: ServiceWorkerRegistration | undefined;
    let disposed = false;
    const showWhenWaiting = () => {
      if (!disposed && registration?.waiting !== undefined) setWaiting(true);
    };
    const onControllerChange = () => window.location.reload();

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((registered) => {
        registration = registered;
        showWhenWaiting();
        registered.addEventListener('updatefound', () => {
          const installing = registered.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller !== null) {
              showWhenWaiting();
            }
          });
        });
        setUpdateServiceWorker(
          () => () => registration?.waiting?.postMessage({ type: 'SKIP_WAITING' }),
        );
      })
      .catch(() => {
        // Installability is progressive enhancement; the normal app still works.
      });

    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  if (!waiting || matchIsLive || updateServiceWorker === undefined) return null;

  return (
    <aside className="install-prompt" aria-label="Uppdatering tillgänglig">
      <div>
        <p className="install-prompt-title">En uppdatering är redo</p>
        <p className="install-prompt-copy">Ladda om när det passar dig.</p>
      </div>
      <Button onClick={updateServiceWorker}>Ladda om</Button>
    </aside>
  );
}
