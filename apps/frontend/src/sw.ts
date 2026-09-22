/// <reference lib="webworker" />

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { StaleWhileRevalidate } from 'workbox-strategies';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<unknown>;
};

// Bundled JS/CSS, icons, index.html and the manifest make up the offline app
// shell. They are revisioned by Vite, so precaching them is safe.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

self.addEventListener('message', (event) => {
  const data: unknown = event.data;
  if (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    (data as Record<string, unknown>)['type'] === 'SKIP_WAITING'
  ) {
    void self.skipWaiting();
  }
});

// A direct /matches/:id navigation must receive the cached shell when the
// device is offline. API fetches are not navigation requests and never reach
// this route; their truth lives in the event log/outbox, not Cache Storage.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));

// Only same-origin browser assets are revalidated. Fetch/XHR requests (the
// API, SSE and event writes) have an empty destination and are deliberately
// excluded from every runtime cache.
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    ['style', 'script', 'worker', 'image', 'font'].includes(request.destination),
  new StaleWhileRevalidate({ cacheName: 'coach-clock-static-v1' }),
);

self.addEventListener('push', (event) => {
  const data: unknown = event.data?.json();
  const notification =
    typeof data === 'object' && data !== null
      ? (data as { title?: unknown; body?: unknown; url?: unknown })
      : {};
  event.waitUntil(
    self.registration.showNotification(
      typeof notification.title === 'string' ? notification.title : 'Coach Clock',
      {
        body: typeof notification.body === 'string' ? notification.body : 'Det är dags för byte.',
        icon: '/icons/coach-clock-192.png',
        badge: '/icons/coach-clock-192.png',
        data: { url: typeof notification.url === 'string' ? notification.url : '/' },
        tag: 'coach-clock-substitution',
      },
    ),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? '/';
  event.waitUntil(self.clients.openWindow(url));
});
