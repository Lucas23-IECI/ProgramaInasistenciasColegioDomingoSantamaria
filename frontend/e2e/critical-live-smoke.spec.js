/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissReleaseNotes } from './helpers.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const password = process.env.DEFAULT_USER_PASSWORD;
const providedTaskId = Number(process.env.E2E_OPERATION_TASK_ID || 0);

const login = async (page, destination) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la prueba local.');
  const response = await page.context().request.post('/api/auth/login', {
    data: { correo: adminEmail, password }
  });
  expect(response.ok(), `El acceso real respondió ${response.status()}.`).toBe(true);
  await page.goto(destination);
  await dismissReleaseNotes(page);
};

test('Recursos abre un diálogo de viewport completo y ofrece categorías sugeridas', async ({ page }, testInfo) => {
  await login(page, '/admin/recursos');
  await page.getByRole('button', { name: 'Agregar recurso' }).click();

  const dialog = page.getByRole('dialog', { name: 'Agregar recurso' });
  await expect(dialog).toBeVisible();
  const backdrop = page.locator('.resources-dialog-backdrop');
  const box = await backdrop.boundingBox();
  const viewport = page.viewportSize();
  expect(box?.x).toBeLessThanOrEqual(1);
  expect(box?.y).toBeLessThanOrEqual(1);
  expect(box?.width).toBeGreaterThanOrEqual((viewport?.width || 0) - 1);
  expect(box?.height).toBeGreaterThanOrEqual((viewport?.height || 0) - 1);
  await expect(page.locator('.global-tools')).toBeHidden();

  const category = dialog.getByRole('combobox', { name: /Categoría/u });
  await expect(category).toHaveAttribute('list', 'resource-category-suggestions');
  await expect(page.locator('#resource-category-suggestions option[value="Tecnología"]')).toHaveCount(1);

  const accessibility = await new AxeBuilder({ page }).include('.resources-dialog').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('recursos-dialogo-viewport.png'), fullPage: false });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('la ayuda real de Recursos explica las categorías sugeridas vigentes', async ({ page }) => {
  await login(page, '/admin/recursos');
  await page.getByRole('button', { name: 'Recorrido de recursos internos' }).click();
  await expect(page.getByRole('dialog', { name: 'Identificación del módulo' })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByText('Inventario con trazabilidad', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByText('Catálogo, préstamos y solicitudes', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByText('Disponibilidad comprobada', { exact: true })).toBeVisible();
  await expect(page.getByText(/categoría institucional sugerida/u)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Disponibilidad comprobada', { exact: true })).toBeHidden();
});

test('Operación inicia una tarea real y confirma API, PostgreSQL e historial visible', async ({ page, baseURL }, testInfo) => {
  test.skip(!providedTaskId && process.env.E2E_ISOLATED_MUTATIONS !== '1', 'Requiere una tarea de prueba explícita o la base QA aislada.');
  let taskId = providedTaskId;
  if (!taskId) {
    const url = new URL(baseURL);
    expect(['127.0.0.1', 'localhost']).toContain(url.hostname);
    expect(url.port).not.toBe('');
    expect(url.port).not.toBe('80');
  }
  await login(page, '/admin/operacion');
  if (!taskId) {
    const created = await page.request.post('/api/operaciones/tareas', { data: {
      titulo: `[AUDITORÍA UI] Inicio ${testInfo.project.name}-${Date.now()}`,
      prioridad: 'ALTA'
    } });
    expect(created.status()).toBe(201);
    taskId = (await created.json()).id_tarea;
    await page.reload();
  }

  const initialResponse = await page.context().request.get(`/api/operaciones/tareas/${taskId}`);
  expect(initialResponse.ok(), `El historial inicial respondió ${initialResponse.status()}.`).toBe(true);
  const initial = await initialResponse.json();
  expect(initial.tarea.estado).toBe('PENDIENTE');

  const task = page.locator('.operations-task-item').filter({ hasText: initial.tarea.titulo });
  await expect(task).toBeVisible();
  await task.getByRole('button', { name: 'Historial' }).click();
  const historyDialog = page.getByRole('dialog', { name: initial.tarea.titulo });
  await expect(historyDialog).toBeVisible();
  const modalBox = await page.locator('.operations-modal-backdrop').boundingBox();
  const viewport = page.viewportSize();
  expect(modalBox?.width).toBeGreaterThanOrEqual((viewport?.width || 0) - 1);
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  const patchResponse = page.waitForResponse((response) => response.url().endsWith(`/api/operaciones/tareas/${taskId}/estado`) && response.request().method() === 'PATCH');
  await task.getByRole('button', { name: 'Iniciar' }).click();
  expect((await patchResponse).status()).toBe(200);
  await expect(task).toContainText('En curso');

  const finalResponse = await page.context().request.get(`/api/operaciones/tareas/${taskId}`);
  expect(finalResponse.ok()).toBe(true);
  const final = await finalResponse.json();
  expect(final.tarea.estado).toBe('EN_PROGRESO');
  expect(final.eventos.some((event) => event.tipo === 'ESTADO_CAMBIADO')).toBe(true);

  const accessibility = await new AxeBuilder({ page }).include('.operations-content').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('operacion-tarea-en-curso.png'), fullPage: true });
  if (!providedTaskId) {
    const completed = await page.request.patch(`/api/operaciones/tareas/${taskId}/estado`, { data: {
      estado: 'COMPLETADA', motivo: 'Prueba de inicio y trazabilidad finalizada en la base aislada.'
    } });
    expect(completed.status()).toBe(200);
  }
});
