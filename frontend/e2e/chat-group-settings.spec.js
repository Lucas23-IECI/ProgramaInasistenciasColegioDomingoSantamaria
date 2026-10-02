import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Buffer } from 'node:buffer';

// UI-only fixtures: all API traffic is intercepted; no school/QA data is read or changed.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const DATE = '2026-09-25T12:00:00.000Z';
const people = [
  { id: 1, usuario_id: 1, nombre: 'Cuenta de prueba', cargo: 'Inspectoría' },
  { id: 2, usuario_id: 2, nombre: 'Camila de prueba', cargo: 'Coordinación' },
  { id: 3, usuario_id: 3, nombre: 'Diego de prueba', cargo: 'Secretaría' },
  { id: 4, usuario_id: 4, nombre: 'Andrea de prueba', cargo: 'Convivencia' },
];

async function fixture(page, { role = 'PROPIETARIO', type = 'GRUPO' } = {}) {
  const state = {
    groupWrites: [], roleWrites: [], adds: [], removals: [], preferenceWrites: [], retentionWrites: [],
    failGroup: false, failRole: false, groupGate: null, left: false,
    conversation: {
      id_conversacion: 101, tipo: type, nombre: 'Coordinación de prueba', titulo: 'Coordinación de prueba',
      descripcion: 'Acuerdos del equipo, exclusivamente de prueba.', miembro_rol: role, pinned: [],
      solo_administradores: false, foto_version: null,
      members: people.slice(0, 3).map((person, index) => ({ ...person, rol: index === 0 ? role : index === 1 ? (role === 'PROPIETARIO' ? 'MODERADOR' : 'PROPIETARIO') : 'MIEMBRO' })),
    },
  };
  await page.addInitScript(() => {
    localStorage.setItem('ldsm-theme', 'light');
    const originalGet = Storage.prototype.getItem;
    Storage.prototype.getItem = function getItem(key) { return String(key).startsWith('ldsm-release:') ? 'seen' : originalGet.call(this, key); };
  });
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/auth/me') return json({ user: { id: 1, nombre: people[0].nombre, rol: 'inspector', permissions: ['chat.access', 'chat.attach', 'chat.urgent', 'chat.group.create', 'chat.direct.create', 'chat.channels.manage'] } });
    if (path.endsWith('/eventos')) return route.fulfill({ status: 204 });
    if (path === '/api/chat/resumen') return json({ no_leidos: 0 });
    if (path === '/api/chat/directorio') return json(people);
    if (path === '/api/chat/conversaciones') return json(state.left ? [] : [state.conversation]);
    if (path === '/api/chat/conversaciones/101') return state.left ? json({ message: 'Ya no perteneces a la conversación.' }, 403) : json(state.conversation);
    if (path === '/api/chat/conversaciones/101/mensajes') return json([{
      id_mensaje: 1, id_conversacion: 101, enviado_por: 2, autor_nombre: people[1].nombre,
      contenido: 'Mensaje del equipo de prueba.', tipo: 'NORMAL', enviado_en: DATE, adjuntos: [], lecturas_otros: 1
    }]);
    if (path === '/api/chat/conversaciones/101/grupo') {
      const body = request.postDataJSON();
      state.groupWrites.push(body);
      if (state.groupGate) await state.groupGate;
      if (state.failGroup) return json({ message: 'No se pudo actualizar el grupo. Inténtalo nuevamente.' }, 503);
      Object.assign(state.conversation, body, { titulo: body.nombre });
      if ('foto_data' in body) state.conversation.foto_version = body.foto_data ? `foto-${state.groupWrites.length}` : null;
      return json(state.conversation);
    }
    if (path.endsWith('/foto')) return route.fulfill({ contentType: 'image/png', body: PNG });
    if (/\/miembros\/\d+\/rol$/.test(path)) {
      const id = Number(path.split('/').at(-2));
      const body = request.postDataJSON();
      state.roleWrites.push({ id, ...body });
      if (state.failRole) return json({ message: 'No se pudo cambiar el rol. Inténtalo nuevamente.' }, 503);
      state.conversation.members.find((member) => member.usuario_id === id).rol = body.rol;
      if (id === 1) state.conversation.miembro_rol = body.rol;
      return json({ ok: true });
    }
    if (/\/miembros\/\d+$/.test(path)) {
      const id = Number(path.split('/').at(-1));
      state.removals.push(id);
      state.conversation.members = state.conversation.members.filter((member) => member.usuario_id !== id);
      if (id === 1) state.left = true;
      return json({ ok: true });
    }
    if (path.endsWith('/miembros')) {
      const body = request.postDataJSON();
      state.adds.push(body);
      state.conversation.members.push(...people.filter((person) => body.miembros.includes(person.id)).map((person) => ({ ...person, rol: 'MIEMBRO' })));
      return json({ ok: true });
    }
    if (path.endsWith('/preferencias')) { state.preferenceWrites.push(request.postDataJSON()); return json({ ok: true }); }
    if (path.endsWith('/configuracion')) { state.retentionWrites.push(request.postDataJSON()); return json({ ok: true }); }
    if (path === '/api/notificaciones') return json({ items: [], unread: 0, pagination: { page: 1, pages: 1 } });
    return json({});
  });
  return state;
}

