const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sharp = require('sharp');
const fs = require('node:fs');
const { createInternalChatRouter } = require('../routes/internalChat');
const { processChatImage, publicConversation, assertCanSend } = require('../services/chatPresentationService');

const result = (rows = []) => ({ rows, rowCount: rows.length });
const imageData = async () => `data:image/jpeg;base64,${(await sharp({ create: { width: 800, height: 600, channels: 3, background: '#8eaece' } }).jpeg().withMetadata({ comment: 'private fixture metadata' }).toBuffer()).toString('base64')}`;

// In-memory SQL double behind the real Express router. These checks exercise
// HTTP contracts, authorization and image handling, not PostgreSQL concurrency.
async function fixture(t, options = {}) {
  const state = {
    conversation: { id_conversacion: 7, tipo: 'GRUPO', nombre: 'Grupo de prueba', descripcion: null, solo_administradores: false, activa: true, foto_version: 'v1', foto_data: null },
    members: { 1: { rol: 'PROPIETARIO', activo: true }, 2: { rol: 'MODERADOR', activo: true }, 3: { rol: 'MIEMBRO', activo: true } },
    appearance: {}, queries: [], audits: [], events: [], releases: 0, signalReleases: [], doc: null, failAudit: false, failQuery: false,
    ...options,
  };
  let beforeTransaction;
  const query = async (source, args = []) => {
    const sql = String(source).replace(/\s+/g, ' ').trim();
    state.queries.push({ sql, args });
    if (sql === 'BEGIN') {
      beforeTransaction = structuredClone({ conversation: state.conversation, members: state.members });
      return result();
    }
    if (sql === 'COMMIT') return result();
    if (sql === 'ROLLBACK') { if (beforeTransaction) Object.assign(state, beforeTransaction); return result(); }
    if (state.failQuery) throw new Error('private SQL detail: internal connection credential');
    if (sql.startsWith('SELECT * FROM chat_conversaciones WHERE clave_dedupe')) return state.conversation.clave_dedupe === args[0] && state.conversation.activa ? result([{ ...state.conversation }]) : result();
    if (sql.startsWith('SELECT 1 FROM usuarios')) return state.members[args[0]]?.activo ? result([{ exists: 1 }]) : result();
    if (sql.startsWith('INSERT INTO chat_miembros') || sql.startsWith('INSERT INTO chat_vinculos')) return result();
    if (sql.includes('FROM chat_conversaciones c') && sql.includes('JOIN chat_miembros m')) {
      if (!Number.isSafeInteger(Number(args[0]))) throw Object.assign(new Error('invalid input syntax for bigint'), { code: '22P02' });
      const member = state.members[args[1]];
      return Number(args[0]) === 7 && state.conversation.activa && member?.activo
        ? result([{ ...state.conversation, miembro_rol: member.rol }]) : result();
    }
    if (sql.startsWith('SELECT fondo,tamano_texto,fondo_data')) return result(state.appearance[args[0]] ? [state.appearance[args[0]]] : []);
    if (sql.startsWith('INSERT INTO chat_apariencia_usuario')) {
      state.appearance[args[0]] = { fondo: args[1], tamano_texto: args[2], fondo_data: args[3] };
      return result([state.appearance[args[0]]]);
    }
    if (sql.startsWith('UPDATE chat_conversaciones SET nombre=')) {
      state.conversation = { ...state.conversation, nombre: args[1], descripcion: args[2], solo_administradores: args[3], foto_data: args[4], foto_version: args[5] };
      return result([state.conversation]);
    }
    if (sql.startsWith('SELECT rol FROM chat_miembros')) {
      if (!Number.isSafeInteger(Number(args[1]))) throw Object.assign(new Error('invalid input syntax for bigint'), { code: '22P02' });
      const member = state.members[args[1]];
      return member?.activo ? result([{ rol: member.rol }]) : result();
    }
    if (sql.startsWith('SELECT COUNT(*)::int AS total FROM chat_miembros')) return result([{ total: Object.values(state.members).filter((member) => member.activo && member.rol === 'PROPIETARIO').length }]);
    if (sql.startsWith('UPDATE chat_miembros SET rol=')) { state.members[args[1]].rol = args[2]; return result(); }
    if (sql.startsWith('UPDATE chat_miembros SET activo=false')) { state.members[args[1]].activo = false; return result(); }
    if (sql.startsWith('SELECT usuario_id FROM chat_miembros')) {
      state.signalReleases.push(state.releases);
      return result(Object.entries(state.members).filter(([, member]) => member.activo).map(([usuario_id]) => ({ usuario_id: Number(usuario_id) })));
    }
    if (sql.startsWith('SELECT d.* FROM chat_adjuntos')) return result(state.doc && Number(args[0]) === 11 && Number(args[1]) === 7 ? [state.doc] : []);
    if (sql.startsWith('SELECT m.usuario_id,m.rol')) return result(Object.entries(state.members).filter(([, member]) => member.activo).map(([usuario_id, member]) => ({ usuario_id: Number(usuario_id), ...member })));
    if (sql.includes('FROM chat_vinculos') || sql.includes('FROM chat_mensajes_fijados')) return result();
    throw new Error(`Unmapped test query: ${sql}`);
  };
  const pool = { query, connect: async () => ({ query, release: () => { state.releases += 1; } }) };
  const app = express();
  app.use(express.json({ limit: '6mb' }));
  // A fake file sink avoids creating files in the configured uploads directory.
  app.use((_req, res, next) => {
    res.sendFile = (file) => { state.servedFile = file; res.send('fixture image bytes'); };
    next();
  });
  app.use('/chat', createInternalChatRouter({
    pool,
    verifyToken: (req, res, next) => {
      if (req.headers['x-test-user'] === 'none') return res.status(401).json({ message: 'Inicia sesión.' });
      req.user = { id: Number(req.headers['x-test-user'] || 1), correo: 'test@example.test', permissions: req.headers['x-test-permission'] === 'deny' ? [] : (options.permissions || ['chat.access', 'chat.attach']) };
      next();
    },
    verifyPermission: (permission) => (req, res, next) => req.user.permissions.includes(permission) ? next() : res.status(403).json({ message: 'Sin permiso.' }),
    insertarAudit: async (_client, entry) => { if (state.failAudit) throw new Error('audit unavailable'); state.audits.push(entry); },
    getClientIp: () => '127.0.0.1',
    realtimeHub: { publishToUsers: (...entry) => state.events.push(entry) },
  }));
  const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const send = async (path, { method = 'GET', body, user = '1', denied = false } = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/chat${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-Test-User': user, ...(denied ? { 'X-Test-Permission': 'deny' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, headers: response.headers, text, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null };
  };
  return { state, send };
}

const groupChange = { nombre: 'Nuevo grupo', descripcion: 'Coordinación institucional', solo_administradores: true };

test('canales automáticos no aceptan cambios manuales que el sincronizador reemplazaría', async (t) => {
  const { send, state } = await fixture(t, { permissions: ['chat.access', 'chat.channels.manage'] });
  state.conversation.codigo_institucional = 'SEGUIMIENTO_QA';
  for (const [suffix, method, body] of [
    ['/grupo', 'PATCH', groupChange], ['/miembros/2/rol', 'PATCH', { rol: 'MIEMBRO' }],
    ['/miembros/2', 'DELETE', undefined], ['/miembros', 'POST', { miembros: [3] }],
    ['/configuracion', 'PATCH', { retencion_dias: 90 }],
  ]) {
    const response = await send(`/conversaciones/7${suffix}`, { method, body });
    assert.equal(response.status, 409, suffix);
    assert.match(response.body.message, /automáticamente/);
  }
  assert.equal(state.audits.length, 0);
  assert.equal(state.members[2].activo, true);
  assert.equal(state.members[2].rol, 'MODERADOR');
});

test('chat imagen: normaliza tamaño, orientación y formato sin conservar metadata', async () => {
  const raw = await imageData();
  const original = await sharp(Buffer.from(raw.split(',')[1], 'base64')).metadata();
  assert.ok(original.exif || original.icc);
  for (const avatar of [false, true]) {
    const normalized = await processChatImage(raw, avatar);
    assert.match(normalized, /^data:image\/jpeg;base64,/);
    const metadata = await sharp(Buffer.from(normalized.split(',')[1], 'base64')).metadata();
    assert.equal(metadata.format, 'jpeg');
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.ok(metadata.width <= (avatar ? 256 : 1600));
    assert.ok(metadata.height <= (avatar ? 256 : 1200));
  }
});

test('chat imagen: rechaza SVG, URLs, bytes corruptos y exceso de tamaño', async () => {
  for (const value of [null, 'https://example.test/image.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=', 'data:image/png;base64,bm90YW5pbWFnZQ==', `data:image/png;base64,${'A'.repeat(5_600_000)}`]) {
    await assert.rejects(processChatImage(value), (error) => error.statusCode === 400 && !error.message.includes('sharp'));
  }
});

test('la foto privada no se incluye en metadata y el modo solo administradores se aplica a cada rol', () => {
  const original = { id_conversacion: 7, foto_data: 'private image', foto_version: 'v1', nombre: 'Grupo' };
  assert.deepEqual(publicConversation(original), { id_conversacion: 7, foto_version: 'v1', nombre: 'Grupo' });
  assert.equal(original.foto_data, 'private image');
  assert.throws(() => assertCanSend({ solo_administradores: true, miembro_rol: 'MIEMBRO' }), (error) => error.statusCode === 403);
  for (const miembro_rol of ['PROPIETARIO', 'MODERADOR']) assert.doesNotThrow(() => assertCanSend({ solo_administradores: true, miembro_rol }));
  assert.doesNotThrow(() => assertCanSend({ solo_administradores: false, miembro_rol: 'MIEMBRO' }));
});

test('las nuevas rutas exigen sesión y permiso de chat antes de leer datos', async (t) => {
  const { send, state } = await fixture(t);
  for (const path of ['/apariencia', '/conversaciones/7/foto', '/conversaciones/7/adjuntos/11/vista']) {
    assert.equal((await send(path, { user: 'none' })).status, 401);
    assert.equal((await send(path, { denied: true })).status, 403);
  }
  assert.equal(state.queries.length, 0);
});

test('apariencia: defaults y cambios permanecen separados por usuario', async (t) => {
  const { send, state } = await fixture(t);
  assert.deepEqual((await send('/apariencia')).body, { fondo: 'institucional', tamano_texto: 'normal', fondo_data: null });
  const saved = await send('/apariencia', { method: 'PATCH', body: { fondo: 'salvia', tamano_texto: 'grande', usuario_id: 2, fondo_data: 'ignored' } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, { fondo: 'salvia', tamano_texto: 'grande', fondo_data: null });
  assert.deepEqual((await send('/apariencia', { user: '2' })).body, { fondo: 'institucional', tamano_texto: 'normal', fondo_data: null });
  assert.deepEqual(Object.keys(state.appearance), ['1']);
  assert.match(saved.headers.get('cache-control'), /no-store/);
});

test('apariencia: valida opciones y procesa imágenes personales sin enlaces externos', async (t) => {
  const { send, state } = await fixture(t);
  for (const body of [{ fondo: 'javascript:alert(1)', tamano_texto: 'normal' }, { fondo: 'azul', tamano_texto: 'gigante' }, { fondo: 'personalizado', tamano_texto: 'normal', fondo_data: 'https://example.test/picture.png' }]) {
    assert.equal((await send('/apariencia', { method: 'PATCH', body })).status, 400);
  }
  assert.deepEqual(state.appearance, {});
  const saved = await send('/apariencia', { method: 'PATCH', body: { fondo: 'personalizado', tamano_texto: 'normal', fondo_data: await imageData() } });
  assert.equal(saved.status, 200);
  assert.match(saved.body.fondo_data, /^data:image\/jpeg;base64,/);
});

test('grupo: miembros normales, ajenos y conversaciones directas no permiten editar', async (t) => {
  const { send, state } = await fixture(t);
  assert.equal((await send('/conversaciones/7/grupo', { method: 'PATCH', user: '3', body: groupChange })).status, 403);
  assert.equal((await send('/conversaciones/7/grupo', { method: 'PATCH', user: '99', body: groupChange })).status, 404);
  state.conversation.tipo = 'DIRECTA';
  assert.equal((await send('/conversaciones/7/grupo', { method: 'PATCH', body: groupChange })).status, 403);
  assert.equal(state.queries.filter(({ sql }) => sql.startsWith('UPDATE')).length, 0);
});

test('grupo: administrador cambia metadata, conserva foto omitida y audita sin exponerla', async (t) => {
  const { send, state } = await fixture(t);
  state.conversation.foto_data = await imageData();
  const photo = state.conversation.foto_data;
  const updated = await send('/conversaciones/7/grupo', { method: 'PATCH', user: '2', body: groupChange });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.nombre, groupChange.nombre);
  assert.equal(updated.body.foto_data, undefined);
  assert.equal(state.conversation.foto_data, photo);
  assert.equal(updated.body.foto_version, 'v1');
  assert.equal(state.audits[0].accion, 'CONFIGURAR_GRUPO_CHAT');
  assert.deepEqual(state.audits[0].detalle, { cambio_foto: false, solo_administradores: true });
  assert.ok(state.queries.some(({ sql }) => sql.includes('FOR UPDATE OF c, m')));
  assert.equal(state.releases, 1);
});

test('grupo: cambiar foto crea versión nueva; quitarla elimina foto y versión', async (t) => {
  const { send, state } = await fixture(t);
  const updated = await send('/conversaciones/7/grupo', { method: 'PATCH', body: { ...groupChange, foto_data: await imageData() } });
  assert.equal(updated.status, 200);
  assert.ok(updated.body.foto_version && updated.body.foto_version !== 'v1');
  assert.equal(updated.body.foto_data, undefined);
  assert.match(state.conversation.foto_data, /^data:image\/jpeg;base64,/);
  const removed = await send('/conversaciones/7/grupo', { method: 'PATCH', body: { ...groupChange, foto_data: null } });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.foto_version, null);
  assert.equal(state.conversation.foto_data, null);
});

