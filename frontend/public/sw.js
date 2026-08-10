const APP_VERSION = '2026.08.09-seguimiento-chat-v1';
const CACHE_VERSION = `ldsm-shell-${APP_VERSION}`;
const APP_SHELL = ['/', '/login', '/manifest.webmanifest', '/institucional/escudo-ldsm-concepcion.jpg'];
self.addEventListener('install', (event) => event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_VERSION') event.source?.postMessage({ type: 'PWA_VERSION', version: APP_VERSION });
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => { const copy = response.clone(); caches.open(CACHE_VERSION).then((cache) => cache.put('/', copy)); return response; }).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/institucional/') || url.pathname.startsWith('/pwa/')) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => { if (response.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(request, response.clone())); return response; })));
  }
});
