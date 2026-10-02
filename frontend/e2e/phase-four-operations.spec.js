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
  await page.goto('/admin/visitas');
  await dismissReleaseNotes(page);
};

const expectPanelAccessible = async (page) => {
  const accessibility = await new AxeBuilder({ page }).include('.extended-operations').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
};

test('Portería ampliada expone operación real, segura y adaptable sin modificar registros', async ({ page }) => {
  await login(page);

  const summaryResponse = await page.context().request.get('/api/visitas/operacion-ampliada/resumen');
  expect(summaryResponse.ok(), `El resumen ampliado respondió ${summaryResponse.status()}.`).toBe(true);
  const summary = await summaryResponse.json();
  for (const key of ['visitas_esperadas', 'permanencias_excedidas', 'encomiendas_pendientes', 'personas_dentro']) {
    expect(Number.isInteger(Number(summary[key]))).toBe(true);
  }

  const preregistrationsResponse = await page.context().request.get('/api/visitas/preinscripciones');
  expect(preregistrationsResponse.ok(), `Las visitas esperadas respondieron ${preregistrationsResponse.status()}.`).toBe(true);
  const preregistrations = await preregistrationsResponse.json();
  expect(Array.isArray(preregistrations)).toBe(true);
  expect(preregistrations.every((item) => item.token_hash === undefined && item.documento_numero === undefined)).toBe(true);

  await page.getByRole('button', { name: 'Operación ampliada' }).click();
  const panel = page.locator('.extended-operations');
  await expect(panel.getByRole('heading', { name: 'Operación y seguridad de acceso' })).toBeVisible();
  await expect(panel.getByText('Personas dentro', { exact: true })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Permanencias excedidas' })).toBeVisible();
  await expectPanelAccessible(page);

  await panel.getByRole('button', { name: 'Visitas esperadas' }).click();
  await expect(panel.getByRole('heading', { name: 'Preinscribir visita' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Crear credencial temporal' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Validar ingreso con QR' })).toBeVisible();
  await expectPanelAccessible(page);

  for (const section of ['Restricciones', 'Encomiendas', 'Vehículos']) {
    await panel.getByRole('button', { name: section }).click();
    await expectPanelAccessible(page);
  }

  await panel.getByRole('button', { name: 'Emergencia' }).click();
  await expect(panel.getByRole('heading', { name: /Evento activo:|No hay una emergencia activa/ })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Gestión de emergencia' })).toBeVisible();
  await expectPanelAccessible(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('la bandeja permite coordinar tareas con permisos, historial y motivos sin tocar datos reales', async ({ page }, testInfo) => {
  const createdPayloads = [];
  const statePayloads = [];
  let rejectNextStart = true;
  let finishCompletion;
  const completion = new Promise((resolve) => { finishCompletion = resolve; });
  const internalTask = {
    id_tarea: 501,
    titulo: 'Confirmar antecedente de prueba',
    detalle: 'Dato simulado para validar la interfaz.',
    prioridad: 'ALTA',
    estado: 'PENDIENTE',
    fecha_limite: '2026-09-03',
    responsable_usuario_id: 1,
    responsable_nombre: 'Administración de prueba',
    creada_por_nombre: 'Administración de prueba',
    creada_en: '2026-08-29T12:00:00Z',
  };
  const operationalSnapshot = {
    generated_at: '2026-08-29T12:00:00Z',
    institutional_date: '2026-08-29',
    summary: {
      internal_tasks: 1,
      visits: 0,
      requested_withdrawals: 0,
      authorized_withdrawals: 0,
      unenrolled_students: 0,
      manual_students_pending: 0,
      pending_justifications: 0,
      operational_events: 0,
      blocked_users: 0,
      blocking: 0,
      total: 1,
      backup_healthy: true,
    },
    tasks: {
      internal_tasks: [internalTask],
      visits: [],
      requested_withdrawals: [],
      authorized_withdrawals: [],
      unenrolled_students: [],
      manual_students_pending: [],
      pending_justifications: [],
      operational_events: [],
      blocked_users: [],
    },
    backup: { healthy: true, completed_at: '2026-08-29T10:00:00Z' },
    last_close: null,
  };

  await page.route('**/api/operaciones/bandeja', (route) => route.fulfill({ json: operationalSnapshot }));
  await page.route(/\/api\/operaciones\/tareas(?:\/[^?]*)?(?:\?.*)?$/u, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.endsWith('/responsables')) {
      return route.fulfill({ json: [{ id: 1, nombre: 'Administración de prueba', correo: 'admin@ldsm.local' }] });
    }
    if (url.pathname.endsWith('/501') && request.method() === 'GET') {
      return route.fulfill({ json: {
        tarea: internalTask,
        eventos: [{
          id_evento: 900,
          tipo: 'CREADA',
          detalle: 'Tarea interna creada.',
          realizado_por_nombre: 'Administración de prueba',
          realizado_en: '2026-08-29T12:00:00Z',
        }],
      } });
    }
    if (url.pathname.endsWith('/501/estado') && request.method() === 'PATCH') {
      if (request.postDataJSON().estado === 'EN_PROGRESO' && rejectNextStart) {
        rejectNextStart = false;
        return route.fulfill({ status: 500, json: { message: 'Fallo simulado de actualización.' } });
      }
      statePayloads.push(request.postDataJSON());
      if (request.postDataJSON().estado === 'COMPLETADA') await completion;
      return route.fulfill({ json: { ...internalTask, estado: request.postDataJSON().estado } });
    }
    if (url.pathname.endsWith('/tareas') && request.method() === 'POST') {
      createdPayloads.push(request.postDataJSON());
      return route.fulfill({ status: 201, json: { id_tarea: 502, ...request.postDataJSON(), estado: 'PENDIENTE' } });
    }
    return route.abort();
  });

  await login(page);
  await page.goto('/admin/operacion');
  await dismissReleaseNotes(page);

  await expect(page.getByRole('heading', { name: 'Tareas por resolver' })).toBeVisible();
  await expect(page.getByText('Confirmar antecedente de prueba')).toBeVisible();
  await page.getByLabel('Título de la tarea').fill('Coordinar revisión de prueba');
  await page.getByLabel('Prioridad').selectOption('URGENTE');
  await page.getByLabel('Responsable').selectOption('1');
  await page.getByLabel('Fecha límite').fill('2026-09-04');
  await page.getByLabel('Detalle opcional').fill('Contexto de interfaz, sin persistencia real.');
  await page.getByRole('button', { name: 'Crear tarea interna' }).click();
  await expect.poll(() => createdPayloads.length).toBe(1);
  expect(createdPayloads[0]).toMatchObject({
    titulo: 'Coordinar revisión de prueba',
    prioridad: 'URGENTE',
    responsable_usuario_id: '1',
    fecha_limite: '2026-09-04',
  });

  await page.getByRole('button', { name: 'Historial' }).click();
  await expect(page.getByRole('heading', { name: 'Confirmar antecedente de prueba' })).toBeVisible();
  await expect(page.getByText(/Tarea interna creada\./)).toBeVisible();
  await page.getByRole('button', { name: 'Marcar en curso' }).click();
  const updateWarning = page.locator('.app-toast');
  await expect(updateWarning).toBeVisible();
  const layers = await page.evaluate(() => ({
    modal: Number.parseInt(getComputedStyle(document.querySelector('.operations-modal-backdrop')).zIndex, 10),
    toast: Number.parseInt(getComputedStyle(document.querySelector('.app-toast')).zIndex, 10),
  }));
  expect(layers.toast).toBeGreaterThan(layers.modal);
  await updateWarning.getByRole('button', { name: 'Cerrar notificación' }).click();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.getByRole('button', { name: 'Completar', exact: true }).click();
  await page.getByRole('button', { name: 'Completar tarea' }).click();
  const resolutionError = page.getByText('Indica un motivo de al menos 5 caracteres.');
  await expect(resolutionError).toBeVisible();
  await expect(page.getByLabel('Motivo de resolución')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('tarea-error-dentro-del-modal.png'), fullPage: true });
  await expect(page.locator('.app-toast')).toHaveCount(0);
  await page.getByLabel('Motivo de resolución').fill('Antecedente confirmado durante la revisión.');
  await page.getByRole('button', { name: 'Completar tarea' }).click();
  await expect.poll(() => statePayloads.length).toBe(1);
  try {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Completar tarea' })).toBeVisible();
  } finally { finishCompletion(); }
  await expect(page.getByRole('dialog', { name: 'Completar tarea' })).toHaveCount(0);
  expect(statePayloads[0]).toEqual({ estado: 'COMPLETADA', motivo: 'Antecedente confirmado durante la revisión.' });

  const accessibility = await new AxeBuilder({ page }).include('.operations-content').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
