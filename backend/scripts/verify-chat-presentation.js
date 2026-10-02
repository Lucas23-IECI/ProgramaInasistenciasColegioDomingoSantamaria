/* Real HTTP/PostgreSQL regression. Refuses every database except the isolated
   local QA copy. Synthetic accounts are deactivated, not deleted, afterwards. */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const sharp = require('sharp');
const pool = require('../db');

const database = 'ldsm_codex_manual_019ffb95';
const accounts = [];
const conversationIds = [];
let checks = 0;
const checked = (label) => { checks += 1; console.log(`PASS ${label}`); };
async function run() {
  assert.equal(process.env.DB_NAME, database);
  assert.equal(process.env.POSTGRES_DB, database);
  assert.equal(process.env.CHAT_QA_MUTATIONS, '1');
  const actual = await pool.query('SELECT current_database() AS name');
  assert.equal(actual.rows[0].name, database);
  const migration = await pool.query("SELECT 1 FROM schema_migrations WHERE nombre='054_chat_presentacion.sql'");
  assert.equal(migration.rowCount, 1);
  checked('guardas QA y migración 054 aplicada');

  const password = crypto.randomBytes(28).toString('base64url');
  const hash = await bcrypt.hash(password, 10);
  const nonce = crypto.randomUUID();
  for (const label of ['propietario', 'administrador', 'integrante', 'externo']) {
    const correo = `qa-chat-${label}-${nonce}@example.test`;
    const result = await pool.query(`INSERT INTO usuarios (correo,password_hash,rol,nombre,cargo,debe_cambiar_password)
      VALUES ($1,$2,'admin',$3,'QA aislado',false) RETURNING id`, [correo, hash, `[QA CHAT] ${label}`]);
    accounts.push({ id: result.rows[0].id, correo });
  }
  const request = async (actor, path, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:5000/api${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(actor?.cookie ? { Cookie: actor.cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, bytes,
      body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes.toString()) : null };
  };
  const ok = async (actor, path, method, body, expected = 200) => {
    const response = await request(actor, path, method, body);
    assert.equal(response.status, expected, `${method || 'GET'} ${path}: ${response.body?.message || response.status}`);
    return response;
  };
  for (const actor of accounts) {
    const login = await ok(null, '/auth/login', 'POST', { correo: actor.correo, password });
    actor.cookie = login.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
    assert.ok(actor.cookie);
    assert.ok(login.body.user.permissions.includes('chat.access'));
  }
  checked('cuatro sesiones HTTP reales independientes');
  const [owner, moderator, member, outsider] = accounts;
  const group = (await ok(owner, '/chat/conversaciones', 'POST', {
    tipo: 'GRUPO', nombre: `[QA PRESENTACION ${nonce}]`, miembros: [moderator.id, member.id],
  }, 201)).body;
  conversationIds.push(group.id_conversacion);
  const base = `/chat/conversaciones/${group.id_conversacion}`;
  const settings = { nombre: `[QA PRESENTACION ${nonce}] actualizado`, descripcion: 'Grupo ficticio para pruebas reales', solo_administradores: true };
  const png = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#6299bb' } }).png().toBuffer();
  const photo = `data:image/png;base64,${png.toString('base64')}`;
  const edited = await ok(owner, `${base}/grupo`, 'PATCH', { ...settings, foto_data: photo });
  assert.ok(edited.body.foto_version);
  assert.equal(edited.body.foto_data, undefined);
  const detail = (await ok(member, base)).body;
  assert.equal(detail.nombre, settings.nombre);
  assert.equal(detail.solo_administradores, true);
  assert.equal(detail.foto_data, undefined);
  checked('grupo editado y persistente sin filtrar bytes en metadatos');
  const avatar = await ok(member, `${base}/foto`);
  assert.match(avatar.headers.get('cache-control'), /no-store/);
  assert.equal((await sharp(avatar.bytes).metadata()).width, 256);
  await ok(outsider, `${base}/foto`, undefined, undefined, 404);
  await ok(null, `${base}/foto`, undefined, undefined, 401);
  checked('foto normalizada y protegida por sesión y membresía');
  await ok(member, `${base}/grupo`, 'PATCH', settings, 403);
  await ok(member, `${base}/miembros/${moderator.id}/rol`, 'PATCH', { rol: 'PROPIETARIO' }, 403);
  checked('integrante no edita grupo ni roles');
  await ok(member, `${base}/mensajes`, 'POST', { contenido: 'No debe guardarse' }, 403);
  await ok(member, `${base}/adjuntos`, 'POST', { file_name: 'bloqueado.png', file_data: photo }, 403);
  checked('solo administradores bloquea texto y archivos desde API');
  const message = (await ok(owner, `${base}/mensajes`, 'POST', { contenido: 'Prueba de envío autorizado' }, 201)).body;
  await ok(member, `${base}/mensajes/${message.id_mensaje}/adjuntos`, 'POST', { file_name: 'bloqueado.png', file_data: photo }, 403);
  checked('también bloquea la ruta alternativa de adjuntos');
  await ok(owner, `${base}/miembros/${moderator.id}/rol`, 'PATCH', { rol: 'MODERADOR' });
  await ok(moderator, `${base}/mensajes`, 'POST', { contenido: 'Administrador autorizado' }, 201);
  await ok(moderator, `${base}/miembros/${member.id}/rol`, 'PATCH', { rol: 'PROPIETARIO' }, 403);
  await ok(moderator, `${base}/miembros/${owner.id}`, 'DELETE', undefined, 403);
  checked('administrador escribe sin poder cambiar roles ni retirar propietario');
  await ok(owner, `${base}/miembros/${owner.id}/rol`, 'PATCH', { rol: 'MIEMBRO' }, 409);
  await ok(owner, `${base}/miembros/${owner.id}`, 'DELETE', undefined, 409);
  checked('último propietario no se retira ni degrada');
  await ok(owner, `${base}/miembros/${member.id}/rol`, 'PATCH', { rol: 'PROPIETARIO' });
  const race = await Promise.all([
    request(owner, `${base}/miembros/${owner.id}/rol`, 'PATCH', { rol: 'MIEMBRO' }),
    request(member, `${base}/miembros/${member.id}/rol`, 'PATCH', { rol: 'MIEMBRO' }),
  ]);
  assert.deepEqual(race.map((result) => result.status).sort(), [200, 409]);
  const remaining = await pool.query("SELECT usuario_id FROM chat_miembros WHERE id_conversacion=$1 AND activo AND rol='PROPIETARIO'", [group.id_conversacion]);
  assert.equal(remaining.rowCount, 1);
  const currentOwner = accounts.find((actor) => actor.id === remaining.rows[0].usuario_id);
  const formerOwner = currentOwner.id === owner.id ? member : owner;
  checked('concurrencia PostgreSQL real conserva exactamente un propietario');
  await ok(currentOwner, `${base}/miembros/${formerOwner.id}`, 'DELETE');
  await ok(formerOwner, base, undefined, undefined, 404);
  await ok(formerOwner, `${base}/foto`, undefined, undefined, 404);
  await ok(moderator, `${base}/miembros`, 'POST', { miembros: [formerOwner.id] });
  const rejoined = (await ok(formerOwner, base)).body;
  assert.equal(rejoined.miembro_rol, 'MIEMBRO');
  checked('retirado pierde acceso; reincorporación no restaura privilegios antiguos');

  const attachment = (await ok(currentOwner, `${base}/adjuntos`, 'POST', { file_name: 'foto-qa.png', file_data: photo }, 201)).body.adjunto;
  const preview = await ok(formerOwner, `${base}/adjuntos/${attachment.id_adjunto}/vista`);
  assert.deepEqual(preview.bytes, png);
  assert.equal(preview.headers.get('x-content-type-options'), 'nosniff');
  assert.match(preview.headers.get('cache-control'), /no-store/);
  await ok(outsider, `${base}/adjuntos/${attachment.id_adjunto}/vista`, undefined, undefined, 404);
  checked('vista previa de archivo real en disco y bloqueo fuera del grupo');
  const fileMessage = await pool.query('SELECT id_mensaje FROM chat_adjuntos WHERE id_adjunto=$1', [attachment.id_adjunto]);
  await ok(currentOwner, `${base}/mensajes/${fileMessage.rows[0].id_mensaje}`, 'DELETE', { motivo: 'Retiro ficticio para verificar privacidad' });
  await ok(formerOwner, `${base}/adjuntos/${attachment.id_adjunto}/vista`, undefined, undefined, 404);
  checked('mensaje eliminado deja de servir su imagen');
  const beforeInvalid = (await ok(currentOwner, base)).body.foto_version;
  await ok(currentOwner, `${base}/grupo`, 'PATCH', { ...settings, foto_data: 'data:image/png;base64,bm90LWFuLWltYWdl' }, 400);
  assert.equal((await ok(currentOwner, base)).body.foto_version, beforeInvalid);
  checked('imagen inválida revierte cambios sin perder foto anterior');
  await ok(currentOwner, `${base}/grupo`, 'PATCH', { ...settings, foto_data: null, solo_administradores: false });
  await ok(currentOwner, `${base}/foto`, undefined, undefined, 404);
  await ok(formerOwner, `${base}/mensajes`, 'POST', { contenido: 'Escritura rehabilitada' }, 201);
  checked('quitar foto y habilitar escritura normal');

  const personal = await ok(owner, '/chat/apariencia', 'PATCH', { fondo: 'personalizado', tamano_texto: 'grande', fondo_data: photo, usuario_id: outsider.id });
  assert.match(personal.body.fondo_data, /^data:image\/jpeg;base64,/);
  assert.deepEqual((await ok(owner, '/chat/apariencia')).body, personal.body);
  assert.equal((await ok(outsider, '/chat/apariencia')).body.fondo, 'institucional');
  checked('apariencia persistente exclusiva de cuenta autenticada');
  await ok(owner, '/chat/apariencia', 'PATCH', { fondo: 'personalizado', tamano_texto: 'normal', fondo_data: 'https://example.test/foto.png' }, 400);
  assert.equal((await ok(owner, '/chat/apariencia')).body.fondo, 'personalizado');
  await ok(owner, '/chat/apariencia', 'PATCH', { fondo: 'institucional', tamano_texto: 'normal' });
  assert.equal((await ok(owner, '/chat/apariencia')).body.fondo_data, null);
  checked('fondo remoto rechazado y restablecer elimina imagen guardada');

  const managed = await pool.query("INSERT INTO chat_conversaciones (tipo,nombre,creada_por,codigo_institucional) VALUES ('CANAL',$1,$2,$3) RETURNING id_conversacion", [`[QA MANAGED ${nonce}]`, owner.id, `QA_${nonce}`]);
  conversationIds.push(managed.rows[0].id_conversacion);
  await pool.query("INSERT INTO chat_miembros (id_conversacion,usuario_id,rol) VALUES ($1,$2,'PROPIETARIO')", [managed.rows[0].id_conversacion, owner.id]);
  const managedBase = `/chat/conversaciones/${managed.rows[0].id_conversacion}`;
  for (const [suffix, method, payload] of [
    ['/grupo', 'PATCH', settings], [`/miembros/${owner.id}/rol`, 'PATCH', { rol: 'MIEMBRO' }],
    [`/miembros/${owner.id}`, 'DELETE', undefined], ['/miembros', 'POST', { miembros: [outsider.id] }],
    ['/configuracion', 'PATCH', { retencion_dias: 200 }],
  ]) await ok(owner, `${managedBase}${suffix}`, method, payload, 409);
  await ok(owner, `${managedBase}/preferencias`, 'PATCH', { notificaciones: 'SILENCIADAS' });
  checked('canal institucional protegido, avisos personales editables');
  const audits = await pool.query("SELECT accion FROM audit_log WHERE entidad='chat_conversacion' AND entidad_id=$1", [group.id_conversacion]);
  assert.ok(audits.rows.some((row) => row.accion === 'CONFIGURAR_GRUPO_CHAT'));
  assert.ok(audits.rows.some((row) => row.accion === 'CAMBIAR_ROL_CHAT'));
  checked('cambios de grupo y roles registrados en auditoría real');
  console.log(JSON.stringify({ verifiedChecks: checks, database, syntheticAccounts: accounts.length, syntheticConversations: conversationIds.length }));
}

run().catch((error) => { console.error(`FAIL ${error.message}`); process.exitCode = 1; }).finally(async () => {
  // Exact IDs created by this run only; no existing users or chats are changed.
  if (process.env.DB_NAME === database && process.env.CHAT_QA_MUTATIONS === '1') {
    if (conversationIds.length) await pool.query('UPDATE chat_conversaciones SET activa=false WHERE id_conversacion=ANY($1::bigint[])', [conversationIds]);
    if (accounts.length) await pool.query('UPDATE usuarios SET activo=false WHERE id=ANY($1::int[])', [accounts.map((actor) => actor.id)]);
    console.log('QA: cuentas sintéticas desactivadas y conversaciones de esta ejecución archivadas; trazabilidad conservada.');
  }
  await pool.end();
});
