import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Buffer } from 'node:buffer';

// Browser-only fixtures: all API traffic is intercepted. No school records,
// memberships, files or credentials are created or changed by these checks.
const DATE = '2026-09-25T13:10:00.000Z';
const IMAGE_WIDTH = 640;

async function mockMedia(page, { theme = 'light' } = {}) {
  const imageData = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 420;
    const drawing = canvas.getContext('2d');
    drawing.fillStyle = '#e5eef3';
    drawing.fillRect(0, 0, 640, 420);
    drawing.fillStyle = '#21516b';
    drawing.fillRect(44, 42, 552, 336);
    drawing.fillStyle = '#ffffff';
    drawing.font = 'bold 32px Arial';
    drawing.fillText('IMAGEN DE PRUEBA', 112, 190);
    drawing.font = '20px Arial';
    drawing.fillText('Sin datos institucionales reales', 128, 236);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const imageBytes = Buffer.from(imageData, 'base64');
  const state = { failImage: false, failAvatar: false, version: 'version-1', previews: [], downloads: [], photos: [] };
  const group = () => ({ id_conversacion: 101, tipo: 'GRUPO', titulo: 'Coordinación de prueba', nombre: 'Coordinación de prueba', ultimo_mensaje: 'Foto del material de prueba', ultimo_mensaje_en: DATE, foto_version: state.version });
  const attachments = [
    { id_adjunto: 7, nombre: 'Material de prueba.png', mime_type: 'image/png' },
    { id_adjunto: 8, nombre: 'Resumen de prueba.pdf', mime_type: 'application/pdf' },
    { id_adjunto: 9, nombre: 'No es una foto.png', mime_type: 'image/svg+xml' },
  ];
  await page.addInitScript(({ selectedTheme }) => {
    localStorage.setItem('ldsm-theme', selectedTheme);
    const originalGet = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key) {
      return String(key).startsWith('ldsm-release:') ? 'seen' : originalGet.call(this, key);
    };
  }, { selectedTheme: theme });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/auth/me') return json({ user: { id: 1, nombre: 'Cuenta de prueba', correo: 'media@example.test', rol: 'inspector', permissions: ['chat.access', 'chat.direct.create', 'chat.group.create', 'chat.attach'] } });
    if (path.endsWith('/eventos')) return route.fulfill({ status: 204 });
    if (path === '/api/chat/resumen') return json({ no_leidos: 0, urgentes: 0 });
    if (path === '/api/chat/directorio') return json([{ id: 2, usuario_id: 2, nombre: 'Colega de prueba', correo: 'colega@example.test', cargo: 'Coordinación' }]);
    if (path === '/api/chat/conversaciones') return json([group()]);
    if (path === '/api/chat/conversaciones/101') return json({ ...group(), miembro_rol: 'PROPIETARIO', members: [{ usuario_id: 1, nombre: 'Cuenta de prueba', rol: 'PROPIETARIO' }, { usuario_id: 2, nombre: 'Colega de prueba', rol: 'MIEMBRO' }], pinned: [] });
    if (path.endsWith('/mensajes')) return json(attachments.map((file, index) => ({ id_mensaje: index + 1, id_conversacion: 101, enviado_por: 2, autor_nombre: 'Colega de prueba', contenido: `Archivo adjunto: ${file.nombre}`, tipo: 'NORMAL', enviado_en: DATE, adjuntos: [file], eliminado_en: null })));
    if (path.endsWith('/leer')) return json({ ok: true });
    if (path.endsWith('/foto')) {
      state.photos.push(url.searchParams.get('v'));
      return state.failAvatar ? json({ message: 'Foto no disponible.' }, 404) : route.fulfill({ contentType: 'image/png', headers: { 'Cache-Control': 'no-store' }, body: imageBytes });
    }
    if (path.endsWith('/vista')) {
      state.previews.push(path);
      return state.failImage ? json({ message: 'Vista previa no disponible.' }, 404) : route.fulfill({ contentType: 'image/png', headers: { 'Cache-Control': 'no-store' }, body: imageBytes });
    }
    if (/\/adjuntos\/\d+$/.test(path)) {
      state.downloads.push(path);
      return route.fulfill({ contentType: path.endsWith('/7') ? 'image/png' : 'application/pdf', body: path.endsWith('/7') ? imageBytes : Buffer.from('%PDF-1.4\n%%EOF') });
    }
    if (path === '/api/notificaciones') return json({ items: [], unread: 0, pagination: { page: 1, pages: 1 } });
    return json({});
  });
  return state;
}

