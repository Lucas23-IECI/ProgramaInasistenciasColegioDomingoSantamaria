import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

// All API requests are intercepted. These regressions exercise browser session
// transitions and presentation only; they never access a school or QA database.
const account = {
  id: 1, nombre: 'Cuenta de prueba', correo: 'chat-session@example.test', rol: 'inspector',
  permissions: ['chat.access', 'chat.direct.create', 'chat.attach', 'documents.view'],
};
const conversation = {
  id_conversacion: 101, tipo: 'CONTEXTO', nombre: 'Documento de prueba', titulo: 'Documento de prueba',
  contexto_tipo: 'DOCUMENTO', contexto_id: 51, miembro_rol: 'MIEMBRO', pinned: [],
  members: [{ usuario_id: 1, nombre: account.nombre }, { usuario_id: 2, nombre: 'Camila de prueba' }],
};

async function fixture(page, { permissions = account.permissions, role = 'MIEMBRO' } = {}) {
  const state = { signedIn: true, listStatus: 200, uploads: [], preferenceGate: null, preferenceAttempts: 0, preferencesResolved: false, retentionWrites: 0 };
  const sessionUser = { ...account, permissions };
  await page.addInitScript(() => {
    localStorage.setItem('ldsm-theme', 'light');
    const originalGet = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key) {
      return String(key).startsWith('ldsm-release:') ? 'seen' : originalGet.call(this, key);
    };
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/auth/me') return state.signedIn ? json({ user: sessionUser }) : json({ message: 'Sesión finalizada.' }, 401);
    if (path === '/api/auth/logout') { state.signedIn = false; return json({ ok: true }); }
    if (path === '/api/auth/login') { state.signedIn = true; return json({ user: sessionUser }); }
    if (path.endsWith('/eventos')) return route.fulfill({ status: 204 });
    if (path === '/api/chat/resumen') return json({ no_leidos: 0 });
    if (path === '/api/chat/directorio') return json([{ id: 2, nombre: 'Camila de prueba', correo: 'camila@example.test' }]);
    if (path === '/api/chat/conversaciones') return state.listStatus === 200
      ? json([conversation]) : json({ message: 'Tu cuenta ya no tiene acceso al chat.' }, state.listStatus);
    if (path === '/api/chat/conversaciones/101') return json({ ...conversation, miembro_rol: role });
    if (path === '/api/chat/conversaciones/101/preferencias') {
      state.preferenceAttempts += 1;
      if (state.preferenceGate) await state.preferenceGate;
      state.preferencesResolved = true;
      return json({ ok: true });
    }
    if (path === '/api/chat/conversaciones/101/configuracion') { state.retentionWrites += 1; return json({ ok: true }); }
    if (path === '/api/chat/conversaciones/101/mensajes') return json([{
      id_mensaje: 1, id_conversacion: 101, enviado_por: 2, autor_nombre: 'Camila de prueba',
      contenido: 'Contenido privado de prueba', tipo: 'NORMAL', enviado_en: '2026-09-25T12:00:00.000Z',
      lecturas: 1, lecturas_otros: 0, adjuntos: [],
    }]);
    if (path === '/api/chat/conversaciones/101/adjuntos') {
      state.uploads.push(request.postDataJSON());
      return json({ id_adjunto: 1 }, 201);
    }
    if (path === '/api/notificaciones') return json({ items: [], unread: 0, pagination: { page: 1, pages: 1 } });
    return json({});
  });
  return state;
}

async function openThread(page) {
  await page.goto('/chat/101');
  await expect(page.locator('.chat-composer textarea')).toBeVisible();
  await expect(page.getByText('Contenido privado de prueba', { exact: true })).toBeVisible();
}

