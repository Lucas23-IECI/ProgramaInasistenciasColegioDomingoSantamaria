import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// This suite intercepts EVERY API request. It checks the real application UI and
// in-memory navigation, not database persistence, production permissions or TLS.
const DATE = '2026-09-25T15:20:00.000Z';
const ORIGIN = '/directorio?search=prueba#equipo';
const PERMISSIONS = ['profiles.directory.view', 'chat.access', 'chat.direct.create', 'chat.group.create', 'chat.attach', 'chat.urgent'];
const PERSON = { usuario_id: 2, id: 2, nombre: 'Camila de prueba', correo: 'camila@example.test', cargo: 'Coordinación', rol: 'MIEMBRO' };
const makeMessage = (id, content, own = false, extra = {}) => ({
  id_mensaje: id, id_conversacion: 101, enviado_por: own ? 1 : 2,
  autor_nombre: own ? 'Cuenta de prueba' : PERSON.nombre, contenido: content,
  enviado_en: DATE, tipo: 'NORMAL', adjuntos: [], lecturas: 1, lecturas_otros: 0,
  ...extra,
});

async function mockDock(page, { signedIn = true, permissions = PERMISSIONS, passwordChange = false, theme = 'light' } = {}) {
  const state = {
    signedIn, permissions, passwordChange, failSend: false, failLoad: false,
    loadStatus: 503, failList: false, listStatus: 503, sent: [], reads: [], sendGate: null, sendAttempts: 0,
    conversations: [
      { id_conversacion: 101, tipo: 'DIRECTA', titulo: PERSON.nombre, ultimo_mensaje: 'Coordinemos la reunión de mañana.', ultimo_mensaje_en: DATE, no_leidos: 2 },
      { id_conversacion: 102, tipo: 'GRUPO', titulo: 'Equipo de prueba', ultimo_mensaje: 'Resumen del equipo.', ultimo_mensaje_en: DATE, no_leidos: 0 },
    ],
    messages: {
      101: [makeMessage(1, 'Coordinemos la reunión de mañana.'), makeMessage(2, 'De acuerdo, revisaré el horario.', true)],
      102: [makeMessage(3, 'Resumen del equipo.', false, { id_conversacion: 102 })],
    },
  };
  const user = () => ({ id: 1, nombre: 'Cuenta de prueba', correo: 'qa@example.test', rol: 'inspector', cargo: 'Inspectoría', permissions: state.permissions, debe_cambiar_password: state.passwordChange });
  await page.addInitScript(({ selectedTheme }) => {
    localStorage.setItem('ldsm-theme', selectedTheme);
    const originalGet = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key) {
      return String(key).startsWith('ldsm-release:') ? 'seen' : originalGet.call(this, key);
    };
  }, { selectedTheme: theme });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/auth/me') return state.signedIn ? json({ user: user() }) : json({ message: 'Inicia sesión.' }, 401);
    if (path === '/api/auth/logout') { state.signedIn = false; return json({ ok: true }); }
    if (path === '/api/auth/login') { state.signedIn = true; return json({ user: user() }); }
    if (path === '/api/chat/eventos' || path === '/api/notificaciones/eventos') return route.fulfill({ status: 204 });
    if (path === '/api/chat/resumen') return json({ no_leidos: 2, urgentes: 0 });
    if (path === '/api/chat/directorio') return json([PERSON]);
    if (path === '/api/chat/buscar') return json([]);
    if (path === '/api/chat/conversaciones') {
      if (state.failList) return json({ message: 'No tienes acceso a estas conversaciones.' }, state.listStatus);
      const term = (url.searchParams.get('q') || '').toLocaleLowerCase('es');
      return json(state.conversations.filter((row) => row.titulo.toLocaleLowerCase('es').includes(term)));
    }
    const thread = path.match(/^\/api\/chat\/conversaciones\/(\d+)$/);
    if (thread) {
      if (state.failLoad) return json({ message: 'La conversación no está disponible.' }, state.loadStatus);
      return json({ ...state.conversations.find((row) => row.id_conversacion === Number(thread[1])), miembro_rol: 'PROPIETARIO', members: [{ usuario_id: 1, nombre: 'Cuenta de prueba', rol: 'PROPIETARIO' }, PERSON], pinned: [] });
    }
    const messages = path.match(/^\/api\/chat\/conversaciones\/(\d+)\/mensajes$/);
    if (messages) {
      const id = Number(messages[1]);
      if (request.method() === 'POST') {
        state.sendAttempts += 1;
        if (state.sendGate) await state.sendGate;
        if (state.failSend) return json({ message: 'No se pudo enviar el mensaje. Inténtalo nuevamente.' }, 503);
        const payload = request.postDataJSON();
        state.sent.push({ conversationId: id, ...payload });
        const created = makeMessage(100 + state.sent.length, payload.contenido, true, { tipo: payload.tipo, id_conversacion: id });
        state.messages[id].push(created);
        return json(created, 201);
      }
      if (state.failLoad) return json({ message: 'La conversación no está disponible.' }, state.loadStatus);
      return json(state.messages[id] || []);
    }
    if (/\/leer$/.test(path)) { state.reads.push(request.postDataJSON()); return json({ ok: true }); }
    if (path === '/api/directory/staff') return json({ rows: [], total: 0, filters: { areas: [], cargos: [], statuses: [], account_types: [] } });
    if (path === '/api/notificaciones') return json({ items: [], unread: 0, pagination: { page: 1, pages: 1 } });
    // Every auxiliary API remains isolated from the backend, including newly
    // added release, profile, offline and notification requests.
    return json({});
  });
  return state;
}

