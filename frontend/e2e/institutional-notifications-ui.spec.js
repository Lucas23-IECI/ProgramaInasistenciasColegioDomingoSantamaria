import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissReleaseNotes } from './helpers.js';

const json = (route, body) => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(body),
});

test('el centro y el compositor de avisos son accesibles y adaptables', async ({ page }) => {
  await page.route('**/api/**', (route) => json(route, {}));
  await page.route('**/api/auth/me', (route) => json(route, {
    user: {
      id: 1,
      nombre: 'Directora de prueba',
      rol: 'direccion',
      cargo: 'Directora',
      permissions: ['notifications.send', 'operations.view', 'seguimiento.view'],
    },
  }));
  await page.route('**/api/notificaciones?*', (route) => json(route, {
    items: [{
      id_notificacion: 10,
      titulo: 'Revisión de seguimiento',
      detalle: 'Hay un caso prioritario pendiente de coordinación.',
      modulo: 'SEGUIMIENTO',
      prioridad: 'IMPORTANTE',
      creada_en: '2026-08-27T12:00:00.000Z',
      emisor_nombre: 'Inspectoría',
    }],
    unread: 1,
    pagination: { page: 1, pages: 1 },
  }));
  await page.route('**/api/notificaciones/directorio*', (route) => json(route, [
    { id: 2, nombre: 'Andrés Inspector', correo: 'andres@ldsm.test', cargo: 'Inspector General' },
    { id: 3, nombre: 'July Riso', correo: 'july@ldsm.test', cargo: 'Secretaría' },
  ]));
  await page.route('**/api/operaciones/bandeja', (route) => json(route, {
    summary: { total: 4 }, backup: { healthy: true },
  }));
  await page.route('**/api/seguimiento/resumen', (route) => json(route, {
    prioritarios: 3, vencidos: 2,
  }));
  await page.route('**/api/seguimiento/casos?*', (route) => json(route, { items: [], total: 0 }));

  await page.goto('/admin');
  await dismissReleaseNotes(page);

  await page.getByRole('button', { name: /Centro de notificaciones/ }).click();
  const center = page.locator('.global-notifications-panel');
  await expect(center).toBeVisible();
  await expect(center.getByText('Revisión de seguimiento')).toBeVisible();
  let results = await new AxeBuilder({ page }).include('.global-notifications-panel').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);

  await center.getByRole('button', { name: 'Enviar aviso' }).click();
  const composer = page.getByRole('dialog', { name: 'Enviar una notificación' });
  await expect(composer).toBeVisible();
  await expect(composer.getByText('Andrés Inspector')).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  results = await new AxeBuilder({ page }).include('.notification-composer').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
});
