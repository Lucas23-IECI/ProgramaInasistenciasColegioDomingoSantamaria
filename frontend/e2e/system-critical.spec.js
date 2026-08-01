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

test('el changelog conserva controles visibles y contenido adaptable', async ({ page }, testInfo) => {
  await login(page);
  if (testInfo.project.name === 'escritorio') {
    await page.setViewportSize({ width: 835, height: 744 });
  }
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('menuitem', { name: 'Novedades de la versión' }).click();

  const dialog = page.getByRole('dialog', { name: /Padrón escolar verificable/ });
  const body = dialog.locator('.release-notes__body');
    await expect(dialog).toBeVisible();
    const closeButton = dialog.getByRole('button', { name: 'Cerrar novedades' });
    await expect(closeButton).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Entendido' })).toBeVisible();
    await page.waitForTimeout(300);

    const closeButtonIsTopmost = await closeButton.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const topmost = document.elementFromPoint(
        rect.left + (rect.width / 2),
        rect.top + (rect.height / 2),
      );
      return topmost === element || element.contains(topmost);
    });
    expect(closeButtonIsTopmost).toBe(true);

  const geometry = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(geometry.top).toBeGreaterThanOrEqual(0);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + 1);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + 1);

  await body.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(closeButton).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Entendido' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const accessibility = await new AxeBuilder({ page }).include('.release-notes').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
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

test('la configuración de visitas es legible, accesible y conserva sus catálogos', async ({ page }) => {
  await login(page);
  await page.goto('/admin/visitas/configuracion');
  await expect(page.getByRole('heading', { name: 'Configuración de visitas y retiros' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Motivos de visita' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Guardar reglas' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agregar' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Opciones de Motivos de visita' })).toBeVisible();
  await expectNoHorizontalOverflow(page);

  const results = await new AxeBuilder({ page }).include('.visit-settings-surface').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
});

test('recupera automáticamente una sección cuando su archivo versionado quedó obsoleto', async ({ page }) => {
  await login(page);
  let rejectedOnce = false;
  await page.route(/VisitSettingsAdmin-.*\.js/, async (route) => {
    if (!rejectedOnce) {
      rejectedOnce = true;
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'archivo sustituido' });
      return;
    }
    await route.continue();
  });

  await page.goto('/admin/visitas/configuracion');
  await expect(page.getByRole('heading', { name: 'Configuración de visitas y retiros' })).toBeVisible({ timeout: 15_000 });
  expect(rejectedOnce).toBe(true);
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
  for (const route of [
    '/admin',
    '/admin/atrasos',
    '/admin/estudiantes',
    '/admin/usuarios',
    '/admin/auditoria',
    '/admin/analiticas',
    '/admin/configuracion',
    '/admin/visitas',
    '/admin/visitas/configuracion',
    '/admin/operacion',
    '/admin/familias',
    '/admin/gobierno-datos',
    '/scanner',
  ]) {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
  }
});
