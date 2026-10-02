import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Buffer } from 'node:buffer';

// Deterministic browser regression: every /api request is intercepted. These
// fixtures prove UI behavior, not persistence, server authorization or TLS.
// No school/test database is read or written by this spec.
const DATE = '2026-09-24T15:20:00.000Z';
const LONG_WORD = 'antecedente'.repeat(70);
const FILE_NAME = `Autorizacion-${'institucional-'.repeat(12)}anual.pdf`;
const defaultPermissions = ['chat.access', 'chat.direct.create', 'chat.group.create', 'chat.attach', 'chat.urgent', 'documents.view'];
const people = [
  { id: 2, usuario_id: 2, nombre: 'Camila de prueba', correo: 'camila@example.test', cargo: 'Coordinación' },
  { id: 3, usuario_id: 3, nombre: 'Diego de prueba', correo: 'diego@example.test', cargo: 'Inspectoría' },
];
const message = (id, contenido, own = false, extra = {}) => ({
  id_mensaje: id, id_conversacion: 101, enviado_por: own ? 1 : 2,
  autor_nombre: own ? 'Cuenta de prueba' : 'Camila de prueba',
  contenido, tipo: 'NORMAL', enviado_en: DATE, lecturas: 2, lecturas_otros: 1,
  eliminado_en: null, adjuntos: [], fijado: false, ...extra,
});

async function mockChat(page, { memberRole = 'PROPIETARIO', permissions = defaultPermissions, theme = 'light' } = {}) {
  const state = {
    failSend: false, failLoad: false, failDownload: false, sendGate: null, failStatus: 503, failList: false, listStatus: 503,
    sent: [], uploads: [], pins: [], reads: [],
    messages: [
      message(1, 'Hola'),
      message(2, 'Gracias', true),
      message(3, `Necesitamos revisar este antecedente largo sin romper el ancho: ${LONG_WORD}`),
      message(4, `Archivo adjunto: ${FILE_NAME}`, true, { adjuntos: [{ id_adjunto: 9, nombre: FILE_NAME }] }),
      message(5, 'Revisión prioritaria de prueba', false, { tipo: 'URGENTE' }),
      message(6, 'Este texto ya no debe mostrarse', false, { eliminado_en: DATE }),
    ],
  };
  const conversations = [
    { id_conversacion: 101, tipo: 'DIRECTA', titulo: 'Camila de prueba', ultimo_mensaje: 'Revisión de antecedentes', ultimo_mensaje_en: DATE, no_leidos: 2 },
    { id_conversacion: 102, tipo: 'CONTEXTO', nombre: 'Documento de prueba', titulo: 'Documento de prueba', contexto_tipo: 'DOCUMENTO', contexto_id: 51, ultimo_mensaje: 'Documento vinculado', ultimo_mensaje_en: DATE },
  ];
  state.conversations = conversations;
  await page.addInitScript(({ selectedTheme }) => {
    localStorage.setItem('ldsm-theme', selectedTheme);
    // Prevent release overlays independently of the current release identifier.
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
    if (path === '/api/auth/me') return json({ user: { id: 1, nombre: 'Cuenta de prueba', correo: 'qa@example.test', rol: 'inspector', cargo: 'Inspectoría', permissions } });
    if (path === '/api/chat/eventos' || path === '/api/notificaciones/eventos') return route.fulfill({ status: 204 });
    if (path === '/api/chat/resumen') return json({ no_leidos: 2, urgentes: 0 });
    if (path === '/api/chat/directorio') return json(people);
    if (path === '/api/chat/buscar') return json([]);
    if (path === '/api/chat/conversaciones') {
      if (state.failList) return json({ message: 'La lista no está disponible temporalmente.' }, state.listStatus);
      const search = (url.searchParams.get('q') || '').toLocaleLowerCase('es');
      return json(conversations.filter((item) => item.titulo.toLocaleLowerCase('es').includes(search)));
    }
    if (/^\/api\/chat\/conversaciones\/\d+$/.test(path)) {
      if (state.failLoad) return json({ message: 'La conversación no está disponible temporalmente. Reintenta.' }, state.failStatus);
      const id = Number(path.split('/').at(-1));
      return json({ ...conversations.find((item) => item.id_conversacion === id), miembro_rol: memberRole, members: [{ usuario_id: 1, nombre: 'Cuenta de prueba', rol: memberRole }, ...people.map((person) => ({ ...person, rol: 'MIEMBRO' }))], pinned: state.pinned || [] });
    }
    if (/\/mensajes$/.test(path)) {
      if (request.method() === 'POST') {
        if (state.sendGate) await state.sendGate;
        if (state.failSend) return json({ message: 'No se pudo enviar el mensaje. Inténtalo nuevamente.' }, 503);
        const payload = request.postDataJSON();
        state.sent.push(payload);
        const created = message(100 + state.sent.length, payload.contenido, true, { tipo: payload.tipo });
        state.messages.push(created);
        return json(created, 201);
      }
      if (state.failLoad) return json({ message: 'La conversación no está disponible temporalmente. Reintenta.' }, state.failStatus);
      return json(path.includes('/102/') ? [message(201, 'Documento vinculado')] : state.messages);
    }
    if (/\/leer$/.test(path)) { state.reads.push(request.postDataJSON()); return json({ ok: true }); }
    if (/\/fijar$/.test(path)) { state.pins.push({ method: request.method(), path }); return json({ ok: true }); }
    if (/\/adjuntos$/.test(path)) {
      const payload = request.postDataJSON();
      state.uploads.push(payload);
      state.messages.push(message(300 + state.uploads.length, `Archivo adjunto: ${payload.file_name}`, true, { adjuntos: [{ id_adjunto: 10, nombre: payload.file_name }] }));
      return json({ id_adjunto: 10 }, 201);
    }
    if (/\/adjuntos\/\d+$/.test(path)) {
      if (state.failDownload) return json({ message: 'El archivo no está disponible.' }, 404);
      return route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.4\n% synthetic download fixture\n%%EOF' });
    }
    if (path === '/api/notificaciones') return json({ items: [], unread: 0, pagination: { page: 1, pages: 1 } });
    return json({});
  });
  return state;
}