const panel = (page) => page.locator('.chat-group-settings');

test('canal institucional explica la sincronización y no ofrece cambios que serán reemplazados', async ({ page }) => {
  const state = await fixture(page, { type: 'CANAL' });
  state.conversation.codigo_institucional = 'SEGUIMIENTO_QA';
  await openSettings(page, 'Grupo');
  await expect(panel(page).getByRole('note')).toContainText('Canal institucional automático');
  await expect(panel(page).getByLabel('Nombre del grupo')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Guardar grupo', exact: true })).toHaveCount(0);
  await panel(page).getByRole('tab', { name: 'Integrantes', exact: true }).click();
  await expect(panel(page).getByRole('combobox')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /Salir del grupo|Retirar a/ })).toHaveCount(0);
  await panel(page).getByRole('tab', { name: 'Avisos', exact: true }).click();
  await expect(panel(page).getByText('Días antes de retirar el contenido')).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Menciones', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect.poll(() => state.preferenceWrites.length).toBe(1);
  expect(state.retentionWrites).toHaveLength(0);
});
async function openSettings(page, tab = 'Avisos') {
  await page.goto('/chat/101');
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
  await expect(panel(page)).toBeVisible();
  await panel(page).getByRole('tab', { name: tab, exact: true }).click();
}

