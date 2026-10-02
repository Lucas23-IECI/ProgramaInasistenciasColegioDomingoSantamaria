import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissReleaseNotes } from './helpers.js';

/* global process */

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const password = process.env.DEFAULT_USER_PASSWORD;

const login = async (page) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la prueba local.');
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(adminEmail);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole('button', { name: 'Ingresar al sistema' }).click();
  await expect(page).not.toHaveURL(/\/login$/u);
  await dismissReleaseNotes(page);
};

const mockDocumentSupport = async (page) => {
  await page.route('**/api/documentos-estudiantes/resumen', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ documentos_activos: 21, vencidos: 0, vencen_pronto: 0, ocr_pendientes: 0, sin_firma: 0 }),
  }));
  await page.route('**/api/documentos-estudiantes/plantillas', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '[]',
  }));
};

const documentFixture = (id) => ({
  id_documento_expediente: id,
  estudiante_nombre: `Estudiante de prueba ${id}`,
  curso: 'Curso de prueba',
  categoria: 'CERTIFICADO',
  titulo: `Documento de prueba ${id}`,
  versiones: 1,
  ocr_estado: 'NO_SOLICITADO',
  estado_efectivo: 'VIGENTE',
  vence_en: '2027-12-31',
  responsable_nombre: 'Responsable de prueba',
});

test('Gestión documental recorre todos los resultados paginados', async ({ page }, testInfo) => {
  await login(page);
  await mockDocumentSupport(page);
  await page.route('**/api/documentos-estudiantes/documentos**', async (route) => {
    const pageNumber = Number(new URL(route.request().url()).searchParams.get('pagina') || 1);
    const items = pageNumber === 1
      ? Array.from({ length: 20 }, (_, index) => documentFixture(index + 1))
      : [documentFixture(21)];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, total: 21, pagina: pageNumber, limite: 20 }),
    });
  });

  await page.goto('/admin/documentos');
  await expect(page.locator('.docs-table tbody tr')).toHaveCount(20);
  const pagination = page.getByRole('navigation', { name: 'Paginación de documentos' });
  await expect(pagination).toContainText('Página 1 de 2');
  await pagination.getByRole('button', { name: 'Siguiente' }).click();
  await expect(page.getByText('Documento de prueba 21', { exact: true })).toBeVisible();
  await expect(page.locator('.docs-table tbody tr')).toHaveCount(1);
  await expect(pagination).toContainText('Página 2 de 2');

  const accessibility = await new AxeBuilder({ page }).include('.docs-list-section').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('documents-pagination.png'), fullPage: true });
});

test('Documentos contiene los títulos largos y sus etiquetas accesibles dentro de la tabla', async ({ page }, testInfo) => {
  await login(page);
  await mockDocumentSupport(page);
  await page.route('**/api/documentos-estudiantes/documentos**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [{ ...documentFixture(1), titulo: `Certificado-${'Referencia'.repeat(14)}` }], total: 1, pagina: 1, limite: 20 }),
  }));
  await page.goto('/admin/documentos');
  await expect(page.locator('.docs-table tbody tr')).toHaveCount(1);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 1);
  await expect(page.locator('.docs-table thead .sr-only')).toHaveText('Acciones');
  await page.getByRole('button', { name: 'Nueva plantilla', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('documentos-titulo-largo.png') });
});