const bubble = (page, text) => page.locator('.chat-bubble').filter({ hasText: text });
const editor = (page) => page.locator('.chat-composer textarea');

test('la lista avisa si una actualización falla y conserva las conversaciones', async ({ page }) => {
  const state = await mockChat(page);
  await page.goto('/chat');
  const rows = page.locator('.chat-conversations > button');
  await expect(rows).toHaveCount(2);
  state.failList = true;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ldsm:chat-message', { detail: { conversation_id: 101 } })));
  await expect(page.locator('.chat-sidebar').getByRole('alert')).toContainText('No se pudo actualizar la lista.');
  await expect(rows).toHaveCount(2);
  state.failList = false;
  await page.locator('.chat-sidebar').getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.locator('.chat-sidebar').getByRole('alert')).toHaveCount(0);
  await expect(rows).toHaveCount(2);
});

test('si el servidor retira el acceso se oculta la conversación anterior', async ({ page }) => {
  const state = await mockChat(page);
  await openThread(page);
  state.failLoad = true;
  state.failStatus = 403;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ldsm:chat-message', { detail: { conversation_id: 101 } })));
  await expect(page.getByRole('heading', { name: 'No pudimos abrir la conversación' })).toBeVisible();
  await expect(page.locator('.chat-bubble')).toHaveCount(0);
  await expect(editor(page)).toHaveCount(0);
  await page.locator('.chat-thread').getByRole('button', { name: 'Volver a conversaciones' }).click();
  await expect(page).toHaveURL(/\/chat$/);
});