test('guardar nombre, descripción, foto y permisos del grupo no modifica avisos personales', async ({ page }) => {
  const state = await fixture(page);
  await openSettings(page, 'Grupo');
  await panel(page).getByLabel('Nombre del grupo', { exact: true }).fill('Equipo actualizado de prueba');
  const description = panel(page).getByLabel('Descripción del grupo', { exact: true });
  await expect(description).toHaveAccessibleName('Descripción del grupo');
  await description.fill('Acuerdos y documentos internos.');
  const administratorsOnly = panel(page).getByRole('checkbox', { name: 'Solo administradores pueden enviar mensajes', exact: true });
  await expect(administratorsOnly).toHaveAccessibleDescription('Propietarios y administradores podrán escribir y adjuntar archivos. Los demás integrantes podrán leer.');
  await administratorsOnly.check();
  await panel(page).getByLabel('Foto del grupo', { exact: true }).setInputFiles({ name: 'equipo.png', mimeType: 'image/png', buffer: PNG });
  await expect(panel(page).getByRole('img', { name: 'Foto del grupo' })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Guardar grupo', exact: true }).click();
  await expect.poll(() => state.groupWrites.length).toBe(1);
  expect(state.groupWrites[0]).toMatchObject({ nombre: 'Equipo actualizado de prueba', descripcion: 'Acuerdos y documentos internos.', solo_administradores: true });
  expect(state.groupWrites[0].foto_data).toMatch(/^data:image\/png;base64,/);
  await expect(page.locator('.chat-thread > header h2')).toHaveText('Equipo actualizado de prueba');
  expect(state.preferenceWrites).toHaveLength(0);
  expect(state.retentionWrites).toHaveLength(0);
  await administratorsOnly.uncheck();
  await panel(page).getByRole('button', { name: 'Quitar foto', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Guardar grupo', exact: true }).click();
  await expect.poll(() => state.groupWrites.length).toBe(2);
  expect(state.groupWrites[1].foto_data).toBeNull();
  expect(state.groupWrites[1].solo_administradores).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
  await panel(page).getByRole('tab', { name: 'Grupo', exact: true }).click();
  await expect(administratorsOnly).not.toBeChecked();
  await expect(panel(page).getByRole('img', { name: 'Foto del grupo' })).toHaveCount(0);
  await expect(description).toHaveValue('Acuerdos y documentos internos.');
});

test('nombre y descripción admiten los mismos límites que el servidor y mantienen etiquetas estables', async ({ page }) => {
  const state = await fixture(page);
  await openSettings(page, 'Grupo');
  const name = panel(page).getByLabel('Nombre del grupo', { exact: true });
  const description = panel(page).getByLabel('Descripción del grupo', { exact: true });
  await expect(name).toHaveAttribute('maxlength', '180');
  await expect(description).toHaveAttribute('maxlength', '500');
  await name.fill('N'.repeat(180));
  await description.fill('D'.repeat(500));
  await expect(description).toHaveAccessibleName('Descripción del grupo');
  await panel(page).getByRole('button', { name: 'Guardar grupo', exact: true }).click();
  await expect.poll(() => state.groupWrites.length).toBe(1);
  expect(state.groupWrites[0]).toMatchObject({ nombre: 'N'.repeat(180), descripcion: 'D'.repeat(500) });
});

test('rechaza fotos inválidas y conserva los cambios cuando falla guardar', async ({ page }) => {
  const state = await fixture(page);
  await openSettings(page, 'Grupo');
  const upload = panel(page).getByLabel('Foto del grupo', { exact: true });
  await upload.setInputFiles({ name: 'no-es-foto.gif', mimeType: 'image/gif', buffer: Buffer.from('fake') });
  await expect(panel(page).getByRole('alert')).toContainText('JPG o PNG');
  await expect(panel(page).getByRole('button', { name: 'Guardar grupo', exact: true })).toBeDisabled();
  await upload.setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: Buffer.alloc(4 * 1024 * 1024 + 1) });
  await expect(panel(page).getByRole('alert')).toContainText('supera los 4 MB');
  await upload.setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await panel(page).getByLabel('Nombre del grupo', { exact: true }).fill('');
  await panel(page).getByRole('button', { name: 'Guardar grupo', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('Escribe un nombre');
  expect(state.groupWrites).toHaveLength(0);
  await panel(page).getByLabel('Nombre del grupo', { exact: true }).fill('Nombre conservado');
  state.failGroup = true;
  await panel(page).getByRole('button', { name: 'Guardar grupo', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('No se pudo actualizar');
  await expect(panel(page).getByLabel('Nombre del grupo', { exact: true })).toHaveValue('Nombre conservado');
  await expect(panel(page).getByRole('img', { name: 'Foto del grupo' })).toBeVisible();
  state.failGroup = false;
  await panel(page).getByRole('button', { name: 'Guardar grupo', exact: true }).click();
  await expect(page.locator('.chat-thread > header h2')).toHaveText('Nombre conservado');
});

test('propietario protege su último rol y puede nombrar administradores con confirmación', async ({ page }) => {
  const state = await fixture(page);
  await openSettings(page, 'Integrantes');
  await expect(panel(page).getByLabel('Rol de Cuenta de prueba')).toBeDisabled();
  await expect(panel(page).getByRole('button', { name: 'Salir del grupo', exact: true })).toBeDisabled();
  const diego = panel(page).getByLabel('Rol de Diego de prueba', { exact: true });
  await diego.selectOption('MODERADOR');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(state.roleWrites).toHaveLength(0);
  await diego.selectOption('MODERADOR');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cambiar rol', exact: true }).click();
  await expect(diego).toHaveValue('MODERADOR');
  expect(state.roleWrites).toEqual([{ id: 3, rol: 'MODERADOR' }]);
  await diego.selectOption('PROPIETARIO');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cambiar rol', exact: true }).click();
  await expect(panel(page).getByLabel('Rol de Cuenta de prueba')).toBeEnabled();
  await expect(panel(page).getByRole('button', { name: 'Salir del grupo', exact: true })).toBeEnabled();
});

test('administrador incorpora integrantes pero no puede cambiar roles ni retirar propietarios', async ({ page }) => {
  const state = await fixture(page, { role: 'MODERADOR' });
  await openSettings(page, 'Integrantes');
  await expect(panel(page).getByLabel(/Rol de/)).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: 'Retirar a Camila de prueba' })).toHaveCount(0);
  await panel(page).getByLabel('Incorporar a una persona').selectOption('4');
  await panel(page).getByRole('button', { name: 'Agregar', exact: true }).click();
  await expect(panel(page).getByText('Andrea de prueba', { exact: true })).toBeVisible();
  expect(state.adds).toEqual([{ miembros: [4] }]);
  await panel(page).getByRole('button', { name: 'Retirar a Diego de prueba', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Retirar', exact: true }).click();
  await expect(panel(page).getByText('Diego de prueba', { exact: true })).toHaveCount(0);
  expect(state.removals).toEqual([3]);
});

test('un cambio de rol fallido conserva el rol anterior y permite reintentar', async ({ page }) => {
  const state = await fixture(page);
  state.failRole = true;
  await openSettings(page, 'Integrantes');
  const role = panel(page).getByLabel('Rol de Diego de prueba', { exact: true });
  await role.selectOption('MODERADOR');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cambiar rol', exact: true }).click();
  await expect(panel(page).getByRole('alert')).toContainText('No se pudo cambiar el rol');
  await expect(role).toHaveValue('MIEMBRO');
  await expect(role).toBeEnabled();
  expect(state.roleWrites).toEqual([{ id: 3, rol: 'MODERADOR' }]);
  state.failRole = false;
  await role.selectOption('MODERADOR');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Cambiar rol', exact: true }).click();
  await expect(role).toHaveValue('MODERADOR');
  await expect(panel(page).getByRole('alert')).toHaveCount(0);
  expect(state.roleWrites).toEqual([{ id: 3, rol: 'MODERADOR' }, { id: 3, rol: 'MODERADOR' }]);
});

test('integrante puede consultar el equipo y salir sin ver controles administrativos', async ({ page }) => {
  const state = await fixture(page, { role: 'MIEMBRO' });
  await openSettings(page, 'Grupo');
  await expect(panel(page).getByText('Solo los propietarios y administradores pueden editar el grupo.')).toBeVisible();
  await expect(panel(page).getByLabel('Nombre del grupo')).toHaveCount(0);
  await expect(panel(page).getByLabel('Foto del grupo')).toHaveCount(0);
  await panel(page).getByRole('tab', { name: 'Integrantes', exact: true }).click();
  await expect(panel(page).getByText('Camila de prueba', { exact: true })).toBeVisible();
  await expect(panel(page).getByLabel(/Rol de/)).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /Retirar a/ })).toHaveCount(0);
  await expect(panel(page).getByLabel('Incorporar a una persona')).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Salir del grupo', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Salir del grupo', exact: true }).click();
  await expect.poll(() => state.removals).toEqual([1]);
  await expect(page).toHaveURL(/\/chat$/);
  await expect(panel(page)).toHaveCount(0);
});

