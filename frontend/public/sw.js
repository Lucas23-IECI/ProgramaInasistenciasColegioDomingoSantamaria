const APP_VERSION = '2026.08.28-cierre-operativo-v1';
const CACHE_VERSION = `ldsm-shell-${APP_VERSION}`;
const APP_SHELL = ['/', '/login', '/manifest.webmanifest', '/institucional/escudo-ldsm-concepcion.jpg'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.source?.postMessage({ type: 'PWA_VERSION', version: APP_VERSION });
});
self.addEventListener('unhandledrejection', (event) => {
  // Una escritura fallida de caché nunca debe interrumpir la aplicación.
  if (/cache|clone|body is already used/i.test(String(event.reason?.message || event.reason || ''))) {
    event.preventDefault();
  }
});

const storeResponse = async (key, response) => {
  if (!response?.ok || response.bodyUsed) return;
  try {
    const copy = response.clone();
    await (await caches.open(CACHE_VERSION)).put(key, copy);
  } catch {
    // La respuesta de red sigue siendo válida aunque el navegador rechace cachearla.
  }
};

const fetchAndStore = async (request, key = request) => {
  const response = await fetch(request);
  await storeResponse(key, response);
  return response;
};

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetchAndStore(request, '/').catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/institucional/') || url.pathname.startsWith('/pwa/')) {
    // Los bundles con hash se consultan primero en red para no conservar HTML/JS
    // incompatible después de una actualización. La caché queda como respaldo.
    event.respondWith(fetchAndStore(request).catch(() => caches.match(request)));
  }
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/admin';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const current = clients.find((client) => 'focus' in client);
    if (current) {
      current.navigate(target);
      return current.focus();
    }
    return self.clients.openWindow(target);
  }));
});
