import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Buffer } from 'node:buffer';

// Browser behavior with every API intercepted. Real persistence is covered by
// backend/scripts/verify-chat-presentation.js, not these deterministic fixtures.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const initial = () => ({ fondo: 'institucional', tamano_texto: 'normal', fondo_data: null });
const dialog = (page) => page.getByRole('dialog', { name: 'Apariencia del chat', exact: true });
async function fixture(page) {
  const state = { account: 1, preferences: { 1: initial(), 2: initial() }, writes: [], getStatus: 200, failSave: false, listStatus: 200, saveGate: null };
  await page.addInitScript(() => {
    localStorage.setItem('ldsm-theme', 'light');
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key) { return String(key).startsWith('ldsm-release:') ? 'seen' : original.call(this, key); };
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ json: body, status });
    if (path === '/api/auth/me') return json({ user: { id: state.account, nombre: `Cuenta QA ${state.account}`, rol: 'inspector', permissions: ['chat.access', 'chat.attach', 'chat.urgent', 'chat.group.create'] } });
    if (path.endsWith('/eventos')) return route.fulfill({ status: 204 });
    if (path === '/api/chat/apariencia') {
      if (request.method() === 'GET') return json(state.getStatus === 200 ? state.preferences[state.account] : { message: 'No pudimos cargar tu apariencia.' }, state.getStatus);
      const owner = state.account, body = request.postDataJSON();
      state.writes.push({ owner, body });
      if (state.saveGate) await state.saveGate;
      if (state.failSave) return json({ message: 'No pudimos guardar tu apariencia. Intenta nuevamente.' }, 503);
      state.preferences[owner] = body;
      return json(body);
    }
    if (path === '/api/chat/conversaciones') return json(state.listStatus === 200 ? [{ id_conversacion: 101, tipo: 'GRUPO', titulo: 'Equipo de prueba' }] : { message: 'Acceso retirado.' }, state.listStatus);
    if (path === '/api/chat/directorio') return json([]);
    if (path === '/api/chat/conversaciones/101') return json({ id_conversacion: 101, tipo: 'GRUPO', titulo: 'Equipo de prueba', nombre: 'Equipo de prueba', miembro_rol: 'MIEMBRO', members: [], pinned: [] });
    if (path.endsWith('/mensajes')) return json([{ id_mensaje: 1, enviado_por: 9, autor_nombre: 'Equipo QA', contenido: 'Mensaje de prueba visible', enviado_en: '2026-09-27T12:00:00.000Z', adjuntos: [] }]);
    if (path === '/api/notificaciones') return json({ items: [], unread: 0 });
    return json({});
  });
  return state;
}
async function openAppearance(page) {
  await page.goto('/chat');
  await page.getByRole('button', { name: 'Apariencia del chat', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
const save = (page) => dialog(page).getByRole('button', { name: 'Guardar apariencia', exact: true }).click();

test('cancelar no aplica cambios; guardar y recargar conserva fondo y tamaño', async ({ page }) => {
  const state = await fixture(page);
  await openAppearance(page);
  await dialog(page).getByRole('button', { name: 'Arena', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(state.writes).toHaveLength(0);
  await expect(page.locator('.chat-page')).toHaveAttribute('data-background', 'institucional');
  await page.getByRole('button', { name: 'Apariencia del chat', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: 'Institucional', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog(page).getByRole('button', { name: 'Salvia', exact: true }).click();
  await dialog(page).getByLabel('Tamaño de los mensajes').selectOption('grande');
  await save(page);
  await expect(dialog(page)).toHaveCount(0);
  await page.goto('/chat/101');
  await expect(page.locator('.chat-page')).toHaveAttribute('data-background', 'salvia');
  await expect(page.locator('.chat-page')).toHaveAttribute('data-text-size', 'grande');
  expect(await page.locator('.chat-bubble').evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize) / Number.parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeCloseTo(1.0625, 3);
  expect(state.writes).toHaveLength(1);
});

test('imagen propia se previsualiza, guarda y restablece sin guardarla en localStorage', async ({ page }, info) => {
  const state = await fixture(page);
  await openAppearance(page);
  await dialog(page).locator('input[type=file]').setInputFiles({ name: 'fondo-qa.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog(page).locator('.chat-background-preview')).toHaveAttribute('data-background', 'personalizado');
  await save(page);
  await page.goto('/chat/101');
  await expect(page.locator('.chat-page')).toHaveAttribute('data-background', 'personalizado');
  expect(await page.locator('.chat-messages').evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('data:image/png');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('data:image');
  await page.screenshot({ path: info.outputPath('chat-compacto-fondo.png'), scale: 'css' });
  await openAppearance(page);
  await dialog(page).getByRole('button', { name: 'Restablecer apariencia', exact: true }).click();
  await save(page);
  await expect(page.locator('.chat-page')).toHaveAttribute('data-background', 'institucional');
  expect(state.writes.at(-1).body.fondo_data).toBeNull();
});

test('errores de carga y guardado permiten reintentar sin confirmar cambios fallidos', async ({ page }) => {
  const state = await fixture(page);
  state.getStatus = 503;
  await openAppearance(page);
  await expect(dialog(page).getByRole('alert')).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Guardar apariencia', exact: true })).toHaveCount(0);
  state.getStatus = 200;
  await dialog(page).getByRole('button', { name: 'Reintentar', exact: true }).click();
  await dialog(page).getByRole('button', { name: 'Azul', exact: true }).click();
  state.failSave = true;
  await save(page);
  await expect(dialog(page).getByRole('alert')).toContainText('No pudimos guardar');
  await expect(page.locator('.chat-page')).toHaveAttribute('data-background', 'institucional');
  state.failSave = false;
  await save(page);
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.chat-page')).toHaveAttribute('data-background', 'azul');
});

test('archivos no admitidos muestran la causa sin reemplazar el fondo', async ({ page }) => {
  const state = await fixture(page);
  await openAppearance(page);
  for (const file of [
    { name: 'no.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') },
    { name: 'grande.png', mimeType: 'image/png', buffer: Buffer.alloc(4 * 1024 * 1024 + 1) },
  ]) {
    await dialog(page).locator('input[type=file]').setInputFiles(file);
    await expect(dialog(page).getByRole('alert')).toContainText('JPG o PNG de hasta 4 MB');
    await expect(dialog(page).locator('.chat-background-preview')).toHaveAttribute('data-background', 'institucional');
  }
  expect(state.writes).toHaveLength(0);
});

test('guardado pendiente evita duplicados y respuesta antigua no pasa a otra cuenta', async ({ page }) => {
  const state = await fixture(page);
  let release;
  state.saveGate = new Promise((resolve) => { release = resolve; });
  try {
    await openAppearance(page);
    await dialog(page).getByRole('button', { name: 'Arena', exact: true }).click();
    await dialog(page).getByRole('button', { name: 'Guardar apariencia', exact: true }).dblclick();
    await expect.poll(() => state.writes.length).toBe(1);
    await expect(dialog(page).getByRole('button', { name: 'Guardando…', exact: true })).toBeDisabled();
    state.account = 2;
    await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'ldsm:session-sync', newValue: JSON.stringify({ type: 'SIGNED_IN', at: Date.now() }) })));
    await expect(dialog(page)).toHaveCount(0);
    release();
    await expect(page.locator('.chat-page')).toHaveAttribute('data-background', 'institucional');
    await page.getByRole('button', { name: 'Apariencia del chat', exact: true }).click();
    await expect(dialog(page).getByRole('button', { name: 'Institucional', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(state.preferences[2]).toEqual(initial());
  } finally { release(); }
});

test('revocar acceso retira el diálogo y la imagen privada en preparación', async ({ page }) => {
  const state = await fixture(page);
  await openAppearance(page);
  await dialog(page).locator('input[type=file]').setInputFiles({ name: 'privada.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog(page).locator('.chat-background-preview')).toHaveAttribute('data-background', 'personalizado');
  state.listStatus = 403;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ldsm:chat-message', { detail: { conversation_id: 999 } })));
  await expect(dialog(page)).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test('diálogo usable con teclado y sin desborde en tamaños de teléfono y escritorio', async ({ page }, info) => {
  await fixture(page);
  await openAppearance(page);
  for (const width of [320, 375, 414, 1440]) {
    await page.setViewportSize({ width, height: 820 });
    expect(await dialog(page).evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    const bounds = await dialog(page).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await dialog(page).getByRole('button', { name: 'Guardar apariencia', exact: true }).scrollIntoViewIfNeeded();
    if ([375, 1440].includes(width)) await page.screenshot({ path: info.outputPath(`apariencia-${width}.png`), scale: 'css' });
  }
  expect((await new AxeBuilder({ page }).include('.chat-appearance-dialog').analyze()).violations).toEqual([]);
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press('Tab');
    expect(await dialog(page).evaluate((el) => el.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Apariencia del chat', exact: true })).toBeFocused();
});