test('grupo: libera la conexión transaccional antes de consultar destinatarios en el pool', async (t) => {
  const { send, state } = await fixture(t);
  const updated = await send('/conversaciones/7/grupo', { method: 'PATCH', body: groupChange });
  assert.equal(updated.status, 200);
  assert.deepEqual(state.signalReleases, [1]);
  assert.equal(state.releases, 1);
  assert.equal(state.events.length, 1);
  assert.ok(state.queries.findIndex(({ sql }) => sql === 'COMMIT') < state.queries.findIndex(({ sql }) => sql.startsWith('SELECT usuario_id FROM chat_miembros')));
});

test('contexto existente: reutilizar la conversación no devuelve los bytes de su foto', async (t) => {
  const { send, state } = await fixture(t, { permissions: ['chat.access', 'chat.group.create'] });
  Object.assign(state.conversation, { tipo: 'CONTEXTO', clave_dedupe: 'contexto:SEGUIMIENTO:123', foto_data: 'private photo bytes' });
  const response = await send('/conversaciones', { method: 'POST', body: { tipo: 'CONTEXTO', nombre: 'Seguimiento de prueba', contexto_tipo: 'SEGUIMIENTO', contexto_id: '123', miembros: [3] } });
  assert.equal(response.status, 200);
  assert.equal(response.body.id_conversacion, 7);
  assert.equal(response.body.foto_version, 'v1');
  assert.equal(response.body.foto_data, undefined);
  assert.equal(state.conversation.foto_data, 'private photo bytes');
});