async function openPhoto(page) {
  await page.goto('/chat/101');
  const button = page.getByRole('button', { name: 'Ver imagen Material de prueba.png', exact: true });
  await expect(button).toBeVisible();
  await expect(button.locator('img')).toHaveJSProperty('naturalWidth', IMAGE_WIDTH);
  await button.click();
  const dialog = page.getByRole('dialog', { name: 'Material de prueba.png', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('img')).toHaveJSProperty('naturalWidth', IMAGE_WIDTH);
  return dialog;
}

test('fotos: visor accesible con foco, zoom, descarga y cierre sin perder conversación', async ({ page }) => {
  const state = await mockMedia(page);
  const dialog = await openPhoto(page);
  const close = dialog.getByRole('button', { name: 'Cerrar imagen', exact: true });
  await expect(close).toBeFocused();
  await expect(page.locator('#root')).toHaveJSProperty('inert', true);
  await close.press('Tab');
  await expect(dialog.locator('.chat-media-viewer__stage')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Ampliar imagen', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator('.chat-media-viewer__stage')).toBeFocused();
  await dialog.getByRole('button', { name: 'Ampliar imagen', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Ajustar imagen a la pantalla', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.chat-media-viewer__stage')).toHaveClass(/is-zoomed/);
  await dialog.getByRole('button', { name: 'Ajustar imagen a la pantalla', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Descargar imagen', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe('Material de prueba.png');
  expect(state.downloads).toEqual(['/api/chat/conversaciones/101/adjuntos/7']);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#root')).toHaveJSProperty('inert', false);
  await expect(page.getByRole('button', { name: 'Ver imagen Material de prueba.png', exact: true })).toBeFocused();
  await expect(page).toHaveURL(/\/chat\/101$/);
});

test('las vistas previas requieren MIME de imagen permitido y conservan descargas convencionales', async ({ page }) => {
  const state = await mockMedia(page);
  await page.goto('/chat/101');
  await expect(page.locator('.chat-photo-attachment__preview')).toHaveCount(1);
  await expect(page.locator('.chat-attachment')).toHaveCount(3);
  await expect(page.getByRole('button', { name: /Resumen de prueba.pdf/ })).toContainText('Descargar archivo');
  await expect(page.getByRole('button', { name: /No es una foto.png/ })).toContainText('Descargar archivo');
  expect(state.previews.every((path) => path === '/api/chat/conversaciones/101/adjuntos/7/vista')).toBe(true);
  await expect(page.locator('.chat-thread__icon img')).toHaveAttribute('src', '/api/chat/conversaciones/101/foto?v=version-1');
  await expect(page.locator('.chat-thread__icon img')).toHaveJSProperty('naturalWidth', IMAGE_WIDTH);
});

test('si una miniatura falla se mantiene la descarga y no queda una imagen rota', async ({ page }) => {
  const state = await mockMedia(page);
  state.failImage = true;
  await page.goto('/chat/101');
  await expect(page.getByText('Vista previa no disponible.', { exact: true })).toBeVisible();
  await expect(page.locator('.chat-photo-attachment__preview')).toHaveCount(0);
  const downloaded = page.waitForEvent('download');
  await page.locator('.chat-photo-attachment').getByRole('button', { name: /Material de prueba.png/ }).click();
  expect((await downloaded).suggestedFilename()).toBe('Material de prueba.png');
  expect(state.downloads).toHaveLength(1);
});

test('una foto de grupo fallida no impide mostrar una nueva versión', async ({ page }) => {
  const state = await mockMedia(page);
  state.failAvatar = true;
  await page.goto('/chat/101');
  await expect(page.locator('.chat-thread__icon')).toBeVisible();
  await expect.poll(() => state.photos.length).toBeGreaterThan(0);
  await expect(page.locator('.chat-thread__icon img')).toHaveCount(0);
  state.failAvatar = false;
  state.version = 'version-2';
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ldsm:chat-message', { detail: { conversation_id: 101 } })));
  await expect(page.locator('.chat-thread__icon img')).toHaveAttribute('src', '/api/chat/conversaciones/101/foto?v=version-2');
  await expect(page.locator('.chat-thread__icon img')).toHaveJSProperty('naturalWidth', IMAGE_WIDTH);
});

test('visor de fotos adaptado a celular y escritorio con contraste oscuro', async ({ page }, testInfo) => {
  await mockMedia(page, { theme: 'dark' });
  const dialog = await openPhoto(page);
  for (const width of [320, 375, 414, 1280]) {
    await page.setViewportSize({ width, height: 820 });
    await expect(dialog.getByRole('button', { name: 'Cerrar imagen', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Descargar imagen', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await dialog.boundingBox();
    expect(box.width).toBeLessThanOrEqual(width);
    expect(box.height).toBeLessThanOrEqual(820);
    if (width === 375 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`chat-foto-oscuro-${width}.png`), scale: 'css' });
  }
  const audit = await new AxeBuilder({ page }).include('.chat-media-viewer').analyze();
  expect(audit.violations).toEqual([]);
});