test('revocar acceso a la lista retira vistas previas y cierra el directorio abierto', async ({ page }) => {
  const state = await mockChat(page);
  await page.goto('/chat');
  await expect(page.locator('.chat-conversations > button')).toHaveCount(2);
  await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Nueva conversación', exact: true })).toBeVisible();
  state.failList = true;
  state.listStatus = 403;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ldsm:chat-message', { detail: { conversation_id: 101 } })));
  await expect(page.locator('.chat-conversations > button')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Nueva conversación', exact: true })).toHaveCount(0);
  await expect(page.getByText('Camila de prueba', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No pudimos cargar el chat', { exact: true })).toBeVisible();
});

test('la marca de lectura excluye al remitente y tolera un servidor anterior', async ({ page }) => {
  const state = await mockChat(page);
  state.messages = [
    message(1, 'Sólo yo lo he leído', true, { lecturas: 1, lecturas_otros: 0 }),
    message(2, 'Lo leyó otra persona', true, { lecturas: 2, lecturas_otros: 1 }),
    message(3, 'Respuesta de versión anterior', true, { lecturas: 1, lecturas_otros: undefined }),
  ];
  await openThread(page);
  await expect(bubble(page, 'Sólo yo lo he leído').getByRole('img', { name: 'Enviado, sin lecturas confirmadas' })).toBeVisible();
  await expect(bubble(page, 'Lo leyó otra persona').getByRole('img', { name: 'Leído por 1' })).toBeVisible();
  await expect(bubble(page, 'Respuesta de versión anterior').getByRole('img', { name: 'Enviado, sin lecturas confirmadas' })).toBeVisible();
});

test('conversación representativa y compositor se adaptan de 320 a 1920 px', async ({ page }, testInfo) => {
  const state = await mockChat(page);
  state.messages = [
    message(1, 'Hola, ¿podemos revisar los documentos de la reunión?'),
    message(2, 'Sí, los tengo listos.', true),
    message(3, 'Te comparto el resumen antes del recreo.', true),
    message(4, 'Perfecto, gracias. Nos vemos en la oficina.'),
    message(5, 'Dejemos también los acuerdos en el seguimiento.', false),
    message(6, 'De acuerdo 👍', true),
  ];
  await openThread(page);
  for (const width of [320, 375, 414, 768, 1440, 1920]) {
    await page.setViewportSize({ width, height: 820 });
    await expectNoOverflow(page);
    await expect(editor(page)).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeInViewport();
    for (const item of await page.locator('.chat-bubble').all()) {
      expect((await item.boundingBox()).width).toBeLessThanOrEqual(540);
    }
    if (width === 375 || width === 1440) {
      await page.screenshot({ path: testInfo.outputPath(`chat-conversacion-${width}.png`), scale: 'css' });
    }
  }
  await editor(page).fill('Una línea\nSegunda línea\nTercera línea\nCuarta línea');
  expect((await editor(page).boundingBox()).height).toBeGreaterThan(70);
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeInViewport();
});

test('la vista diaria distribuye nombres, mensajes y editor sin comprimirlos', async ({ page }, testInfo) => {
  const state = await mockChat(page);
  state.conversations.splice(0, state.conversations.length,
    { id_conversacion: 101, tipo: 'GRUPO', titulo: 'Coordinación de jornada · Prueba', ultimo_emisor: 'Cuenta de prueba', ultimo_mensaje: 'Perfecto, lo revisamos en la reunión.', ultimo_mensaje_en: DATE },
    ...['Camila de prueba', 'Equipo de Inspectoría · Prueba', 'Reunión de coordinación · Prueba', 'Diego de prueba', 'Revisión documental · Prueba'].map((titulo, index) => ({ id_conversacion: 102 + index, tipo: index % 2 ? 'GRUPO' : 'DIRECTA', titulo, ultimo_emisor: 'Cuenta de prueba', ultimo_mensaje: 'Ya dejé los antecedentes disponibles.', ultimo_mensaje_en: DATE, no_leidos: index === 1 ? 3 : 0 })),
  );
  state.messages = [
    message(1, 'Buenos días, equipo. ¿Podemos revisar los acuerdos antes de la reunión?'),
    message(2, 'Sí, ya tengo el resumen preparado.', true),
    message(3, 'Lo comparto aquí para que todos tengamos la misma información.', true),
    message(4, 'Gracias. Nos reunimos a las 10:00 en la oficina. Si falta algo, lo anotamos aquí.'),
    message(5, 'Resumen de prueba', false, { adjuntos: [{ id_adjunto: 9, nombre: 'Acuerdos-reunion-prueba.pdf' }] }),
    message(6, 'Perfecto, lo revisamos en la reunión.', true),
  ];
  state.pinned = [{ contenido: 'Reunión de coordinación: hoy a las 10:00.' }];
  await page.goto('/chat/101');
  await expect(editor(page)).toBeVisible();
  await expect(page.locator('.chat-thread h2')).toHaveText('Coordinación de jornada · Prueba');
  for (const width of [1440, 1536, 1101, 900, 768, 375, 320]) {
    // 1536 x 864 is the CSS viewport of a 1920 x 1080 display at 125% zoom.
    await page.setViewportSize({ width, height: width === 1536 ? 864 : 900 });
    await expectNoOverflow(page);
    await expect(editor(page)).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeInViewport();
    await expect.poll(() => page.locator('.chat-messages').evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(24);
    await expect.poll(() => editor(page).evaluate((el) => ({ overflow: getComputedStyle(el).overflowY, clipped: el.scrollHeight > el.clientHeight + 1 }))).toEqual({ overflow: 'hidden', clipped: false });
    expect(await bubble(page, 'Perfecto, lo revisamos').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(15);
    if (width > 900) {
      expect((await page.locator('.chat-sidebar').boundingBox()).width).toBeGreaterThanOrEqual(320);
      expect(await page.locator('.chat-messages').evaluate((el) => parseFloat(getComputedStyle(el).paddingRight))).toBeLessThanOrEqual(36);
      await expect(page.locator('.chat-preview-author').first()).toContainText('Cuenta de prueba:');
      const preview = page.locator('.chat-conversation-preview').first();
      expect((await preview.locator('.chat-preview-text').boundingBox()).width).toBeGreaterThan((await preview.locator('.chat-preview-author').boundingBox()).width);
    } else {
      await expect(page.locator('.chat-sidebar')).toBeHidden();
    }
    if ([1440, 1536, 375].includes(width)) await page.screenshot({ path: testInfo.outputPath(`chat-diario-${width}.png`), scale: 'css' });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.evaluate(() => document.body.classList.remove('light-mode'));
  await page.screenshot({ path: testInfo.outputPath('chat-diario-oscuro.png'), scale: 'css' });
});

test('el editor crece al escribir y al estrechar la ventana, con scroll solo al llenarse', async ({ page }) => {
  await mockChat(page);
  await openThread(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await editor(page).fill('Vamos a revisar juntos los acuerdos de la reunión y preparar el material que necesita el equipo.');
  const wideHeight = (await editor(page).boundingBox()).height;
  await page.setViewportSize({ width: 375, height: 900 });
  await expect.poll(async () => (await editor(page).boundingBox()).height).toBeGreaterThan(wideHeight);
  await expect.poll(() => editor(page).evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await editor(page).fill(Array.from({ length: 20 }, (_, i) => `Línea ${i + 1}`).join('\n'));
  await expect.poll(() => editor(page).evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
  expect((await editor(page).boundingBox()).height).toBeLessThanOrEqual(144);
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeInViewport();
  await editor(page).fill('Listo');
  await expect.poll(() => editor(page).evaluate((el) => ({ overflow: getComputedStyle(el).overflowY, clipped: el.scrollHeight > el.clientHeight + 1 }))).toEqual({ overflow: 'hidden', clipped: false });
});

test('escribir varias líneas no pierde la lectura anterior y las menciones quedan sobre el editor', async ({ page }) => {
  const state = await mockChat(page);
  state.messages = Array.from({ length: 30 }, (_, index) => message(index + 1, `Acuerdo de prueba ${index + 1}. Información para revisar en equipo.`, index % 2 === 0));
  await openThread(page);
  const messages = page.locator('.chat-messages');
  await expect.poll(() => messages.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThan(24);
  await messages.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await editor(page).fill(Array.from({ length: 20 }, (_, index) => `Acuerdo ${index + 1}`).join('\n'));
  await expect.poll(() => messages.evaluate((el) => el.scrollTop)).toBeLessThan(2);
  await page.getByRole('button', { name: 'Mencionar a una persona' }).click();
  const menu = page.locator('.chat-mention-menu');
  await expect(menu).toBeVisible();
  expect((await menu.boundingBox()).y + (await menu.boundingBox()).height).toBeLessThanOrEqual((await page.locator('.chat-composer').boundingBox()).y);
  await page.setViewportSize({ width: 375, height: 900 });
  await expect.poll(() => messages.evaluate((el) => el.scrollTop)).toBeLessThan(2);
  expect((await menu.boundingBox()).y + (await menu.boundingBox()).height).toBeLessThanOrEqual((await page.locator('.chat-composer').boundingBox()).y);
});

test('nueva conversación mantiene fondo de viewport completo y contraste en ambos temas', async ({ page }) => {
  await mockChat(page);
  await page.goto('/chat');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => document.body.classList.toggle('light-mode', value === 'light'), theme);
    await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Nueva conversación', exact: true });
    await expect(dialog).toBeVisible();
    const bounds = await page.locator('.chat-dialog-backdrop').boundingBox();
    expect(bounds.x).toBe(0);
    expect(bounds.y).toBe(0);
    expect(bounds.width).toBe(page.viewportSize().width);
    const result = await new AxeBuilder({ page }).include('.chat-dialog').withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(result.violations).toEqual([]);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  }
});

test('la ayuda del chat explica las acciones actuales en escritorio y móvil', async ({ page }, testInfo) => {
  await mockChat(page);
  await openThread(page);
  await page.getByRole('button', { name: 'Recorrido del chat interno', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Identificación del módulo' })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Conversaciones institucionales' })).toBeVisible();
  await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
  const help = page.getByRole('dialog', { name: 'Coordinación con trazabilidad' });
  await expect(help).toContainText('Mayús + Enter');
  await expect(help).toContainText('hasta 8 MB');
  await expect(help).toContainText('Solo propietarios y moderadores');
  await expect(help).toContainText('lecturas registradas');
  const box = await help.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize().width);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize().height);
  await page.screenshot({ path: testInfo.outputPath('chat-ayuda.png'), scale: 'css' });
});

async function openThread(page) {
  await page.goto('/chat/101');
  await expect(page.locator('.chat-thread h2')).toHaveText('Camila de prueba');
  await expect(editor(page)).toBeVisible();
}

async function expectNoOverflow(page) {
  const geometry = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, width: document.documentElement.scrollWidth }));
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport + 1);
  for (const element of await page.locator('.chat-bubble').all()) {
    const dimensions = await element.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return { left: rect.left, right: rect.right, viewport: window.innerWidth, internalOverflow: node.scrollWidth - node.clientWidth };
    });
    expect(dimensions.left).toBeGreaterThanOrEqual(0);
    expect(dimensions.right).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect(dimensions.internalOverflow).toBeLessThanOrEqual(1);
  }
}

