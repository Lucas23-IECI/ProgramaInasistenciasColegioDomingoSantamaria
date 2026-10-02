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
};

test('Analítica programa, audita y reintenta reportes sin persistir datos de prueba', async ({ page }) => {
  const createdPayloads = [];
  const retryIds = [];
  const schedules = [];
  const executions = [{
    id_ejecucion: 700,
    id_reporte: 44,
    nombre_reporte: 'Resumen de prueba',
    frecuencia: 'SEMANAL',
    formato: 'PDF',
    periodo_desde: '2026-08-17',
    periodo_hasta: '2026-08-23',
    estado: 'ERROR',
    error_publico: 'Los datos institucionales no estuvieron disponibles durante la ejecución.',
    archivo_bytes: null,
    reintento_de: null,
    generado_en: '2026-08-24T11:00:00Z',
  }];

  await page.route(/\/api\/analitica\/programaciones$/u, async (route) => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: schedules });
    if (request.method() === 'POST') {
      const payload = request.postDataJSON();
      createdPayloads.push(payload);
      schedules.push({ id_reporte: 45, ...payload, activo: true, ultima_ejecucion: null });
      return route.fulfill({ status: 201, json: schedules.at(-1) });
    }
    return route.abort();
  });
  await page.route(/\/api\/analitica\/programaciones\/ejecuciones(?:\?.*)?$/u, async (route) => {
    if (route.request().method() !== 'GET') return route.abort();
    return route.fulfill({ json: { items: executions, pagina: 1, limite: 10, total: executions.length, paginas: 1 } });
  });
  await page.route(/\/api\/analitica\/programaciones\/ejecuciones\/(\d+)\/reintentar$/u, async (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-2));
    retryIds.push(id);
    const generated = {
      ...executions[0], id_ejecucion: 701, estado: 'GENERADO', error_publico: null,
      archivo_nombre: 'resumen-prueba.pdf', archivo_bytes: 12000, reintento_de: id,
      generado_en: '2026-08-29T12:00:00Z',
    };
    executions.unshift(generated);
    return route.fulfill({ status: 201, json: generated });
  });

  await login(page);
  await page.goto('/admin/analiticas');
  await dismissReleaseNotes(page);
  const schedulesPanel = page.locator('[data-tour="analytics-schedules"]');
  await expect(schedulesPanel.getByRole('heading', { name: 'Reportes automáticos' })).toBeVisible();

  await schedulesPanel.getByLabel('Nombre').fill('Resumen semanal de prueba');
  await schedulesPanel.getByLabel('Día de la semana').fill('5');
  await schedulesPanel.getByLabel('Hora').fill('07:30');
  await schedulesPanel.getByRole('button', { name: 'Programar' }).click();
  await expect.poll(() => createdPayloads.length).toBe(1);
  expect(createdPayloads[0]).toMatchObject({
    nombre: 'Resumen semanal de prueba', frecuencia: 'SEMANAL', formato: 'PDF', dia_semana: '5', hora: '07:30'
  });
  await expect(schedulesPanel.getByText('Resumen semanal de prueba')).toBeVisible();

  await schedulesPanel.getByRole('button', { name: 'Reintentar' }).click();
  await expect.poll(() => retryIds).toEqual([700]);
  await expect(schedulesPanel.getByText('Reintento de #700')).toBeVisible();
  await expect(schedulesPanel.getByText('Generado', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Recorrido de estadísticas' }).click();
  const help = page.locator('.driver-popover');
  await expect(help).toBeVisible();
  await expect(help).toContainText('Identificación del módulo');
  for (let step = 0; step < 7; step += 1) await help.getByRole('button', { name: 'Siguiente' }).click();
  await expect(help).toContainText('Exportar el alcance actual');
  await expect(help).toContainText('hojas revisables');
  await help.getByRole('button', { name: 'Siguiente' }).click();
  await expect(help).toContainText('Reportes automáticos');
  await expect(help).toContainText('evitando reintentos simultáneos');
  await page.keyboard.press('Escape');

  const accessibility = await new AxeBuilder({ page }).include('.institutional-analytics').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
