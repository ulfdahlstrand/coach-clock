/// <reference lib="webworker" />

const worker = globalThis as unknown as ServiceWorkerGlobalScope;

// #35 deliberately keeps the worker free of fetch handling and caching. The
// offline caching policy is introduced separately in #36.
worker.addEventListener('install', () => {
  void worker.skipWaiting();
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(worker.clients.claim());
});
