/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissReleaseNotes } from './helpers.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const password = process.env.DEFAULT_USER_PASSWORD;

const login = async (page) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la prueba local.');
  const response = await page.context().request.post('/api/auth/login', {
    data: { correo: adminEmail, password },
  });
  expect(response.ok(), `El acceso de prueba respondió ${response.status()}.`).toBe(true);
  await page.goto('/admin/analiticas');
  await dismissReleaseNotes(page);
};

const seedOfflineQueue = async (page) => page.evaluate(async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('ldsm-operacion-segura', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('roster')) db.createObjectStore('roster', { keyPath: 'id_alumno' });
      if (!db.objectStoreNames.contains('punctualityQueue')) db.createObjectStore('punctualityQueue', { keyPath: 'offline_operation_id' });
      if (!db.objectStoreNames.contains('punctualitySyncHistory')) db.createObjectStore('punctualitySyncHistory', { keyPath: 'offline_operation_id' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['roster', 'punctualityQueue', 'punctualitySyncHistory'], 'readwrite');
      tx.objectStore('roster').put({ id_alumno: 901, nombres: 'Camila', paterno: 'Prueba', materno: '', nombre_curso: '3° Básico', search_tokens: ['901'] });
      tx.objectStore('roster').put({ id_alumno: 902, nombres: 'Tomás', paterno: 'Prueba', materno: '', nombre_curso: '4° Básico', search_tokens: ['902'] });
      tx.objectStore('punctualityQueue').put({ offline_operation_id: 'pending-1', id_alumno: 901, capturado_en: '2026-08-30T10:00:00Z', sync_status: 'PENDIENTE', intentos: 0 });
      tx.objectStore('punctualityQueue').put({ offline_operation_id: 'failed-1', id_alumno: 902, capturado_en: '2026-08-30T10:05:00Z', sync_status: 'FALLIDO', intentos: 1, ultimo_error_publico: 'El control horario ya no está disponible para este registro.' });
      tx.objectStore('punctualitySyncHistory').put({ offline_operation_id: 'synced-1', id_alumno: 901, capturado_en: '2026-08-29T10:00:00Z', finalizado_en: '2026-08-29T10:01:00Z', sync_status: 'SINCRONIZADO', resultado: 'Ingreso confirmado por el servidor.' });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
});

test('la bandeja offline separa estados y recupera la conexión sin duplicar registros', async ({ page, context }) => {
  const submitted = [];
  await page.route('**/api/puntualidad/registros', async (route) => {
    submitted.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, json: { message: 'Ingreso confirmado.' } });
  });
  await login(page);
  await seedOfflineQueue(page);
  await page.getByRole('button', { name: 'Instalar aplicación' }).click();

  const dialog = page.getByRole('dialog', { name: 'Instalar en este dispositivo' });
  await expect(dialog.getByRole('heading', { name: 'Bandeja de sincronización' })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /Pendientes 1/u })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /Con error 1/u })).toBeVisible();
  await expect(dialog.getByRole('tab', { name: /Sincronizados 1/u })).toBeVisible();

  await context.setOffline(true);
  await expect(dialog.getByText('Sin conexión de red.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Sin conexión' })).toBeDisabled();
  await context.setOffline(false);
  await expect(dialog.getByRole('button', { name: 'Sincronizar ahora' })).toBeEnabled();

  await dialog.getByRole('tab', { name: /Con error/u }).click();
  await expect(dialog.getByText('El control horario ya no está disponible para este registro.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Reintentar' }).click();
  await expect.poll(() => submitted.map((item) => item.offline_operation_id)).toContain('failed-1');
  await expect(dialog.getByRole('tab', { name: /Sincronizados 2/u })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByText('El ingreso fue confirmado por el servidor sin crear duplicados.')).toBeVisible();

  await dialog.getByRole('tab', { name: /Pendientes/u }).click();
  await dialog.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await expect.poll(() => submitted.map((item) => item.offline_operation_id)).toContain('pending-1');
  await expect(dialog.getByRole('tab', { name: /Pendientes 0/u })).toBeVisible();
  await expect(dialog.getByText('1 ingreso fue confirmado por el servidor.')).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).include('.pwa-experience').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('un fallo del almacenamiento local nunca se presenta como una bandeja vacía', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: { open: () => { throw new Error('almacenamiento bloqueado por prueba'); } },
    });
  });
  await login(page);
  await page.getByRole('button', { name: 'Instalar aplicación' }).click();
  const dialog = page.getByRole('dialog', { name: 'Instalar en este dispositivo' });
  await expect(dialog.getByRole('alert')).toContainText('Bandeja local no disponible');
  await expect(dialog.getByRole('alert')).toContainText('No registres ingresos sin conexión');
  await expect(dialog.getByText('La lista no se muestra porque su contenido no pudo verificarse.')).toBeVisible();
  await expect(dialog.getByText('No hay ingresos pendientes.')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Reintentar apertura' })).toBeVisible();
});
