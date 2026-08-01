/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const readerEmail = process.env.E2E_READER_EMAIL || (process.env.CI ? '' : 'lector@ldsm.local');
const password = process.env.DEFAULT_USER_PASSWORD;

const login = async (page, email = adminEmail) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la prueba local.');
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  const releaseNotes = page.getByRole('dialog').filter({ hasText: 'Novedades del sistema' });
  if (await releaseNotes.isVisible().catch(() => false)) {
    await releaseNotes.getByRole('button', { name: 'Entendido' }).click();
  }
};

const expectNoHorizontalOverflow = async (page) => {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
};

test('el acceso es usable y no presenta barreras críticas', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
  await expectNoHorizontalOverflow(page);
});

test('administración abre padrón, alta manual y lectura MRZ restringida', async ({ page }) => {
  await login(page);
  await page.goto('/admin/estudiantes');
  await expect(page.getByRole('heading', { name: 'Personas y cursos' })).toBeVisible();
  await page.getByRole('button', { name: /Agregar estudiante/ }).click();
  await expect(page.getByRole('dialog', { name: 'Agregar estudiante manualmente' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Tipo de identificación del estudiante' }).click();
  await page.getByRole('option', { name: 'Pasaporte' }).click();
  await expect(page.getByRole('button', { name: 'Leer zona MRZ' })).toBeVisible();
  await page.getByRole('button', { name: 'Leer zona MRZ' }).click();
  await expect(page.getByRole('dialog', { name: 'Leer zona MRZ' })).toBeVisible();
  await expect(page.getByText('No se cargan ni guardan fotografías.')).toBeVisible();
});

test('el terminal conserva regreso al panel y métodos operativos', async ({ page }) => {
  await login(page);
  await page.goto('/scanner');
  await expect(page.getByRole('heading', { name: 'Terminal de ingresos' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Panel principal/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Pistola de códigos/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Cámara del dispositivo/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Búsqueda manual/ })).toBeVisible();
});

test('Portería recibe solo sus dos módulos y el terminal operativo', async ({ page }) => {
  test.skip(!readerEmail, 'La cuenta de Portería no está preparada en este entorno efímero.');
  await login(page, readerEmail);
  await expect(page.getByRole('heading', { name: 'Control de visitas y retiros' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Registro de estudiantes' })).toBeVisible();
  await page.goto('/scanner');
  await expect(page.getByRole('button', { name: /Cámara del dispositivo/ })).toBeVisible();
});

test('las pantallas críticas no desbordan en móvil', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'movil-android', 'Validación exclusiva del viewport móvil.');
  await login(page);
  for (const route of ['/admin', '/admin/estudiantes', '/scanner']) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
  }
});