test('grupo: entradas inválidas no realizan cambios y un fallo de auditoría revierte la transacción', async (t) => {
  const { send, state } = await fixture(t);
  for (const body of [{ ...groupChange, nombre: '' }, { ...groupChange, nombre: 'x'.repeat(181) }, { ...groupChange, descripcion: 'x'.repeat(501) }, { ...groupChange, solo_administradores: 'true' }]) {
    assert.equal((await send('/conversaciones/7/grupo', { method: 'PATCH', body })).status, 400);
  }
  state.failAudit = true;
  const updated = await send('/conversaciones/7/grupo', { method: 'PATCH', body: groupChange });
  assert.equal(updated.status, 500);
  assert.equal(updated.body.message, 'No pudimos actualizar el grupo.');
  assert.equal(state.conversation.nombre, 'Grupo de prueba');
  assert.equal(state.events.length, 0);
});

test('roles: sólo propietarios cambian roles y el último propietario no puede degradarse', async (t) => {
  const { send, state } = await fixture(t);
  assert.equal((await send('/conversaciones/7/miembros/3/rol', { method: 'PATCH', user: '2', body: { rol: 'MODERADOR' } })).status, 403);
  assert.equal((await send('/conversaciones/7/miembros/3/rol', { method: 'PATCH', body: { rol: 'ADMINISTRADOR' } })).status, 400);
  assert.equal((await send('/conversaciones/7/miembros/99/rol', { method: 'PATCH', body: { rol: 'MODERADOR' } })).status, 404);
  const blocked = await send('/conversaciones/7/miembros/1/rol', { method: 'PATCH', body: { rol: 'MIEMBRO' } });
  assert.equal(blocked.status, 409);
  assert.equal(state.members[1].rol, 'PROPIETARIO');
  assert.match(blocked.body.message, /otro propietario/);
});

