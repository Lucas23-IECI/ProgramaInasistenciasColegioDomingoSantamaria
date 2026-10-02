/* global process */
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// This suite authenticates against real local QA; never retain credential traces.
test.use({ trace: 'off', video: 'off' });

const authenticate = async (page) => {
  expect(process.env.DEFAULT_USER_PASSWORD, 'Se requieren credenciales locales de prueba').toBeTruthy();
  const response = await page.request.post('/api/auth/login', {
    data: { correo: process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local', password: process.env.DEFAULT_USER_PASSWORD },
  });
  expect(response.status()).toBe(200);
  return (await (await page.request.get('/api/auth/me')).json()).user;
};

const releaseDialog = (page) => page.getByRole('dialog', { name: 'Novedades para tu trabajo diario' });
const reopen = async (page) => {
  await page.getByRole('button', { name: 'Abrir menú de usuario' }).click();
  await page.getByRole('menuitem', { name: 'Novedades de la versión' }).click();
  await expect(releaseDialog(page)).toBeVisible();
};

test('la nueva versión destaca el chat, abre el módulo real y no repite el aviso al regresar', async ({ page }, testInfo) => {
  const user = await authenticate(page);
  // Haber visto la versión anterior no debe ocultar este anuncio.
  await page.addInitScript((id) => localStorage.setItem(`ldsm-release:2026.09.23-cierre-operativo-v2:${id}`, 'seen'), user.id);
  await page.goto('/admin/documentos');
  const dialog = releaseDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Chat interno para tu equipo' })).toBeInViewport();
  await expect(dialog.getByText('Lo encuentras en el icono de conversación de la esquina superior derecha.')).toBeInViewport();
  const openChat = dialog.getByRole('button', { name: 'Abrir chat interno', exact: true });
  await expect(openChat).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('anuncio-chat.png') });
  await openChat.click();
  await expect(page).toHaveURL(/\/chat$/u);
  await expect(page.getByRole('heading', { name: 'Chat interno', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/documentos$/u);
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Gestión documental', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  // El acceso habitual debe seguir funcionando tras descartar el anuncio.
  await page.getByRole('button', { name: /^Abrir chat interno/u }).click();
  await expect(page).toHaveURL(/\/admin\/documentos$/u);
  const dock = page.getByRole('region', { name: 'Chat rápido', exact: true });
  await expect(dock).toBeVisible();
  await dock.getByRole('button', { name: 'Abrir chat completo', exact: true }).click();
  await expect(page).toHaveURL(/\/chat$/u);
});

test('las novedades permiten continuar sin entrar al chat y conservan navegación por teclado', async ({ page }) => {
  await authenticate(page);
  await page.goto('/admin/documentos');
  const dialog = releaseDialog(page);
  const close = dialog.getByRole('button', { name: 'Cerrar novedades' });
  const understood = dialog.getByRole('button', { name: 'Entendido' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(understood).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/admin\/documentos$/u);
  await reopen(page);
  await understood.click();
  await expect(dialog).toHaveCount(0);
  await reopen(page);
  await close.click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Gestión documental', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('una cuenta sin chat no recibe una invitación a una función no habilitada', async ({ page }) => {
  await authenticate(page);
  // Simula exclusivamente la presentación de permisos. No prueba autorización del servidor.
  await page.route('**/api/auth/me', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.user.permissions = data.user.permissions.filter((permission) => !permission.startsWith('chat.'));
    await route.fulfill({ response, json: data });
  });
  await page.goto('/admin/documentos');
  const dialog = releaseDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Chat interno para tu equipo' })).toHaveCount(0);
  await expect(dialog.getByRole('heading', { name: 'Chat interno vinculado al trabajo' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Abrir chat interno' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Entendido' }).click();
  await expect(page.getByRole('button', { name: /^Abrir chat interno/u })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Gestión documental', exact: true })).toBeVisible();
});

test('el anuncio conserva contraste, controles y ancho en tema claro y oscuro', async ({ page }, testInfo) => {
  await authenticate(page);
  if (testInfo.project.name === 'movil-android') await page.setViewportSize({ width: 360, height: 640 });
  for (const theme of ['light', 'dark']) {
    await page.goto('/healthz');
    await page.evaluate((value) => localStorage.setItem('ldsm-theme', value), theme);
    await page.goto('/admin/documentos');
    const dialog = releaseDialog(page);
    await expect(dialog).toBeVisible();
    if (theme === 'light') await expect(page.locator('body')).toHaveClass(/light-mode/u);
    else await expect(page.locator('body')).not.toHaveClass(/light-mode/u);
    await expect(dialog.getByRole('heading', { name: 'Chat interno para tu equipo' })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Entendido' })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Cerrar novedades' })).toBeInViewport();
    const accessibility = await new AxeBuilder({ page }).include('.release-notes').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(accessibility.violations.filter(({ impact }) => ['critical', 'serious'].includes(impact))).toEqual([]);
    const geometry = await dialog.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom, width: window.innerWidth, height: window.innerHeight, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height + 1);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    await dialog.getByRole('button', { name: 'Abrir chat interno', exact: true }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: 'Abrir chat interno', exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath(`anuncio-${theme}.png`) });
  }
});