const dock = (page) => page.getByRole('region', { name: 'Chat rápido', exact: true });
const editor = (page) => page.locator('.chat-composer textarea');
const launcher = (page) => page.getByRole('button', { name: /^Abrir mensajes/ });
const conversation = (page, name = PERSON.nombre) => page.locator('.chat-conversations > button').filter({ hasText: name });

async function openDock(page, { origin = ORIGIN, thread = true } = {}) {
  await page.goto(origin);
  await launcher(page).click();
  await expect(dock(page)).toBeVisible();
  await expect(conversation(page)).toBeVisible();
  if (thread) {
    await conversation(page).click();
    await expect(editor(page)).toBeVisible();
  }
  await expect(page).toHaveURL(new RegExp(`${origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
}

async function refreshSession(page) {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

async function emitMessage(page) {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ldsm:chat-message', { detail: { conversation_id: 101 } })));
}

test('los accesos global e inferior abren el chat sin abandonar el módulo ni bloquearlo', async ({ page }) => {
  await mockDock(page);
  await page.goto(ORIGIN);
  const globalChat = page.getByRole('button', { name: /^Abrir chat interno/ });
  await globalChat.click();
  await expect(dock(page)).toBeVisible();
  for (const name of ['Abrir chat completo', 'Minimizar chat', 'Cerrar chat']) await expect(dock(page).getByRole('button', { name, exact: true })).toBeVisible();
  await expect(dock(page)).not.toHaveAttribute('aria-modal', 'true');
  await expect(page.getByRole('heading', { name: 'Directorio interno', exact: true })).toBeVisible();
  await conversation(page).click();
  await expect(editor(page)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/directorio');
  await dock(page).getByRole('button', { name: 'Minimizar chat', exact: true }).click();
  await expect(dock(page)).toHaveCount(0);
  await launcher(page).click();
  await expect(editor(page)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/directorio');
});

test('borrador, mención y urgencia sobreviven minimizar, cerrar y cambiar entre chat flotante y completo', async ({ page }) => {
  const state = await mockDock(page);
  await openDock(page);
  await editor(page).fill('Acuerdo privado de prueba ');
  await dock(page).getByRole('button', { name: 'Mencionar a una persona', exact: true }).click();
  await dock(page).getByRole('button', { name: `@${PERSON.nombre}`, exact: true }).click();
  await dock(page).getByRole('button', { name: 'Marcar como urgente', exact: true }).click();
  const draft = await editor(page).inputValue();
  await dock(page).getByRole('button', { name: 'Minimizar chat', exact: true }).click();
  await launcher(page).click();
  await expect(editor(page)).toHaveValue(draft);
  await dock(page).getByRole('button', { name: 'Cerrar chat', exact: true }).click();
  await launcher(page).click();
  await expect(editor(page)).toHaveValue(draft);
  await dock(page).getByRole('button', { name: 'Abrir chat completo', exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/101$/);
  await expect(dock(page)).toHaveCount(0);
  await expect(editor(page)).toHaveValue(draft);
  await expect(page.getByRole('button', { name: 'Quitar urgencia', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Usar chat flotante', exact: true }).click();
  await expect(dock(page)).toBeVisible();
  expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe(ORIGIN);
  await expect(editor(page)).toHaveValue(draft);
  const storedValues = await page.evaluate(() => [localStorage, sessionStorage].flatMap((storage) => Object.keys(storage).map((key) => storage.getItem(key))));
  expect(storedValues.join('\n')).not.toContain('Acuerdo privado de prueba');
  await dock(page).getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect.poll(() => state.sent).toHaveLength(1);
  expect(state.sent[0]).toMatchObject({ conversationId: 101, contenido: draft.trim(), tipo: 'URGENTE', menciones: [2] });
  await expect(editor(page)).toBeEmpty();
});

test('cada conversación conserva su propio borrador al volver a la lista', async ({ page }) => {
  await mockDock(page);
  await openDock(page);
  await editor(page).fill('Borrador para Camila');
  await dock(page).getByRole('button', { name: 'Volver a conversaciones', exact: true }).click();
  await conversation(page, 'Equipo de prueba').click();
  await expect(editor(page)).toBeEmpty();
  await editor(page).fill('Borrador para el equipo');
  await dock(page).getByRole('button', { name: 'Volver a conversaciones', exact: true }).click();
  await conversation(page).click();
  await expect(editor(page)).toHaveValue('Borrador para Camila');
});

test('un envío fallido mantiene el texto y reintentar envía una sola vez', async ({ page }) => {
  const state = await mockDock(page);
  await openDock(page);
  state.failSend = true;
  await editor(page).fill('Mensaje de prueba recuperable');
  await editor(page).press('Enter');
  await expect(page.getByRole('alert').filter({ hasText: 'No se pudo enviar' })).toBeVisible();
  await expect(editor(page)).toHaveValue('Mensaje de prueba recuperable');
  expect(state.sent).toHaveLength(0);
  state.failSend = false;
  await editor(page).press('Enter');
  await expect.poll(() => state.sent).toHaveLength(1);
  await expect(editor(page)).toBeEmpty();
  await expect(editor(page)).toBeFocused();
  expect(new URL(page.url()).pathname).toBe('/directorio');
});

test('minimizar durante un envío no habilita un segundo envío ni pierde el estado pendiente', async ({ page }) => {
  const state = await mockDock(page);
  await openDock(page);
  let release;
  state.sendGate = new Promise((resolve) => { release = resolve; });
  try {
    await editor(page).fill('Mensaje que demora en confirmarse');
    await dock(page).getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect.poll(() => state.sendAttempts).toBe(1);
    await expect(editor(page)).toBeDisabled();
    await dock(page).getByRole('button', { name: 'Minimizar chat', exact: true }).click();
    await launcher(page).click();
    await expect(editor(page)).toBeDisabled();
    await expect(dock(page).getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
    await expect(editor(page)).toHaveValue('Mensaje que demora en confirmarse');
    release();
    await expect(editor(page)).toBeEnabled();
    await expect(editor(page)).toBeEmpty();
    await expect.poll(() => state.sent).toHaveLength(1);
    expect(state.sendAttempts).toBe(1);
    await expect(dock(page).locator('.chat-bubble').filter({ hasText: 'Mensaje que demora en confirmarse' })).toBeVisible();
  } finally { release(); }
});

test('una conversación vacía no se marca como leída con un identificador nulo', async ({ page }) => {
  const state = await mockDock(page);
  state.messages[101] = [];
  await openDock(page);
  await expect(dock(page).getByText('Aún no hay mensajes', { exact: true })).toBeVisible();
  await dock(page).getByRole('button', { name: 'Minimizar chat', exact: true }).click();
  expect(state.reads).toEqual([]);
});

test('se puede abrir con teclado y Escape minimiza devolviendo el foco al acceso inferior', async ({ page }) => {
  await mockDock(page);
  await page.goto(ORIGIN);
  await launcher(page).focus();
  await page.keyboard.press('Enter');
  await expect(dock(page)).toBeVisible();
  await expect(dock(page)).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dock(page).getByRole('button', { name: 'Abrir chat completo', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dock(page)).toHaveCount(0);
  await expect(launcher(page)).toBeFocused();
});

test('el chat flotante y su editor no desbordan de 320 a 1920 px y en ambos temas', async ({ page }, testInfo) => {
  await mockDock(page);
  await openDock(page);
  await editor(page).fill('Primera línea\nSegunda línea\nTercera línea');
  for (const width of [320, 390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 820 });
    await expect(dock(page)).toBeInViewport();
    await expect(editor(page)).toBeInViewport();
    await expect(dock(page).getByRole('button', { name: 'Enviar', exact: true })).toBeInViewport();
    const box = await dock(page).boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(821);
    const overflow = await dock(page).evaluate((node) => node.scrollWidth - node.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    if (width === 390 || width === 1280) await page.screenshot({ path: testInfo.outputPath(`chat-dock-${width}.png`), scale: 'css' });
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.body.classList.toggle('light-mode', value === 'light'), theme);
    const result = await new AxeBuilder({ page }).include('.chat-dock').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(result.violations).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`chat-dock-${theme}.png`), scale: 'css' });
  }
});

for (const scenario of [
  { name: 'sin sesión', options: { signedIn: false }, path: '/login', target: /\/login$/ },
  { name: 'con cambio obligatorio de contraseña', options: { passwordChange: true }, path: '/admin', target: /\/cambiar-clave$/ },
  { name: 'sin permiso de chat', options: { permissions: ['profiles.directory.view'] }, path: '/directorio', target: /\/directorio$/ },
]) {
  test(`no muestra mensajería ${scenario.name}`, async ({ page }) => {
    await mockDock(page, scenario.options);
    await page.goto(scenario.path);
    await expect(page).toHaveURL(scenario.target);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(dock(page)).toHaveCount(0);
    await expect(launcher(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Abrir chat interno/ })).toHaveCount(0);
  });
}

test('una interrupción temporal conserva mensajes y permite recuperar la conversación', async ({ page }) => {
  const state = await mockDock(page);
  await openDock(page);
  await editor(page).fill('Borrador durante interrupción');
  state.failLoad = true;
  await emitMessage(page);
  await expect(dock(page).getByRole('alert')).toContainText('No se pudo actualizar');
  await expect(dock(page).locator('.chat-bubble').filter({ hasText: 'Coordinemos' })).toBeVisible();
  await expect(editor(page)).toHaveValue('Borrador durante interrupción');
  state.failLoad = false;
  await dock(page).getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(dock(page).getByRole('alert')).toHaveCount(0);
});

test('revocar acceso a una conversación retira los mensajes y bloquea el envío', async ({ page }) => {
  const state = await mockDock(page);
  await openDock(page);
  await editor(page).fill('Texto de un acceso revocado');
  state.failLoad = true;
  state.loadStatus = 403;
  await emitMessage(page);
  await expect(dock(page).getByRole('heading', { name: 'No pudimos abrir la conversación' })).toBeVisible();
  await expect(dock(page).locator('.chat-bubble')).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
  await expect(dock(page).getByRole('button', { name: 'Enviar', exact: true })).toHaveCount(0);
});

test('al perder permiso global se oculta el chat y se descartan los borradores', async ({ page }) => {
  const state = await mockDock(page);
  await openDock(page);
  await editor(page).fill('Borrador que debe descartarse');
  state.permissions = ['profiles.directory.view'];
  await refreshSession(page);
  await expect(dock(page)).toHaveCount(0);
  await expect(launcher(page)).toHaveCount(0);
  state.permissions = PERMISSIONS;
  await refreshSession(page);
  await launcher(page).click();
  await conversation(page).click();
  await expect(editor(page)).toBeEmpty();
});

test('cerrar sesión destruye el borrador incluso al volver a entrar con la misma cuenta', async ({ page }) => {
  await mockDock(page);
  await openDock(page, { origin: '/admin' });
  await editor(page).fill('No debe reaparecer después del cierre de sesión');
  await dock(page).getByRole('button', { name: 'Minimizar chat', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(launcher(page)).toHaveCount(0);
  await page.getByLabel('Correo electrónico', { exact: true }).fill('qa@example.test');
  await page.getByLabel('Contraseña', { exact: true }).fill('SyntheticTestPassword123!');
  await page.getByRole('button', { name: 'Ingresar al sistema', exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await launcher(page).click();
  await conversation(page).click();
  await expect(editor(page)).toBeEmpty();
});

test('una respuesta de envío de la sesión anterior no borra el nuevo borrador de la misma cuenta', async ({ page }) => {
  const state = await mockDock(page);
  await openDock(page, { origin: '/admin' });
  let release;
  state.sendGate = new Promise((resolve) => { release = resolve; });
  try {
    await editor(page).fill('Envío de la sesión anterior');
    await dock(page).getByRole('button', { name: 'Enviar', exact: true }).click();
    await expect.poll(() => state.sendAttempts).toBe(1);
    await dock(page).getByRole('button', { name: 'Minimizar chat', exact: true }).click();
    await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.getByLabel('Correo electrónico', { exact: true }).fill('qa@example.test');
    await page.getByLabel('Contraseña', { exact: true }).fill('SyntheticTestPassword123!');
    await page.getByRole('button', { name: 'Ingresar al sistema', exact: true }).click();
    await expect(page).toHaveURL(/\/admin$/);
    await launcher(page).click();
    await conversation(page).click();
    await expect(editor(page)).toBeEnabled();
    await expect(editor(page)).toBeEmpty();
    await editor(page).fill('Borrador nuevo que debe conservarse');
    const oldResponse = page.waitForResponse((response) => response.url().endsWith('/chat/conversaciones/101/mensajes') && response.request().method() === 'POST');
    release();
    await (await oldResponse).finished();
    // A round-trip unmounts the old thread and rereads the shared draft store.
    await dock(page).getByRole('button', { name: 'Minimizar chat', exact: true }).click();
    await launcher(page).click();
    await expect(editor(page)).toHaveValue('Borrador nuevo que debe conservarse');
    expect(state.sendAttempts).toBe(1);
  } finally { release(); }
});

test('el chat completo mantiene un regreso visible al panel principal', async ({ page }) => {
  await mockDock(page);
  await page.goto('/chat/101');
  await expect(editor(page)).toBeVisible();
  const back = page.getByRole('button', { name: 'Panel principal', exact: true }).or(page.getByRole('link', { name: 'Panel principal', exact: true }));
  await expect(back).toBeVisible();
  await expect(back).toBeInViewport();
  await back.click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(launcher(page)).toBeVisible();
});
