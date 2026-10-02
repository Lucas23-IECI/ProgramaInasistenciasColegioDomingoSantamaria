/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissReleaseNotes } from './helpers.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const password = process.env.DEFAULT_USER_PASSWORD;

const login = async (page) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la prueba local.');
  const response = await page.context().request.post('/api/auth/login', { data: { correo: adminEmail, password } });
  expect(response.ok(), `El acceso de prueba respondió ${response.status()}.`).toBe(true);
  return (await response.json()).user;
};

const resource = {
  id_recurso: 31,
  nombre: 'Proyector portátil',
  categoria: 'Tecnología',
  codigo_interno: 'TEC-031',
  descripcion: 'Equipo para reuniones y actividades internas.',
  ubicacion: 'Secretaría',
  stock_total: 4,
  stock_prestado: 1,
  stock_disponible: 3,
  estado: 'ACTIVO',
  version: 2
};

const mockResources = async (page, requesterId = 12) => {
  const requestPayloads = [];
  const loanPayloads = [];
  await page.route(/\/api\/recursos\/resumen(?:\?.*)?$/u, (route) => route.fulfill({ json: {
    recursos: 4, unidades_disponibles: 8, prestamos_activos: 2, prestamos_vencidos: 1, solicitudes_pendientes: 1
  } }));
  await page.route(/\/api\/recursos\/catalogo(?:\?.*)?$/u, async (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, json: { id_recurso: 88, message: 'El recurso fue agregado al inventario.' } });
    return route.fulfill({ json: { items: [resource], total: 1, page: 1, limit: 12, categories: ['Tecnología'] } });
  });
  await page.route(/\/api\/recursos\/personas(?:\?.*)?$/u, (route) => route.fulfill({ json: {
    people: [{ id: 12, nombre: 'Inspector General', cargo: 'Inspectoría' }]
  } }));
  await page.route(/\/api\/recursos\/prestamos(?:\?.*)?$/u, async (route) => {
    if (route.request().method() === 'POST') {
      loanPayloads.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { id_prestamo: 44, message: 'El préstamo quedó registrado.' } });
    }
    return route.fulfill({ json: { items: [{
      id_prestamo: 7, recurso_nombre: resource.nombre, codigo_interno: resource.codigo_interno,
      usuario_nombre: 'Inspector General', usuario_cargo: 'Inspectoría', cantidad: 1,
      estado: 'ACTIVO', vencido: true, prestado_en: '2026-08-20T12:00:00Z', vence_en: '2026-08-25T12:00:00Z'
    }], total: 1, page: 1, limit: 12 } });
  });
  await page.route(/\/api\/recursos\/solicitudes(?:\?.*)?$/u, async (route) => {
    if (route.request().method() === 'POST') {
      requestPayloads.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: { id_solicitud: 73, message: 'La solicitud quedó enviada para revisión.' } });
    }
    return route.fulfill({ json: { items: [{
      id_solicitud: 9, id_recurso: 31, recurso_nombre: resource.nombre, solicitante_id: requesterId,
      solicitante_nombre: 'Inspector General', solicitante_cargo: 'Inspectoría', cantidad: 1,
      motivo: 'Reunión con el equipo.', estado: 'PENDIENTE', creado_en: '2026-08-29T12:00:00Z', necesita_en: '2026-09-02'
    }], total: 1, page: 1, limit: 12 } });
  });
  return { requestPayloads, loanPayloads };
};

test('la API real expone el módulo vacío sin crear ni cambiar registros', async ({ page }) => {
  await login(page);
  const [summary, catalog, loans, requests] = await Promise.all([
    page.context().request.get('/api/recursos/resumen'),
    page.context().request.get('/api/recursos/catalogo?pagina=1&limite=12'),
    page.context().request.get('/api/recursos/prestamos?pagina=1&limite=12'),
    page.context().request.get('/api/recursos/solicitudes?pagina=1&limite=12')
  ]);
  for (const response of [summary, catalog, loans, requests]) expect(response.status()).toBe(200);
  expect(Array.isArray((await catalog.json()).items)).toBe(true);
  expect(Array.isArray((await loans.json()).items)).toBe(true);
  expect(Array.isArray((await requests.json()).items)).toBe(true);
});

