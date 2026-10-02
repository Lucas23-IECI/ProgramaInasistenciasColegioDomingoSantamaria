/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissReleaseNotes } from './helpers.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const password = process.env.DEFAULT_USER_PASSWORD;

const login = async (page) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la prueba local.');
  const response = await page.context().request.post('/api/auth/login', {
    data: { correo: adminEmail, password }
  });
  expect(response.ok()).toBe(true);
};

test('el historial explica y bloquea una reversión cuando existen cambios posteriores', async ({ page }, testInfo) => {
  await page.route(/\/api\/padron\/quality$/u, (route) => route.fulfill({ json: { indicators: {}, cases: {} } }));
  await page.route(/\/api\/padron\/manual-pending$/u, (route) => route.fulfill({ json: { students: [], total: 0 } }));
  await page.route(/\/api\/padron\/imports$/u, (route) => route.fulfill({ json: { imports: [{
    id: 90, nombre_archivo: 'nomina-agosto.xlsx', importado_en: '2026-08-30T12:00:00Z',
    importado_por_nombre: 'Administración', modo: 'PARCIAL', estado: 'COMPLETADA', total_filas: 2,
    version_reversion: 1
  }] } }));
  await page.route(/\/api\/padron\/imports\/90$/u, (route) => route.fulfill({ json: {
    import: {
      id: 90, nombre_archivo: 'nomina-agosto.xlsx', importado_en: '2026-08-30T12:00:00Z',
      importado_por_nombre: 'Administración', estado: 'COMPLETADA', version_reversion: 1,
      filas_creadas: 1, filas_actualizadas: 1, filas_vinculadas: 0, filas_retiradas: 0, filas_rechazadas: 0
    },
    changes: [{ id: 901, accion: 'ACTUALIZADO', estudiante: 'Estudiante de prueba', numero_fila: 2 }],
    reversions: []
  } }));
  await page.route(/\/api\/padron\/imports\/90\/reversion-preview$/u, (route) => route.fulfill({ json: {
    found: true, can_revert: false,
    summary: { reversible: 1, bloqueado: 1, omitido: 0 },
    global_reasons: [],
    rows: [{ status: 'BLOQUEADO', reasons: ['La ficha recibió cambios posteriores a esta importación.'] }]
  } }));

  await login(page);
  await page.goto('/admin/estudiantes?seccion=governance');
  await dismissReleaseNotes(page);
  await page.getByRole('button', { name: /Historial/u }).click();
  await page.getByRole('button', { name: /nomina-agosto\.xlsx/u }).click();
  await expect(page.getByRole('heading', { name: 'Reversión segura' })).toBeVisible();
  await page.getByRole('button', { name: 'Comprobar si puede revertirse' }).click();
  await expect(page.getByRole('heading', { name: 'La reversión está bloqueada' })).toBeVisible();
  await expect(page.getByText('La ficha recibió cambios posteriores a esta importación.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Revertir esta importación' })).toHaveCount(0);

  await page.screenshot({
    path: `output/playwright/import-rollback-${testInfo.project.name}.png`,
    fullPage: true
  });

  const accessibility = await new AxeBuilder({ page }).include('.student-governance').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('las dos plantillas reales se descargan como archivos Excel', async ({ page }) => {
  await login(page);
  for (const type of ['students', 'guardians']) {
    const response = await page.context().request.get(`/api/padron/import-template?type=${type}`);
    expect(response.ok(), `${type} respondió ${response.status()}`).toBe(true);
    expect(response.headers()['content-type']).toContain('spreadsheetml');
    const body = await response.body();
    expect(body.subarray(0, 2).toString()).toBe('PK');
    expect(body.length).toBeGreaterThan(3000);
  }
});

test('una reversión apta exige motivo y confirmación antes de ejecutarse', async ({ page }) => {
  let receivedPayload = null;
  await page.route(/\/api\/padron\/quality$/u, (route) => route.fulfill({ json: { indicators: {}, cases: {} } }));
  await page.route(/\/api\/padron\/manual-pending$/u, (route) => route.fulfill({ json: { students: [], total: 0 } }));
  await page.route(/\/api\/padron\/imports$/u, (route) => route.fulfill({ json: { imports: [{
    id: 91, nombre_archivo: 'nomina-controlada.xlsx', importado_en: '2026-08-30T12:00:00Z',
    importado_por_nombre: 'Administración', modo: 'PARCIAL', estado: 'COMPLETADA', total_filas: 1,
    version_reversion: 1
  }] } }));
  await page.route(/\/api\/padron\/imports\/91$/u, (route) => route.fulfill({ json: {
    import: {
      id: 91, nombre_archivo: 'nomina-controlada.xlsx', importado_en: '2026-08-30T12:00:00Z',
      importado_por_nombre: 'Administración', estado: 'COMPLETADA', version_reversion: 1,
      filas_creadas: 1, filas_actualizadas: 0, filas_vinculadas: 0, filas_retiradas: 0, filas_rechazadas: 0
    },
    changes: [{ id: 911, accion: 'CREADO', estudiante: 'Estudiante controlado', numero_fila: 2 }],
    reversions: []
  } }));
  await page.route(/\/api\/padron\/imports\/91\/reversion-preview$/u, (route) => route.fulfill({ json: {
    found: true, can_revert: true,
    summary: { reversible: 1, bloqueado: 0, omitido: 0 },
    global_reasons: [], rows: [{ status: 'REVERSIBLE', reasons: [] }]
  } }));
  await page.route(/\/api\/padron\/imports\/91\/revertir$/u, async (route) => {
    receivedPayload = await route.request().postDataJSON();
    await route.fulfill({ json: {
      message: 'La importación fue revertida sin borrar fichas ni actividad institucional.',
      revertidos: 1, omitidos: 0
    } });
  });

  await login(page);
  await page.goto('/admin/estudiantes?seccion=governance');
  await dismissReleaseNotes(page);
  await page.getByRole('button', { name: /Historial/u }).click();
  await page.getByRole('button', { name: /nomina-controlada\.xlsx/u }).click();
  await page.getByRole('button', { name: 'Comprobar si puede revertirse' }).click();
  const action = page.getByRole('button', { name: 'Revertir esta importación' });
  await expect(action).toBeDisabled();
  await page.getByLabel('Motivo institucional').fill('Carga aplicada al curso equivocado');
  await page.getByLabel(/Confirmo que revisé esta compensación/u).check();
  await expect(action).toBeEnabled();
  await action.click();
  await expect(page.getByText('La importación fue revertida sin borrar fichas ni actividad institucional.')).toBeVisible();
  expect(receivedPayload).toEqual({
    motivo: 'Carga aplicada al curso equivocado',
    confirmar: true
  });
});
