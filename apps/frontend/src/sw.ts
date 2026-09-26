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
//
// /api/* is the exception: signing in navigates the whole page to
// /api/auth/google, and the redirect back from Google lands on
// /api/auth/google/callback. Both must reach the network — answered with the
// cached shell, sign-in would silently never happen.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//] }),
);

// Only same-origin browser assets are revalidated. Fetch/XHR requests (the
// API, SSE and event writes) have an empty destination and are deliberately
// excluded from every runtime cache.
registerRoute(
  ({ request, url }) =>
    url.origin === self.location.origin &&
    ['style', 'script', 'worker', 'image', 'font'].includes(request.destination),
  new StaleWhileRevalidate({ cacheName: 'coach-clock-static-v1' }),
);