test('burbujas cortas ajustadas al texto, mensajes largos y adjuntos sin desbordamiento', async ({ page }, testInfo) => {
  await mockChat(page);
  await openThread(page);
  await page.screenshot({ path: testInfo.outputPath('chat-antes-validacion-geometrica.png') });
  const threadWidth = (await page.locator('.chat-thread').boundingBox()).width;
  for (const text of ['Hola', 'Gracias']) {
    const item = bubble(page, text);
    await item.scrollIntoViewIfNeeded();
    const rect = await item.boundingBox();
    const styles = await item.evaluate((node) => [node, ...node.children, ...node.querySelectorAll('footer button')].map((el) => { const s = getComputedStyle(el); return { tag: el.tagName, height: el.getBoundingClientRect().height, padding: s.padding, minHeight: s.minHeight, margin: s.margin }; }));
    expect(rect.height, JSON.stringify(styles)).toBeLessThanOrEqual(64);
    expect(rect.width, `${text}: no debe ocupar una fila completa`).toBeLessThan(threadWidth * 0.7);
    expect(rect.width, `${text}: una frase corta no necesita 300 px`).toBeLessThan(300);
  }
  await expect(bubble(page, LONG_WORD)).toBeVisible();
  await expect(page.getByRole('button', { name: new RegExp(FILE_NAME.replaceAll('.', '\\.')) })).toBeVisible();
  await expect(page.locator('.chat-bubble').getByText('Mensaje retirado')).toBeVisible();
  await expect(page.locator('.chat-bubble').getByText('Este texto ya no debe mostrarse')).toHaveCount(0);
  await expectNoOverflow(page);
  await page.screenshot({ path: testInfo.outputPath('chat-compacto-claro.png') });
});

