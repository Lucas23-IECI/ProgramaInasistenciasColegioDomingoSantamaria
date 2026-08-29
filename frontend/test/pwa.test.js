import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(frontendRoot, relative), 'utf8');

test('el manifiesto permite instalar la aplicación con identidad institucional', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest'));
  assert.equal(manifest.lang, 'es-CL');
  assert.equal(manifest.display, 'standalone');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512'));
});

test('el service worker nunca almacena respuestas de la API', () => {
  const worker = read('public/sw.js');
  assert.match(worker, /url\.pathname\.startsWith\('\/api\/'\)/u);
  assert.match(worker, /request\.mode === 'navigate'/u);
  assert.match(worker, /caches\.match\('\/'\)/u);
});

test('el service worker tolera respuestas consumidas y prioriza bundles vigentes', () => {
  const worker = read('public/sw.js');
  assert.match(worker, /if \(!response\?\.ok \|\| response\.bodyUsed\) return/u);
  assert.match(worker, /try \{[\s\S]*response\.clone\(\)[\s\S]*\} catch \{/u);
  assert.match(worker, /event\.respondWith\(fetchAndStore\(request\)\.catch\(\(\) => caches\.match\(request\)\)\)/u);
  assert.doesNotMatch(worker, /cached \|\| fetch\(request\)/u);
});

test('las actualizaciones esperan confirmación y conservan la cola IndexedDB', () => {
  const worker = read('public/sw.js');
  const registration = read('src/pwa/registerServiceWorker.js');
  const release = read('src/releaseNotes.js');
  const workerVersion = worker.match(/const APP_VERSION = '([^']+)'/u)?.[1];
  const releaseVersion = release.match(/id: '([^']+)'/u)?.[1];
  assert.match(workerVersion, /^\d{4}\.\d{2}\.\d{2}-[a-z0-9-]+$/u);
  assert.equal(workerVersion, releaseVersion);
  assert.match(worker, /event\.data\?\.type === 'SKIP_WAITING'/u);
  assert.doesNotMatch(worker, /cache\.addAll\(APP_SHELL\)\)\.then\(\(\) => self\.skipWaiting/u);
  assert.match(registration, /updateAvailable: true/u);
  assert.match(registration, /refreshRequested = true/u);
  assert.match(registration, /registration\.waiting\.postMessage\(\{ type: 'SKIP_WAITING' \}\)/u);
  assert.doesNotMatch(registration, /indexedDB\.deleteDatabase/u);
});

test('la instalación visible funciona en escritorio, Android e iOS con el escudo oficial', () => {
  const registration = read('src/pwa/registerServiceWorker.js');
  const experience = read('src/components/PwaExperience.jsx');
  const tools = read('src/components/GlobalTools.jsx');
  assert.match(registration, /beforeinstallprompt/u);
  assert.match(registration, /appinstalled/u);
  assert.match(experience, /Agregar a pantalla de inicio/u);
  assert.match(experience, /escudo-ldsm-concepcion\.jpg/u);
  assert.match(experience, /Aplicación instalada/u);
  assert.match(experience, /La instalación está bloqueada en esta dirección/u);
  assert.match(experience, /No se descargó ningún archivo/u);
  assert.match(tools, /Instalar aplicación/u);
});

test('nginx sirve correctamente el manifiesto, actualizaciones y cámara del mismo origen', () => {
  for (const config of ['frontend.conf', 'frontend.https.conf']) {
    const nginx = read(config);
    assert.match(nginx, /location = \/manifest\.webmanifest[\s\S]*application\/manifest\+json/u);
    assert.match(nginx, /location = \/sw\.js[\s\S]*no-store, no-cache, must-revalidate/u);
    assert.match(nginx, /Permissions-Policy "camera=\(self\), microphone=\(\), geolocation=\(\)"/u);
    assert.doesNotMatch(nginx, /camera=\(\)/u);
  }
  assert.doesNotMatch(read('frontend.https.conf'), /Strict-Transport-Security/u);
});

test('la cola sin conexión es FIFO y elimina operaciones ya reconciliadas', () => {
  const store = read('src/pwa/offlineStore.js');
  assert.match(store, /capturado_en\.localeCompare/u);
  assert.match(store, /offline_operation_id/u);
  assert.match(store, /isDuplicateRegistrationError\(error\)/u);
  assert.doesNotMatch(store, /error\?\.response\?\.status === 409/u);
  assert.match(store, /store\.delete\(item\.offline_operation_id\)/u);
  assert.match(store, /punctualitySyncHistory/u);
  assert.match(store, /sync_status === 'FALLIDO'/u);
  assert.match(store, /retryOfflineRegistration/u);
  assert.match(store, /getOfflineQueueSnapshot/u);
});

test('la PWA muestra una bandeja paginada y permite reintentos seguros', () => {
  const experience = read('src/components/PwaExperience.jsx');
  const panel = read('src/components/OfflineSyncPanel.jsx');
  assert.match(experience, /<OfflineSyncPanel/u);
  assert.match(panel, /Bandeja de sincronización/u);
  assert.match(panel, /Pendientes/u);
  assert.match(panel, /Con error/u);
  assert.match(panel, /Sincronizados/u);
  assert.match(panel, /Página \{page\} de \{pages\}/u);
  assert.match(panel, /retryOfflineRegistration/u);
  assert.match(panel, /sin crear duplicados/u);
});

test('solo el terminal de puntualidad incorpora la cola diferida', () => {
  const scanner = read('src/components/BarcodeScanner.jsx');
  assert.match(scanner, /queueOfflineRegistration/u);
  assert.match(scanner, /Pendiente de sincronización/u);
  assert.match(scanner, /flushOfflineRegistrations/u);
  assert.match(scanner, /Revisar bandeja/u);
  assert.doesNotMatch(read('src/VisitsAdmin.jsx'), /queueOfflineRegistration/u);
});

test('los avisos de sincronización son opcionales y requieren permiso explícito', () => {
  const registration = read('src/pwa/registerServiceWorker.js');
  const scanner = read('src/components/BarcodeScanner.jsx');
  assert.match(registration, /Notification\.requestPermission\(\)/u);
  assert.match(registration, /Notification\.permission !== 'granted'/u);
  assert.match(registration, /showNotification\('Registros sincronizados'/u);
  assert.match(scanner, /Avisarme al sincronizar/u);
});
