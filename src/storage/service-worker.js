// build-offline.mjs prepends the content revision and complete local asset list.
const cachePrefix = `phase10:${self.registration.scope}:`;
const cacheName = cachePrefix + REVISION;
const urls = ASSETS.map(path => new URL(path, self.registration.scope).href);
const allowed = new Set(urls);
const indexUrl = new URL('index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(cacheName);
      await cache.addAll(urls.map(url => new Request(url, { cache: 'reload' })));
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
    // Let an existing game keep its current worker until every app window closes.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(cachePrefix) && name !== cacheName).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.search = '';
  url.hash = '';
  const isHome = event.request.mode === 'navigate' && url.href === self.registration.scope;
  const key = isHome ? indexUrl : url.href;
  if (!allowed.has(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(key);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(key, response.clone());
    return response;
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'OFFLINE_STATUS' || !event.ports[0]) return;
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const keys = new Set((await cache.keys()).map(request => request.url));
    event.ports[0].postMessage({ ready: urls.every(url => keys.has(url)) });
  })());
});