test('tema oscuro conserva contraste, accesibilidad, compositor y ancho móvil de 360 px', async ({ page }, testInfo) => {
  if (testInfo.project.name === 'movil-android') await page.setViewportSize({ width: 360, height: 740 });
  await mockChat(page, { theme: 'dark' });
  await openThread(page);
  await expect(editor(page)).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeInViewport();
  await expectNoOverflow(page);
  const result = await new AxeBuilder({ page }).include('.chat-page').withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(result.violations.filter(({ impact }) => ['critical', 'serious'].includes(impact))).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('chat-compacto-oscuro.png') });
});

test('fallar al enviar conserva el borrador; reintentar y Enter envían una sola vez', async ({ page }) => {
  const state = await mockChat(page);
  await openThread(page);
  state.failSend = true;
  await editor(page).fill('Mensaje que no se debe perder');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(page.getByText('No se pudo enviar el mensaje. Inténtalo nuevamente.', { exact: true })).toBeVisible();
  await expect(editor(page)).toHaveValue('Mensaje que no se debe perder');
  expect(state.sent).toHaveLength(0);
  state.failSend = false;
  await editor(page).press('Enter');
  await expect(bubble(page, 'Mensaje que no se debe perder')).toBeVisible();
  await expect(editor(page)).toHaveValue('');
  expect(state.sent).toHaveLength(1);
  await editor(page).fill('Primera línea');
  await editor(page).press('Shift+Enter');
  await editor(page).pressSequentially('Segunda línea');
  expect(state.sent).toHaveLength(1);
  await editor(page).press('Enter');
  await expect.poll(() => state.sent.length).toBe(2);
  expect(state.sent[1].contenido).toBe('Primera línea\nSegunda línea');
});