test('roles: puede nombrarse otro propietario y luego cambiar el rol anterior', async (t) => {
  const { send, state } = await fixture(t);
  assert.equal((await send('/conversaciones/7/miembros/3/rol', { method: 'PATCH', body: { rol: 'PROPIETARIO' } })).status, 200);
  assert.equal((await send('/conversaciones/7/miembros/1/rol', { method: 'PATCH', body: { rol: 'MODERADOR' } })).status, 200);
  assert.equal(state.members[3].rol, 'PROPIETARIO');
  assert.equal(state.members[1].rol, 'MODERADOR');
  assert.ok(state.audits.every((entry) => entry.accion === 'CAMBIAR_ROL_CHAT'));
});

test('salida y retiro: protege último propietario y jerarquía de administradores', async (t) => {
  const { send, state } = await fixture(t);
  state.members[4] = { rol: 'MODERADOR', activo: true };
  for (const [target, user, status] of [[1, 1, 409], [1, 2, 403], [4, 2, 403], [2, 3, 403]]) {
    assert.equal((await send(`/conversaciones/7/miembros/${target}`, { method: 'DELETE', user: String(user) })).status, status);
  }
  assert.equal((await send('/conversaciones/7/miembros/3', { method: 'DELETE', user: '2' })).status, 200);
  assert.equal(state.members[3].activo, false);
  assert.ok(state.events[0][0].includes(3), 'el integrante retirado recibe la invalidación de la conversación');
  assert.equal((await send('/conversaciones/7/miembros/2', { method: 'DELETE', user: '2' })).status, 200);
  assert.equal(state.members[2].activo, false);
});

