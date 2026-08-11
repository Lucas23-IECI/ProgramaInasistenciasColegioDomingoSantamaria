/* global process */
import { test, expect } from '@playwright/test';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const password = process.env.DEFAULT_USER_PASSWORD;

const login = async (page) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la prueba local.');
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(adminEmail);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  const releaseNotes = page.getByRole('dialog').filter({ hasText: 'Novedades del sistema' });
  if (await releaseNotes.isVisible().catch(() => false)) {
    await releaseNotes.getByRole('button', { name: 'Cerrar novedades' }).click();
  }
};

test('la justificación histórica expone una acción primaria horizontal y directa', async ({ page }, testInfo) => {
  await login(page);
  await page.goto('/admin/atrasos');

  await expect(page.getByRole('heading', { name: 'Justificaciones pendientes' })).toBeVisible();
  await expect(page.getByText('Encontrar un atraso específico')).toBeVisible();

  const action = page.getByRole('button', { name: 'Justificar atraso' }).first();
  await expect(action).toBeVisible();
  const box = await action.boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeGreaterThan(155);
  expect(box.height).toBeLessThanOrEqual(56);
  await page.screenshot({ path: testInfo.outputPath('bandeja.png'), fullPage: true });

  await action.click();
  await expect(page.getByText('Pendiente de justificación')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Justificar atraso' })).toBeVisible();
  await expect(page.getByText(/La justificación quedará vinculada solamente a este registro/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('justificaciones.png'), fullPage: true });
});

test('la bandeja no provoca desplazamiento horizontal en móvil', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'movil-android', 'Validación exclusiva del viewport móvil.');
  await login(page);
  await page.goto('/admin/atrasos');
  await expect(page.getByRole('heading', { name: 'Justificaciones pendientes' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
});
