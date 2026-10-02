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
  expect(response.ok(), `El acceso de prueba respondió ${response.status()}.`).toBe(true);
  await page.goto('/admin/auditoria');
  await dismissReleaseNotes(page);
};

test('Auditoría usa catálogos reales, registra consultas y conserva filtros comprensibles', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Auditoría del sistema' })).toBeVisible();
  await expect(page.getByLabel('Resumen de actividad del período')).toContainText('Consultas');
  await expect(page.getByRole('combobox', { name: 'Filtrar por categoría de actividad' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Filtrar por acción' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Filtrar por sección afectada' })).toBeVisible();

  const first = await page.context().request.get('/api/audit?categoria=CONSULTA&limit=100');
  expect(first.ok()).toBe(true);
  const firstBody = await first.json();
  expect(firstBody.catalogs.categories).toEqual(['ACCESO', 'CONSULTA', 'CAMBIO', 'DESCARGA']);
  expect(Object.keys(firstBody.summary).sort()).toEqual(['acceso', 'cambio', 'consulta', 'descarga']);

  const second = await page.context().request.get('/api/audit?accion=CONSULTAR_AUDITORIA&limit=100');
  expect(second.ok()).toBe(true);
  const secondBody = await second.json();
  expect(secondBody.rows.some((row) => row.accion === 'CONSULTAR_AUDITORIA' && row.categoria === 'CONSULTA')).toBe(true);
  expect(JSON.stringify(secondBody.rows)).not.toContain('usuario_correo%40');

  const accessibility = await new AxeBuilder({ page }).include('.audit-shell').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
});

test('Auditoría se adapta a 320 px sin desbordar la página', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 760 });
  await login(page);
  await expect(page.getByLabel('Resumen de actividad del período')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
