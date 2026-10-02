/* global process */
import { test, expect } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dismissReleaseNotes } from './helpers.js';

test.use({ serviceWorkers: 'allow' });

// Origen desechable: proxy al sistema real; solo permite alternar los bytes de
// sw.js entre dos versiones. No intercepta ni simula respuestas de la API.
const createWorkerOrigin = async (baseURL, previous = false) => {
  const source = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const deployed = await fetch(new URL('/sw.js', baseURL));
  expect(deployed.status).toBe(200);
  expect((await deployed.text()).trim()).toBe(source.trim());
  const version = source.match(/const APP_VERSION = '([^']+)'/u)[1];
  let worker = previous ? source.replace(version, 'qa-version-anterior') : source;
  const upstream = new URL(baseURL);
  const server = http.createServer((request, response) => {
    if (request.url === '/sw.js') {
      response.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
      response.end(worker);
      return;
    }
    const forwarded = http.request(new URL(request.url, upstream), {
      method: request.method,
      headers: { ...request.headers, host: upstream.host, ...(request.headers.origin ? { origin: upstream.origin } : {}) }
    }, (result) => {
      response.writeHead(result.statusCode, result.headers);
      result.pipe(response);
    });
    forwarded.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    response.on('close', () => forwarded.destroy());
    request.pipe(forwarded);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    version,
    update: () => { worker = source; },
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); })
  };
};

const openAuthenticated = async (page, origin) => {
  expect(process.env.DEFAULT_USER_PASSWORD, 'Se requiere la cuenta QA para probar la sesión real').toBeTruthy();
  const login = await page.request.post(`${origin}/api/auth/login`, { data: {
    correo: process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local', password: process.env.DEFAULT_USER_PASSWORD
  } });
  expect(login.status()).toBe(200);
  await page.goto(`${origin}/admin/recursos`);
  await dismissReleaseNotes(page);
  await expect(page.getByRole('heading', { name: 'Recursos internos', exact: true })).toBeVisible();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  // La primera visita puede terminar antes de clients.claim; la segunda calienta
  // efectivamente los bundles a través del worker ya activo.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Recursos internos', exact: true })).toBeVisible();
};

const workerVersion = (page) => page.evaluate(() => new Promise((resolve) => {
  const handler = (event) => {
    if (event.data?.type !== 'PWA_VERSION') return;
    navigator.serviceWorker.removeEventListener('message', handler);
    resolve(event.data.version);
  };
  navigator.serviceWorker.addEventListener('message', handler);
  navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' });
}));

test('PWA real recupera el módulo tras un corte sin cachear datos privados ni fingir logout', async ({ page, context, baseURL }, testInfo) => {
  const fixture = await createWorkerOrigin(baseURL);
  try {
    await page.goto(`${fixture.origin}/healthz`);
    await page.evaluate(async () => {
      const cache = await caches.open('qa-cache-ajena');
      await cache.put('/', new Response('Esta no es la aplicación', { headers: { 'Content-Type': 'text/html' } }));
    });
    await openAuthenticated(page, fixture.origin);
    expect(await workerVersion(page)).toBe(fixture.version);
    const online = await page.evaluate(async () => (await fetch('/api/auth/me')).status);
    expect(online).toBe(200);
    await context.setOffline(true);
    expect(await page.evaluate(() => fetch('/api/auth/me').then(() => 'red', () => 'sin conexión'))).toBe('sin conexión');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'No pudimos verificar tu sesión' })).toBeVisible();
    await expect(page).toHaveURL(`${fixture.origin}/admin/recursos`);
    await expect(page.getByRole('button', { name: 'Ingresar al sistema' })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('pwa-offline-real.png') });
    await context.setOffline(false);
    await page.getByRole('button', { name: 'Reintentar conexión' }).click();
    await expect(page.getByRole('heading', { name: 'Recursos internos', exact: true })).toBeVisible();
    const cached = await page.evaluate(async () => {
      const entries = await Promise.all((await caches.keys()).map(async (key) => (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname)));
      return entries.flat();
    });
    expect(cached.some((url) => url.startsWith('/assets/'))).toBe(true);
    expect(cached.filter((url) => url.startsWith('/api/'))).toEqual([]);
  } finally {
    await context.setOffline(false);
    await fixture.close();
  }
});

test('PWA real actualiza solo al confirmar y conserva IndexedDB y cachés ajenas', async ({ page, baseURL }, testInfo) => {
  const fixture = await createWorkerOrigin(baseURL, true);
  try {
    await openAuthenticated(page, fixture.origin);
    expect(await workerVersion(page)).toBe('qa-version-anterior');
    await page.evaluate(async () => {
      await caches.open('qa-cache-ajena');
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('ldsm-operacion-segura', 2);
        request.onupgradeneeded = () => {
          for (const [name, keyPath] of [['roster', 'id_alumno'], ['punctualityQueue', 'offline_operation_id'], ['punctualitySyncHistory', 'offline_operation_id']]) {
            if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath });
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('punctualityQueue', 'readwrite');
          tx.objectStore('punctualityQueue').put({ offline_operation_id: 'qa-update-preservation', sync_status: 'FALLIDO', intentos: 1, capturado_en: '2026-09-23T12:00:00Z' });
          tx.objectStore('punctualityQueue').put({ offline_operation_id: 'qa-pending-preservation', sync_status: 'PENDIENTE', intentos: 0, capturado_en: '2026-09-23T12:01:00Z' });
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      });
    });
    fixture.update();
    await page.evaluate(async () => (await navigator.serviceWorker.ready).update());
    await expect(page.getByText('Nueva versión disponible', { exact: true })).toBeVisible();
    expect(await workerVersion(page)).toBe('qa-version-anterior');
    await page.screenshot({ path: testInfo.outputPath('pwa-actualizacion-pendiente.png') });
    await Promise.all([
      page.waitForEvent('load'),
      page.locator('.pwa-update-banner').getByRole('button', { name: 'Actualizar ahora' }).click()
    ]);
    await expect(page.getByRole('heading', { name: 'Recursos internos', exact: true })).toBeVisible();
    expect(await workerVersion(page)).toBe(fixture.version);
    await expect(page.getByText('Nueva versión disponible', { exact: true })).toHaveCount(0);
    const keys = await page.evaluate(() => caches.keys());
    expect(keys).toContain(`ldsm-shell-${fixture.version}`);
    expect(keys).not.toContain('ldsm-shell-qa-version-anterior');
    expect(keys).toContain('qa-cache-ajena');
    const preserved = await page.evaluate(() => new Promise((resolve, reject) => {
      const request = indexedDB.open('ldsm-operacion-segura', 2);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction('punctualityQueue').objectStore('punctualityQueue').getAll();
        read.onsuccess = () => { db.close(); resolve(read.result); };
        read.onerror = () => reject(read.error);
      };
    }));
    expect(preserved).toEqual(expect.arrayContaining([
      expect.objectContaining({ offline_operation_id: 'qa-update-preservation', sync_status: 'FALLIDO', intentos: 1 }),
      expect.objectContaining({ offline_operation_id: 'qa-pending-preservation', sync_status: 'PENDIENTE', intentos: 0 })
    ]));
  } finally {
    await fixture.close();
  }
});
