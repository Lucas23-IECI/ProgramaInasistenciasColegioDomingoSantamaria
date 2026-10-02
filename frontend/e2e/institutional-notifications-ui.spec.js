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
  await page.route('**/api/notificaciones/audiencias*', (route) => json(route, {
    personas: [
      { id: 2, nombre: 'Andrés Inspector', correo: 'andres@ldsm.test', cargo: 'Inspector General', perfil_nombre: 'Inspectoría' },
      { id: 3, nombre: 'July Riso', correo: 'july@ldsm.test', cargo: 'Secretaría', perfil_nombre: 'Secretaría' },
    ],
    perfiles: [
      { codigo: 'inspector', nombre: 'Inspectoría', descripcion: 'Equipo operativo', cuentas_activas: 4 },
    ],
    grupos: [
      { codigo: 'EQUIPO_GESTION', nombre: 'Equipo de Gestión', descripcion: 'Equipo directivo', cuentas_activas: 3 },
    ],
  }));
  await page.route('**/api/notificaciones/enviadas?*', (route) => json(route, {
    items: [{
      id_envio: 21,
      titulo: 'Coordinación de seguimiento',
      detalle: 'Revisar el antecedente y registrar la gestión realizada.',
      prioridad: 'IMPORTANTE',
      enlace: '/admin/seguimiento/44',
      destinatarios_total: 3,
      entregadas: 3,
      leidas: 2,
      estado: 'ENVIADO',
      reintento_numero: 1,
      creado_en: '2026-08-27T13:00:00.000Z',
    }],
    summary: { total: 1, enviados: 1, fallidos: 0, destinatarios: 3, entregadas: 3, leidas: 2 },
    pagination: { page: 1, pages: 1 },
  }));
  await page.route('**/api/notificaciones/enviadas/21', (route) => json(route, {
    id_envio: 21,
    titulo: 'Coordinación de seguimiento',
    detalle: 'Revisar el antecedente y registrar la gestión realizada.',
    prioridad: 'IMPORTANTE',
    enlace: '/admin/seguimiento/44',
    estado: 'ENVIADO',
    reintento_numero: 1,
    creado_en: '2026-08-27T13:00:00.000Z',
    recipients: [
      { id_notificacion: 81, destinatario_nombre: 'Andrés Inspector', destinatario_cargo: 'Inspector General', estado: 'LEIDA', leida_en: '2026-08-27T13:05:00.000Z' },
      { id_notificacion: 82, destinatario_nombre: 'July Riso', destinatario_cargo: 'Secretaría', estado: 'ENTREGADA', entregada_en: '2026-08-27T13:00:00.000Z' },
    ],
  }));
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
  await composer.getByRole('tab', { name: 'Perfiles' }).click();
  await expect(composer.getByText('Inspectoría', { exact: true })).toBeVisible();
  await composer.getByRole('tab', { name: 'Equipos' }).click();
  await expect(composer.getByText('Equipo de Gestión', { exact: true })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  results = await new AxeBuilder({ page }).include('.notification-composer').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);

  await composer.getByRole('button', { name: 'Cerrar' }).click();
  await page.getByRole('button', { name: /Centro de notificaciones/ }).click();
  await page.locator('.global-notifications-panel').getByRole('button', { name: 'Historial' }).click();
  const history = page.getByRole('dialog', { name: 'Historial de notificaciones' });
  await expect(history).toBeVisible();
  await expect(history.getByLabel('Resumen de envíos')).toContainText('3 destinatarios');
  await history.getByRole('button', { name: /Coordinación de seguimiento/ }).click();
  await expect(history.getByRole('button', { name: 'Abrir destino del aviso' })).toBeVisible();
  await expect(history.getByText('Reintento #1')).toBeVisible();
  results = await new AxeBuilder({ page }).include('.notification-history').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
});