test('menciones, urgencia y adjunto conservan su comportamiento tras compactar el chat', async ({ page }) => {
  const state = await mockChat(page);
  await openThread(page);
  await page.getByRole('button', { name: 'Mencionar a una persona' }).click();
  await page.getByRole('button', { name: '@Camila de prueba', exact: true }).click();
  await editor(page).pressSequentially('revisa esto');
  await page.getByRole('button', { name: 'Marcar como urgente' }).click();
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect.poll(() => state.sent.length).toBe(1);
  expect(state.sent[0]).toMatchObject({ tipo: 'URGENTE', menciones: [2] });
  expect(state.sent[0].contenido).toContain('@Camila de prueba');
  await page.locator('.chat-composer input[type=file]').setInputFiles({ name: 'archivo-prueba.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await expect.poll(() => state.uploads.length).toBe(1);
  expect(state.uploads[0].file_name).toBe('archivo-prueba.pdf');
  await expect(page.getByRole('button', { name: /archivo-prueba\.pdf.*Descargar archivo/ })).toBeVisible();
  await expectNoOverflow(page);
});

test('un envío pendiente bloquea dobles envíos y evita perder texto editado en tránsito', async ({ page }) => {
  const state = await mockChat(page);
  await openThread(page);
  let release;
  state.sendGate = new Promise((resolve) => { release = resolve; });
  await editor(page).fill('Mensaje en tránsito');
  await page.getByRole('button', { name: 'Enviar', exact: true }).click();
  try {
    await expect(editor(page)).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Enviar', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Mencionar a una persona' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Marcar como urgente' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Adjuntar archivo' })).toBeDisabled();
    expect(state.sent).toHaveLength(0);
  } finally {
    release();
  }
  await expect.poll(() => state.sent.length).toBe(1);
  await expect(editor(page)).toBeEnabled();
  await expect(editor(page)).toHaveValue('');
  await expect(bubble(page, 'Mensaje en tránsito')).toBeVisible();
});