test('chat directo conserva solo las preferencias personales', async ({ page }) => {
  const state = await fixture(page, { type: 'DIRECTA' });
  await openSettings(page);
  await expect(panel(page).getByRole('tab')).toHaveCount(1);
  await panel(page).getByRole('button', { name: 'Menciones', exact: true }).click();
  await panel(page).getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(panel(page)).toHaveCount(0);
  expect(state.preferenceWrites[0].notificaciones).toBe('MENCIONES');
  expect(state.groupWrites).toHaveLength(0);
});

test('pestañas, teclado y controles caben en móvil, escritorio y modo oscuro', async ({ page }, testInfo) => {
  await fixture(page);
  await openSettings(page, 'Grupo');
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: 820 });
    const bounds = await panel(page).boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    expect(await panel(page).evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
    await expect(panel(page).getByRole('button', { name: 'Guardar grupo', exact: true })).toBeInViewport();
    if ([375, 1440].includes(width)) await page.screenshot({ path: testInfo.outputPath(`grupo-opciones-${width}.png`), scale: 'css' });
  }
  const axe = await new AxeBuilder({ page }).include('.chat-group-settings').analyze();
  expect(axe.violations).toEqual([]);
  await panel(page).getByRole('tab', { name: 'Grupo', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(panel(page).getByRole('tab', { name: 'Integrantes', exact: true })).toBeFocused();
  await expect(panel(page).getByRole('tab', { name: 'Integrantes', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.evaluate(() => document.body.classList.remove('light-mode'));
  await page.screenshot({ path: testInfo.outputPath('grupo-integrantes-oscuro.png'), scale: 'css' });
  const darkAxe = await new AxeBuilder({ page }).include('.chat-group-settings').analyze();
  expect(darkAxe.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Preferencias', exact: true })).toBeFocused();
});

test('una foto aún en lectura no se conserva después de cerrar el panel', async ({ page }) => {
  const state = await fixture(page);
  await page.addInitScript(() => {
    const originalRead = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function readAsDataURL(file) {
      window.releaseGroupPhoto = () => new Promise((resolve) => {
        this.addEventListener('loadend', resolve, { once: true });
        originalRead.call(this, file);
      });
    };
  });
  await openSettings(page, 'Grupo');
  await panel(page).getByLabel('Foto del grupo', { exact: true }).setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
  await expect(panel(page).getByText('Preparando foto…')).toBeVisible();
  await panel(page).getByRole('button', { name: 'Cerrar preferencias', exact: true }).click();
  await page.evaluate(() => window.releaseGroupPhoto());
  await page.getByRole('button', { name: 'Preferencias', exact: true }).click();
  await panel(page).getByRole('tab', { name: 'Grupo', exact: true }).click();
  await expect(panel(page).getByRole('img', { name: 'Foto del grupo' })).toHaveCount(0);
  await panel(page).getByRole('button', { name: 'Guardar grupo', exact: true }).click();
  await expect.poll(() => state.groupWrites.length).toBe(1);
  expect(state.groupWrites[0]).not.toHaveProperty('foto_data');
});

test('un guardado pendiente bloquea duplicados y no cierra al fallar', async ({ page }) => {
  const state = await fixture(page);
  let release;
  state.groupGate = new Promise((resolve) => { release = resolve; });
  try {
    await openSettings(page, 'Grupo');
    await panel(page).getByLabel('Nombre del grupo').fill('Edición pendiente de prueba');
    await panel(page).getByRole('button', { name: 'Guardar grupo', exact: true }).dblclick();
    await expect.poll(() => state.groupWrites.length).toBe(1);
    await expect(panel(page).getByRole('button', { name: 'Guardando…', exact: true })).toBeDisabled();
    state.failGroup = true;
    release();
    await expect(panel(page).getByRole('alert')).toBeVisible();
    await expect(panel(page).getByLabel('Nombre del grupo')).toHaveValue('Edición pendiente de prueba');
    expect(state.groupWrites).toHaveLength(1);
    state.failGroup = false;
    await panel(page).getByRole('button', { name: 'Guardar grupo', exact: true }).click();
    await expect(page.locator('.chat-thread > header h2')).toHaveText('Edición pendiente de prueba');
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    expect(state.groupWrites).toHaveLength(2);
  } finally { release(); }
});
