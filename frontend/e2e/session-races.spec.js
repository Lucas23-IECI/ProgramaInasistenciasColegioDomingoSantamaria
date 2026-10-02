/* global process */
import { test, expect } from '@playwright/test';
import { dismissReleaseNotes } from './helpers.js';

// The local login is real even when a selected response is delayed or mocked.
test.use({ trace: 'off', video: 'off' });

const login = async (page) => {
  test.skip(!process.env.DEFAULT_USER_PASSWORD, 'Faltan credenciales locales de prueba.');
  const response = await page.request.post('/api/auth/login', { data: {
    correo: process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local', password: process.env.DEFAULT_USER_PASSWORD
  } });
  expect(response.status()).toBe(200);
  await page.goto('/admin');
  await dismissReleaseNotes(page);
};

test('el foco no restaura la sesión mientras el cierre sigue pendiente', async ({ page }) => {
  await login(page);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let logoutStarted;
  const started = new Promise((resolve) => { logoutStarted = resolve; });
  await page.route('**/api/auth/logout', async (route) => {
    logoutStarted();
    await pending;
    await route.continue();
  });
  try {
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).first().click();
    await started;
    const focusProbe = page.waitForResponse('**/api/auth/me', { timeout: 1000 }).catch(() => null);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await focusProbe;
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
    // Varias comprobaciones durante el cierre, sin asumir que el primer render es definitivo.
    for (let index = 0; index < 3; index += 1) {
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(page.getByRole('heading', { name: 'Gestión institucional' })).toHaveCount(0);
    }
  } finally { release(); }
  await expect.poll(async () => (await page.request.get('/api/auth/me')).status()).toBe(401);
});

test('una comprobación antigua no borra una sesión iniciada en otra pestaña', async ({ page }) => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let probeStarted;
  const started = new Promise((resolve) => { probeStarted = resolve; });
  let holdProbe = false;
  await page.route('**/api/auth/me', async (route) => {
    if (holdProbe) {
      holdProbe = false;
      probeStarted();
      await pending;
      await route.fulfill({ status: 401, json: { message: 'Sesión anterior expirada' } });
    } else await route.continue();
  });
  await page.goto('/admin/documentos?estado=VENCIDO');
  await page.bringToFront();
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  holdProbe = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await started;
  const second = await page.context().newPage();
  try {
    await second.goto('/login');
    await second.getByLabel('Correo electrónico').fill(process.env.E2E_ADMIN_EMAIL || 'admin@ldsm.local');
    await second.getByLabel('Contraseña', { exact: true }).fill(process.env.DEFAULT_USER_PASSWORD);
    await second.getByRole('button', { name: 'Ingresar al sistema' }).click();
    await expect(second).not.toHaveURL(/\/login$/);
    // Inspect the original tab as a person would. Chromium can throttle a
    // background tab's React rendering even after its auth/me returned 200.
    // The old 401 remains held until AFTER this new session is confirmed.
    await page.bringToFront();
    await expect(page).toHaveURL(/\/admin\/documentos\?estado=VENCIDO$/);
    const staleResponse = page.waitForResponse((response) => response.url().endsWith('/auth/me') && response.status() === 401);
    release();
    await staleResponse;
    await expect(page.getByRole('heading', { name: 'Gestión documental' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toHaveCount(0);
  } finally { release(); await second.close(); }
});

test('el login distingue una sesión no verificable de una sesión cerrada', async ({ page }) => {
  await page.route('**/api/auth/me', (route) => route.fulfill({ status: 503, json: { message: 'No disponible' } }));
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'No pudimos verificar tu sesión' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ingresar al sistema' })).toHaveCount(0);
  await page.unroute('**/api/auth/me');
  await page.getByRole('button', { name: 'Reintentar conexión' }).click();
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
});

test('el cambio obligatorio de contraseña conserva el módulo solicitado', async ({ page }) => {
  await login(page);
  const { user } = await (await page.request.get('/api/auth/me')).json();
  let mustChange = true;
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { user: { ...user, debe_cambiar_password: mustChange } } }));
  // Simula el contrato, sin cambiar la contraseña real de ninguna cuenta.
  await page.route('**/api/auth/change-password', (route) => {
    mustChange = false;
    return route.fulfill({ json: { user: { ...user, debe_cambiar_password: false } } });
  });
  await page.goto('/admin/documentos?estado=VENCIDO');
  await expect(page).toHaveURL(/\/cambiar-clave$/);
  await page.getByLabel('Contraseña temporal o actual', { exact: true }).fill('TemporalSoloPrueba123');
  await page.getByLabel('Nueva contraseña', { exact: true }).fill('NuevaSoloPrueba123');
  await page.getByLabel('Confirmar nueva contraseña', { exact: true }).fill('NuevaSoloPrueba123');
  await page.getByRole('button', { name: /Guardar|Actualizar/ }).click();
  await expect(page).toHaveURL(/\/admin\/documentos\?estado=VENCIDO$/);
});
