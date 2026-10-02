/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissReleaseNotes } from './helpers.js';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const password = process.env.DEFAULT_USER_PASSWORD;

const login = async (page, destination) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la prueba local.');
  const response = await page.context().request.post('/api/auth/login', {
    data: { correo: adminEmail, password },
  });
  expect(response.ok(), `El acceso de prueba respondió ${response.status()}.`).toBe(true);
  await page.goto(destination);
  await dismissReleaseNotes(page);
};

const expectNoHorizontalOverflow = async (page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
};

test('Gestión documental conserva filtros, ayuda y ficha real sin modificar datos', async ({ page }) => {
  await login(page, '/admin/documentos');
  await expect(page.getByRole('heading', { name: 'Gestión documental' })).toBeVisible();
  await expect(page.getByText('Próximos a vencer')).toBeVisible();

  const expiringResponse = await page.context().request.get('/api/documentos-estudiantes/documentos?vencimiento=true&pagina=1&limite=20');
  expect(expiringResponse.ok(), `Documentos próximos respondió ${expiringResponse.status()}.`).toBe(true);
  const expiring = await expiringResponse.json();
  expect(Array.isArray(expiring.items)).toBe(true);
  const currentDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
  for (const document of expiring.items) {
    expect(document.estado).not.toBe('ARCHIVADO');
    expect(String(document.vence_en).slice(0, 10) >= currentDate).toBe(true);
  }

  await page.getByRole('button', { name: 'Recorrido de gestión documental' }).click();
  const help = page.locator('.driver-popover');
  await expect(help).toBeVisible();
  await help.getByRole('button', { name: 'Siguiente' }).click();
  await expect(help).toContainText('único seguimiento');
  await page.keyboard.press('Escape');

  const documentsResponse = await page.context().request.get('/api/documentos-estudiantes/documentos?pagina=1&limite=20');
  const documents = await documentsResponse.json();
  if (documents.items.length > 0) {
    const selected = documents.items[0];
    await page.goto(`/admin/documentos/ficha/${selected.id_documento_expediente}`);
    await expect(page.getByRole('heading', { name: selected.titulo })).toBeVisible();
    await expect(page.getByText('Historial de versiones')).toBeVisible();
    await expect(page.getByRole('button', { name: /Coordinar/ })).toBeVisible();
  }

  await expectNoHorizontalOverflow(page);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
});

test('Convivencia mantiene alertas protegidas, ayuda y detalle reservado', async ({ page }) => {
  await login(page, '/admin/convivencia');
  await expect(page.getByRole('heading', { name: 'Convivencia escolar' })).toBeVisible();
  await expect(page.getByText('Avisos automáticos protegidos')).toBeVisible();
  await expect(page.getByText(/revisión vencida avisa a su responsable/)).toBeVisible();

  const response = await page.context().request.get('/api/convivencia/casos?pagina=1&limite=20');
  expect(response.ok(), `Casos de Convivencia respondió ${response.status()}.`).toBe(true);
  const cases = await response.json();
  expect(Array.isArray(cases.items)).toBe(true);

  await page.getByRole('button', { name: 'Recorrido de convivencia escolar' }).click();
  const help = page.locator('.driver-popover');
  await expect(help).toBeVisible();
  await help.getByRole('button', { name: 'Siguiente' }).click();
  await expect(help).toContainText('evita repetir');
  await page.keyboard.press('Escape');

  if (cases.items.length > 0) {
    const selected = cases.items[0];
    await page.goto(`/admin/convivencia/${selected.id_caso}`);
    await expect(page.getByText(selected.codigo)).toBeVisible();
    await expect(page.getByRole('button', { name: /Coordinar por chat/ })).toBeVisible();
    await expect(page.getByText('Historial del caso')).toBeVisible();
  }

  await expectNoHorizontalOverflow(page);
  const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
});