test('adjunto excedido no se envía; descarga válida y error no se confunden', async ({ page }) => {
  const state = await mockChat(page);
  await openThread(page);
  await page.locator('.chat-composer input[type=file]').setInputFiles({ name: 'demasiado-grande.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(8 * 1024 * 1024 + 1) });
  await expect(page.getByText('El archivo supera el máximo permitido de 8 MB.', { exact: true })).toBeVisible();
  expect(state.uploads).toHaveLength(0);
  const attachment = page.locator('.chat-attachment').filter({ hasText: FILE_NAME });
  const downloadEvent = page.waitForEvent('download');
  await attachment.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe(FILE_NAME);
  expect(await download.failure()).toBeNull();
  state.failDownload = true;
  await attachment.click();
  await expect(page.getByText('El archivo no está disponible.', { exact: true })).toBeVisible();
});

test('membresía sin moderación no ofrece fijar ni acciones sin permiso', async ({ page }) => {
  await mockChat(page, { memberRole: 'MIEMBRO', permissions: ['chat.access'] });
  await openThread(page);
  await expect(page.getByRole('button', { name: 'Fijar mensaje', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Quitar fijado', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Adjuntar archivo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Marcar como urgente' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Nueva conversación' })).toHaveCount(0);
});

test('una actualización fallida avisa, conserva mensajes previos y permite recuperar', async ({ page }) => {
  const state = await mockChat(page);
  await openThread(page);
  state.failLoad = true;
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ldsm:chat-message', { detail: { conversation_id: 101 } })));
  await expect(page.locator('.chat-thread').getByText('La conversación no está disponible temporalmente. Reintenta.', { exact: true })).toBeVisible();
  await expect(bubble(page, 'Gracias')).toBeVisible();
  state.failLoad = false;
  await page.locator('.chat-thread').getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.locator('.chat-thread').getByText('La conversación no está disponible temporalmente. Reintenta.', { exact: true })).toHaveCount(0);
  await expect(editor(page)).toBeEnabled();
});

test('lista, búsqueda, retorno móvil y registro contextual mantienen la navegación', async ({ page }, testInfo) => {
  await mockChat(page);
  await page.goto('/chat');
  const search = page.getByRole('textbox', { name: 'Buscar conversaciones o mensajes' });
  await search.fill('Camila');
  await expect(page.locator('.chat-conversations > button')).toHaveCount(1);
  await search.fill('');
  await expect(page.locator('.chat-conversations > button')).toHaveCount(2);
  await page.locator('.chat-conversations > button').filter({ hasText: 'Camila de prueba' }).click();
  await expect(page).toHaveURL(/\/chat\/101$/);
  if (testInfo.project.name === 'movil-android') {
    await page.getByRole('button', { name: 'Volver a conversaciones' }).click();
    await expect(page).toHaveURL(/\/chat$/);
  }
  await page.locator('.chat-conversations > button').filter({ hasText: 'Documento de prueba' }).click();
  await expect(page.getByLabel('Registro vinculado a esta conversación')).toContainText('Documento de prueba');
  await page.getByRole('button', { name: 'Volver al documento' }).click();
  await expect(page).toHaveURL(/\/admin\/documentos\/ficha\/51$/);
});

test('una conversación que falla al abrir permite reintentar y volver al listado', async ({ page }) => {
  const state = await mockChat(page);
  state.failLoad = true;
  await page.goto('/chat/101');
  await expect(page.getByRole('heading', { name: 'No pudimos abrir la conversación' })).toBeVisible();
  const back = page.locator('.chat-thread').getByRole('button', { name: 'Volver a conversaciones', exact: true });
  await expect(back).toBeVisible();
  state.failLoad = false;
  await page.locator('.chat-thread').getByRole('button', { name: 'Reintentar', exact: true }).click();
  await expect(page.locator('.chat-thread h2')).toHaveText('Camila de prueba');
  await expect(editor(page)).toBeEnabled();
});

for (const [permission, allowed, absent] of [
  ['chat.group.create', 'Grupo', ['Directa', 'Canal']],
  ['chat.channels.manage', 'Canal', ['Directa', 'Grupo']],
]) {
  test(`crear conversación respeta permiso exclusivo: ${allowed}`, async ({ page }) => {
    await mockChat(page, { permissions: ['chat.access', permission] });
    await page.goto('/chat');
    await page.getByRole('button', { name: 'Nueva conversación', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Nueva conversación', exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: allowed, exact: true })).toHaveClass(/active/);
    for (const name of absent) await expect(dialog.getByRole('button', { name, exact: true })).toHaveCount(0);
    await expect(dialog.getByLabel('Nombre', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(dialog).toHaveCount(0);
  });
}
