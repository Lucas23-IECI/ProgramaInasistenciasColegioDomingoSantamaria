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
  await page.goto('/admin');
  await dismissReleaseNotes(page);
};

const mockSearch = (page) => page.route('**/api/busqueda-global?q=*', async (route) => {
  const query = new URL(route.request().url()).searchParams.get('q');
  if (query === 'fallo') {
    await route.fulfill({ status: 503, json: { message: 'La búsqueda no está disponible temporalmente.' } });
    return;
  }
  await route.fulfill({
    json: {
      query,
      total: 2,
      groups: [{
        key: 'students',
        label: 'Estudiantes',
        items: [{ id: '41', type: 'student', title: 'Camila Prueba', subtitle: '7° Básico', url: '/admin/estudiantes?estudiante_id=41' }],
      }, {
        key: 'followUp',
        label: 'Seguimientos',
        items: [{ id: '9', type: 'follow-up', title: 'Revisión de antecedentes', subtitle: 'SEG-009', meta: 'Abierto · Prioridad alta', url: '/admin/seguimiento/9' }],
      }],
    },
  });
});

test('la API real consulta PostgreSQL y conserva un contrato sin datos identificatorios', async ({ page }) => {
  await login(page);
  const response = await page.context().request.get('/api/busqueda-global?q=an');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(Array.isArray(body.groups)).toBe(true);
  expect(Number.isInteger(body.total)).toBe(true);
  for (const group of body.groups) {
    for (const item of group.items) {
      expect(Object.keys(item)).not.toContain('rut');
      expect(Object.keys(item)).not.toContain('documento');
      expect(Object.keys(item)).not.toContain('correo');
      expect(item.url).toMatch(/^\//u);
    }
  }
});

test('la búsqueda global abre por teclado, informa privacidad y navega al registro existente', async ({ page }) => {
  await mockSearch(page);
  await login(page);

  const trigger = page.getByRole('button', { name: 'Buscar en el sistema' });
  await expect(trigger).toBeVisible();
  await page.keyboard.press('Control+K');
  const dialog = page.getByRole('dialog', { name: 'Buscar en el sistema' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Solo aparecen secciones y registros habilitados por tus permisos.')).toBeVisible();
  await dialog.getByRole('searchbox', { name: 'Nombre, caso o registro' }).fill('camila');
  await expect(dialog.getByRole('button', { name: /Camila Prueba/u })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /Revisión de antecedentes/u })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).include('.notification-history').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(accessibility.violations.filter((item) => ['critical', 'serious'].includes(item.impact))).toEqual([]);
  await dialog.getByRole('button', { name: /Camila Prueba/u }).click();
  await expect(page).toHaveURL(/\/admin\/estudiantes\?estudiante_id=41$/u);
});

test('Escape devuelve el foco y un fallo nunca se muestra como búsqueda vacía', async ({ page }) => {
  await mockSearch(page);
  await login(page);
  const trigger = page.getByRole('button', { name: 'Buscar en el sistema' });
  await trigger.click();
  await page.getByRole('searchbox', { name: 'Nombre, caso o registro' }).fill('fallo');
  await expect(page.getByRole('alert')).toContainText('La búsqueda no está disponible temporalmente.');
  await expect(page.getByText('No encontramos coincidencias')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Buscar en el sistema' })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('la paleta permanece utilizable en móvil sin desbordamiento horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await mockSearch(page);
  await login(page);
  await page.getByRole('button', { name: 'Buscar en el sistema' }).click();
  const dialog = page.getByRole('dialog', { name: 'Buscar en el sistema' });
  await dialog.getByRole('searchbox', { name: 'Nombre, caso o registro' }).fill('camila');
  await expect(dialog.getByRole('button', { name: /Camila Prueba/u })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