test('foto: exige membresía vigente, responde sin caché y nunca incluye metadata privada', async (t) => {
  const { send, state } = await fixture(t);
  assert.equal((await send('/conversaciones/7/foto')).status, 404);
  state.conversation.foto_data = await processChatImage(await imageData(), true);
  assert.equal((await send('/conversaciones/7/foto', { user: '99' })).status, 404);
  const response = await send('/conversaciones/7/foto', { user: '3' });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^image\/jpeg/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const detail = await send('/conversaciones/7');
  assert.equal(detail.status, 200);
  assert.equal(detail.body.foto_data, undefined);
});

test('vistas previas: no muestran PDF, SVG, archivos ajenos, faltantes ni rutas fuera del almacén', async (t) => {
  const { send, state } = await fixture(t);
  for (const doc of [null, { mime_type: 'application/pdf' }, { mime_type: 'image/svg+xml' }, { mime_type: 'image/png', nombre_almacenado: '../outside.png' }, { mime_type: 'image/png', nombre_almacenado: 'non-existent-presentation-fixture.png' }]) {
    state.doc = doc;
    assert.equal((await send('/conversaciones/7/adjuntos/11/vista')).status, 404);
  }
  state.doc = { mime_type: 'image/png', nombre_almacenado: 'fixture.png' };
  assert.equal((await send('/conversaciones/7/adjuntos/11/vista', { user: '99' })).status, 404);
  assert.equal((await send('/conversaciones/8/adjuntos/11/vista')).status, 404);
  assert.equal((await send('/conversaciones/7/adjuntos/12/vista')).status, 404);
  const docQueries = state.queries.filter(({ sql }) => sql.startsWith('SELECT d.*'));
  assert.ok(docQueries.every(({ sql }) => sql.includes('msg.id_conversacion=$2') && sql.includes('msg.eliminado_en IS NULL')));
});

test('vistas previas: una imagen autorizada se sirve inline y no se almacena en caché', async (t) => {
  const { send, state } = await fixture(t);
  state.doc = { mime_type: 'image/png', nombre_almacenado: 'presentation-test.png' };
  t.mock.method(fs, 'existsSync', () => true);
  const response = await send('/conversaciones/7/adjuntos/11/vista');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^image\/png/);
  assert.equal(response.headers.get('content-disposition'), 'inline');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(state.servedFile, /presentation-test\.png$/);
});

test('identificadores inválidos se rechazan sin un error interno de la base', async (t) => {
  const { send } = await fixture(t);
  for (const entry of [
    { path: '/conversaciones/no/grupo', method: 'PATCH', body: groupChange },
    { path: '/conversaciones/7/miembros/no/rol', method: 'PATCH', body: { rol: 'MIEMBRO' } },
    { path: '/conversaciones/7/miembros/no', method: 'DELETE' },
    { path: '/conversaciones/no/foto' },
    { path: '/conversaciones/7/adjuntos/no/vista' },
  ]) {
    const response = await send(entry.path, entry);
    assert.equal(response.status, 400, `${entry.method || 'GET'} ${entry.path}`);
    assert.doesNotMatch(response.body.message, /bigint|SQL|syntax|stack/i);
  }
});