test('un adjunto todavía en FileReader no se envía con la sesión siguiente del mismo usuario', async ({ page }) => {
  const state = await fixture(page);
  await page.addInitScript(() => {
    const originalRead = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function readAsDataURL(file) {
      window.releaseChatFileRead = () => new Promise((resolve) => {
        this.addEventListener('loadend', () => setTimeout(resolve, 50), { once: true });
        originalRead.call(this, file);
      });
    };
  });
  await openThread(page);
  await page.locator('.chat-composer input[type="file"]').setInputFiles({
    name: 'prueba-sesion.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nfixture\n%%EOF'),
  });
  await expect.poll(() => page.evaluate(() => typeof window.releaseChatFileRead)).toBe('function');
  await expect(page.locator('.chat-composer textarea')).toBeDisabled();
  await page.getByRole('button', { name: 'Abrir menú de usuario', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel('Correo electrónico', { exact: true }).fill(account.correo);
  await page.getByLabel('Contraseña', { exact: true }).fill('clave-ficticia-de-prueba');
  await page.getByRole('button', { name: 'Ingresar al sistema', exact: true }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Abrir menú de usuario', exact: true })).toBeVisible();
  await page.evaluate(() => window.releaseChatFileRead());
  expect(state.uploads).toHaveLength(0);
  await expect(page.getByText('Archivo adjuntado.', { exact: true })).toHaveCount(0);
});

test('un 403 en la lista elimina el hilo abierto y su borrador aunque el detalle todavía responda', async ({ page }) => {
  const state = await fixture(page);
  await openThread(page);
  await page.locator('.chat-composer textarea').fill('Borrador privado que debe retirarse');
  state.listStatus = 403;
  // A different conversation invalidates the global list, not this thread's loader.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ldsm:chat-message', { detail: { conversation_id: 999 } })));
  await expect(page.locator('.chat-thread--error').getByText('Tu cuenta ya no tiene acceso al chat.')).toBeVisible();
  await expect(page.locator('.chat-bubble')).toHaveCount(0);
  await expect(page.locator('.chat-composer textarea')).toHaveCount(0);
  state.listStatus = 200;
  await page.locator('.chat-thread--error').getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.locator('.chat-composer textarea')).toBeVisible();
  await expect(page.locator('.chat-composer textarea')).toHaveValue('');
});

test('abrir un chat contextual por URL directa recupera el regreso desde sus datos', async ({ page }) => {
  await fixture(page);
  await openThread(page);
  await expect(page).toHaveURL(/\/chat\/101$/);
  const origin = page.getByRole('button', { name: 'Volver al documento', exact: true });
  await expect(origin).toBeVisible();
  await origin.click();
  await expect(page).toHaveURL(/\/admin\/documentos\/ficha\/51$/);
});

test('crear conversación desde el flotante usa todo el viewport y conserva foco dentro del diálogo', async ({ page }, testInfo) => {
  await fixture(page);
  await openThread(page);
  await page.getByRole('button', { name: 'Usar chat flotante', exact: true }).click();
  const dock = page.getByRole('region', { name: 'Chat rápido' });
  await dock.getByRole('button', { name: 'Volver a conversaciones', exact: true }).click();
  const trigger = dock.getByRole('button', { name: 'Nueva conversación', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Nueva conversación' });
  await expect(dialog).toBeVisible();
  await expect(dock.getByRole('dialog')).toHaveCount(0);
  const bounds = await page.locator('.chat-dialog-backdrop').boundingBox();
  expect(bounds.x).toBe(0);
  expect(bounds.y).toBe(0);
  expect(bounds.width).toBe(page.viewportSize().width);
  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.screenshot({ path: testInfo.outputPath('dialogo-desde-flotante.png'), scale: 'css' });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(dock).toBeVisible();
  await expect(trigger).toBeFocused();
});

test('guardar preferencias no continúa con retención después de cambiar de sesión', async ({ page }) => {
  const state = await fixture(page, { permissions: [...account.permissions, 'chat.channels.manage'], role: 'PROPIETARIO' });
  let release;
  state.preferenceGate = new Promise((resolve) => { release = resolve; });
  try {
    await openThread(page);
    await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
    await page.locator('.chat-settings-panel').getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect.poll(() => state.preferenceAttempts).toBe(1);
    await page.getByRole('button', { name: 'Abrir menú de usuario', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Cerrar sesión', exact: true }).click();
    await page.getByLabel('Correo electrónico', { exact: true }).fill(account.correo);
    await page.getByLabel('Contraseña', { exact: true }).fill('clave-ficticia-de-prueba');
    await page.getByRole('button', { name: 'Ingresar al sistema', exact: true }).click();
    await expect(page).not.toHaveURL(/\/login$/);
    release();
    await expect.poll(() => state.preferencesResolved).toBe(true);
    await page.waitForTimeout(250);
    expect(state.retentionWrites).toBe(0);
    await expect(page.getByText('Preferencias de conversación guardadas.', { exact: true })).toHaveCount(0);
  } finally { release(); }
});
