/* global process */
import path from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { dismissReleaseNotes } from './helpers.js';

const password = process.env.DEFAULT_USER_PASSWORD;
const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local';
const routes = [
  '/admin',
  '/admin/operacion',
  '/agenda',
  '/admin/recursos',
  '/admin/documentos',
  '/admin/analiticas',
  '/admin/auditoria',
  '/admin/estudiantes',
];

const seriousViolations = (results) => results.violations
  .filter((violation) => ['critical', 'serious'].includes(violation.impact))
  .map(({ id, impact, nodes }) => ({
    id,
    impact,
    targets: nodes.map((node) => node.target.join(' ')),
  }));

const loginWithDarkTheme = async (page) => {
  test.skip(!password, 'DEFAULT_USER_PASSWORD no está configurada para la prueba local.');
  const response = await page.context().request.post('/api/auth/login', {
    data: { correo: adminEmail, password },
  });
  expect(response.ok(), `El acceso de prueba respondió ${response.status()}.`).toBe(true);

  await page.goto('/admin');
  await dismissReleaseNotes(page);
  if (await page.locator('body').evaluate((element) => element.classList.contains('light-mode'))) {
    const themeButton = page.getByRole('button', { name: 'Activar modo oscuro' });
    await expect(themeButton).toBeVisible();
    await themeButton.click();
  }
  await expect(page.locator('body')).not.toHaveClass(/light-mode/u);
};

const expectAccessibleWithoutOverflow = async (page, context) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect.soft(seriousViolations(results), `Contraste o accesibilidad en ${context}`).toEqual([]);
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll('body *')].filter((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width && rect.right > document.documentElement.clientWidth + 1;
    }).slice(0, 12).map((node) => ({ tag: node.tagName, className: node.className, width: node.getBoundingClientRect().width, right: node.getBoundingClientRect().right })),
  }));
  expect.soft(dimensions.content, `Desborde horizontal en ${context}: ${JSON.stringify(dimensions.overflowing)}`).toBeLessThanOrEqual(dimensions.viewport + 1);
};

test('las pantallas institucionales críticas conservan contraste y ancho en modo oscuro', async ({ page }) => {
  await loginWithDarkTheme(page);

  for (const route of routes) {
    await page.goto(route);
    await dismissReleaseNotes(page);
    await expect(page.locator('#root')).not.toBeEmpty();
    await expect(page).not.toHaveURL(/\/login$/u);
    await expectAccessibleWithoutOverflow(page, route);
  }
});

test('los diálogos críticos conservan contraste, foco y ancho en modo oscuro', async ({ page }, testInfo) => {
  await loginWithDarkTheme(page);

  const dialogs = [
    {
      route: '/admin/operacion',
      open: () => page.getByRole('button', { name: 'Historial' }).first().click(),
      title: /Historial trazable/u,
      close: 'Cerrar historial',
      context: 'historial de tarea',
    },
    {
      route: '/agenda',
      open: () => page.getByRole('button', { name: /Nuevo evento/u }).click(),
      title: 'Crear evento',
      close: 'Cerrar',
      context: 'crear evento',
    },
    {
      route: '/admin/documentos',
      open: () => page.getByRole('button', { name: /Nueva plantilla/u }).click(),
      title: 'Nueva plantilla institucional',
      close: 'Cerrar',
      context: 'nueva plantilla documental',
    },
    {
      route: '/admin/recursos',
      open: () => page.getByRole('button', { name: /Agregar recurso/u }).click(),
      title: 'Agregar recurso',
      close: 'Cerrar',
      context: 'agregar recurso',
    },
  ];

  for (const dialogCase of dialogs) {
    await page.goto(dialogCase.route);
    await dismissReleaseNotes(page);
    await dialogCase.open();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(dialogCase.title);
    await expectAccessibleWithoutOverflow(page, dialogCase.context);
    if (process.env.E2E_CAPTURE_VISUALS === '1') {
      const name = dialogCase.context.replaceAll(' ', '-');
      await page.screenshot({
        path: path.resolve('output', 'playwright', `dark-dialog-${name}-${testInfo.project.name}.png`),
        fullPage: true,
      });
    }
    await page.getByRole('button', { name: dialogCase.close }).click();
    await expect(dialog).toBeHidden();
  }
});