test('Gestión documental muestra un fallo recuperable y no un vacío falso', async ({ page }) => {
  await login(page);
  await mockDocumentSupport(page);
  await page.route('**/api/documentos-estudiantes/documentos**', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'El servicio documental no respondió. Intenta nuevamente.' }),
  }));

  await page.goto('/admin/documentos');
  await expect(page.getByRole('heading', { name: 'No pudimos cargar los documentos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  await expect(page.getByText('No hay documentos con estos filtros')).toHaveCount(0);
});

test('Convivencia muestra un fallo recuperable y conserva la bandeja reservada', async ({ page }) => {
  await login(page);
  await page.route('**/api/convivencia/resumen', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ activos: 0, en_seguimiento: 0, revisiones_pendientes: 0, cerrados_mes: 0 }),
  }));
  await page.route('**/api/convivencia/casos**', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'Convivencia no está disponible temporalmente. Intenta nuevamente.' }),
  }));

  await page.goto('/admin/convivencia');
  await expect(page.getByRole('heading', { name: 'No pudimos cargar los casos' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  await expect(page.getByText('No hay casos con estos filtros')).toHaveCount(0);
  await expect(page.getByText('Información protegida')).toBeVisible();
});

test('la bandeja operacional bloquea el cierre cuando no puede confirmar pendientes', async ({ page }) => {
  await login(page);
  await page.route('**/api/operaciones/bandeja', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'No fue posible confirmar las tareas operativas. Intenta nuevamente.' }),
  }));

  await page.goto('/admin/operacion');
  await expect(page.getByRole('heading', { name: 'No pudimos cargar las tareas' })).toBeVisible();
  await expect(page.getByText('No se puede confirmar que existan cero pendientes')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirmar cierre operacional' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('Portería ampliada bloquea cifras y formularios si no confirma su operación', async ({ page }) => {
  await login(page);
  await page.route('**/api/visitas/operacion-ampliada/resumen', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'No fue posible confirmar la operación ampliada. Intenta nuevamente.' }),
  }));

  await page.goto('/admin/visitas');
  await page.getByRole('button', { name: 'Operación ampliada' }).click();
  await expect(page.getByRole('heading', { name: 'No pudimos confirmar la operación ampliada' })).toBeVisible();
  await expect(page.getByText('formularios permanecen bloqueados')).toBeVisible();
  await expect(page.getByText('No hay permanencias excedidas.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Crear credencial temporal' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('Analítica muestra el fallo real y permite recuperar los indicadores', async ({ page }, testInfo) => {
  await login(page);
  let rejected = false;
  await page.route('**/api/puntualidad/analitica**', async (route) => {
    if (!rejected) {
      rejected = true;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Las estadísticas no están disponibles temporalmente. Intenta nuevamente.' }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/admin/analiticas');
  await expect(page.getByRole('heading', { name: 'No pudimos calcular las estadísticas' })).toBeVisible();
  await expect(page.locator('.analytics-error-state p')).toHaveText('Las estadísticas no están disponibles temporalmente. Intenta nuevamente.');
  await expect(page.getByText('No fue posible mostrar el análisis.')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('analytics-recoverable-error.png'), fullPage: true });
  await page.getByRole('button', { name: 'Reintentar' }).first().click();
  await expect(page.getByRole('heading', { name: 'Evolución de atrasos' })).toBeVisible();
});

test('Puntualidad no presenta ceros cuando falla la operación del día', async ({ page }) => {
  await login(page);
  await page.route('**/api/puntualidad/resumen-hoy', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'No fue posible confirmar la jornada actual. Intenta nuevamente.' }),
  }));

  await page.goto('/admin/atrasos');
  await expect(page.getByRole('heading', { name: 'No pudimos confirmar la operación de puntualidad' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No pudimos cargar los registros' })).toBeVisible();
  await expect(page.getByText('No hay registros con estos filtros')).toHaveCount(0);
});

test('Configuración bloquea el formulario si no recupera la jornada vigente', async ({ page }) => {
  await login(page);
  await page.route('**/api/puntualidad/config', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'La configuración vigente no está disponible. Intenta nuevamente.' }),
  }));

  await page.goto('/admin/configuracion');
  await expect(page.getByRole('heading', { name: 'No pudimos cargar la jornada configurada' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar jornada' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
});

test('Directorio no convierte una caída en cero coincidencias', async ({ page }) => {
  await login(page);
  await page.route('**/api/directory/staff**', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'El directorio no está disponible temporalmente. Intenta nuevamente.' }),
  }));

  await page.goto('/directorio');
  await expect(page.getByRole('heading', { name: 'No pudimos cargar el directorio' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No encontramos coincidencias' })).toHaveCount(0);
});

test('Portería bloquea cifras y formularios si no confirma información vigente', async ({ page }, testInfo) => {
  await login(page);
  await page.route('**/api/visitas/resumen', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'No fue posible confirmar el estado de acceso. Intenta nuevamente.' }),
  }));

  await page.goto('/admin/visitas');
  await expect(page.getByRole('heading', { name: 'No pudimos confirmar el estado de visitas y retiros' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Registrar visita' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reintentar' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('visits-blocked-error.png'), fullPage: true });
});