test('el catálogo explica disponibilidad y mantiene accesibilidad crítica', async ({ page }) => {
  await login(page);
  await mockResources(page);
  await page.goto('/admin/recursos');
  await dismissReleaseNotes(page);
  await expect(page.getByRole('heading', { name: 'Recursos internos' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Proyector portátil' })).toBeVisible();
  await expect(page.getByText('3 de 4')).toBeVisible();
  await expect(page.getByText('1 préstamo con devolución vencida')).toBeVisible();
  const accessibility = await new AxeBuilder({ page }).include('.resources-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
});

test('solicitar no confunde la solicitud con una entrega ni altera el stock visible', async ({ page }) => {
  await login(page);
  const fixture = await mockResources(page);
  await page.goto('/admin/recursos');
  await dismissReleaseNotes(page);
  await page.getByRole('button', { name: 'Solicitar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Solicitar recurso' });
  await dialog.getByLabel('Cantidad').fill('2');
  await dialog.getByLabel('¿Para qué lo necesitas?').fill('Actividad pedagógica del martes.');
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('La solicitud quedó enviada para revisión.')).toBeVisible();
  expect(fixture.requestPayloads).toHaveLength(1);
  expect(fixture.requestPayloads[0]).toMatchObject({ id_recurso: 31, cantidad: 2 });
  expect(fixture.loanPayloads).toHaveLength(0);
  await expect(page.getByText('3 de 4')).toBeVisible();
});

test('una entrega directa conserva persona, cantidad y fecha de devolución', async ({ page }) => {
  await login(page);
  const fixture = await mockResources(page);
  await page.goto('/admin/recursos');
  await dismissReleaseNotes(page);
  await page.getByRole('button', { name: 'Prestar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Registrar préstamo' });
  await dialog.getByLabel('Persona').selectOption('12');
  await dialog.getByLabel('Cantidad').fill('2');
  await dialog.getByLabel('Devolución esperada').fill('2026-09-10T15:30');
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('El préstamo quedó registrado.')).toBeVisible();
  expect(fixture.loanPayloads).toHaveLength(1);
  expect(fixture.loanPayloads[0].usuario_id).toBe(12);
  expect(fixture.loanPayloads[0].cantidad).toBe(2);
  expect(fixture.loanPayloads[0].vence_en).toContain('2026-09-10');
});

test('inventario, préstamos y solicitudes caben en 320 px sin desplazamiento horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await login(page);
  await mockResources(page);
  await page.goto('/admin/recursos');
  await dismissReleaseNotes(page);
  for (const tab of ['Inventario', 'Préstamos', 'Solicitudes']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  }
});

test('la confirmación de cancelación mantiene el foco y Escape no cancela la solicitud', async ({ page }) => {
  const user = await login(page);
  await mockResources(page, user.id);
  let cancellations = 0;
  await page.route('**/api/recursos/solicitudes/9/cancelar', (route) => {
    cancellations += 1;
    return route.fulfill({ json: { message: 'Cancelada' } });
  });
  await page.goto('/admin/recursos');
  await dismissReleaseNotes(page);
  await page.getByRole('button', { name: 'Solicitudes', exact: true }).click();
  const trigger = page.getByRole('button', { name: 'Cancelar', exact: true });
  await trigger.click();
  const confirmation = page.getByRole('alertdialog');
  const cancel = confirmation.getByRole('button', { name: 'Cancelar', exact: true });
  const confirm = confirmation.getByRole('button', { name: 'Cancelar solicitud', exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(confirmation).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(cancellations).toBe(0);
});

test('el formulario cubre todo el viewport, ofrece categorías y conserva datos ante error', async ({ page }, testInfo) => {
  await login(page);
  await mockResources(page);
  await page.route(/\/api\/recursos\/catalogo(?:\?.*)?$/u, (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 409, json: { message: 'Ya existe un recurso con ese código interno.' } });
    return route.fulfill({ json: { items: [resource], total: 1, categories: ['Tecnología'] } });
  });
  await page.goto('/admin/recursos');
  await dismissReleaseNotes(page);
  const trigger = page.getByRole('button', { name: 'Agregar recurso', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Agregar recurso' });
  const dimensions = await page.locator('.resources-dialog-backdrop').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, width: rect.width, viewport: window.innerWidth };
  });
  expect(dimensions.x).toBe(0);
  expect(dimensions.width).toBe(dimensions.viewport);
  await expect(dialog.locator('#resource-category-suggestions option[value="Audiovisual"]')).toHaveCount(1);
  const categoryBox = await dialog.getByLabel('Categoría', { exact: true }).boundingBox();
  const codeBox = await dialog.getByLabel('Código interno').boundingBox();
  expect(Math.abs(categoryBox.height - codeBox.height)).toBeLessThanOrEqual(1);
  await dialog.getByLabel('Nombre', { exact: true }).fill('Proyector de prueba');
  await dialog.getByLabel('Categoría', { exact: true }).fill('Audiovisual');
  await dialog.getByLabel('Código interno').fill('TEC-031');
  await dialog.getByRole('button', { name: 'Confirmar' }).click();
  const toast = page.locator('.app-toast');
  await expect(toast).toContainText('Ya existe un recurso');
  await expect(dialog.getByLabel('Nombre', { exact: true })).toHaveValue('Proyector de prueba');
  await page.screenshot({ path: testInfo.outputPath('recurso-error-visible.png'), fullPage: true });
  // El click comprueba que el aviso no esté oculto ni interceptado por el fondo.
  await toast.getByRole('button', { name: 'Cerrar notificación' }).click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
