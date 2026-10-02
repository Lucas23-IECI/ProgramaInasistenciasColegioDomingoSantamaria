const fs = require('fs');
const crypto = require('crypto');
const { resolveDocumentPath } = require('../services/documentService');
const { fail, MANAGERS, ROLES, BACKGROUNDS, DEFAULT_APPEARANCE, assertManualConversation, processChatImage, publicConversation } = require('../services/chatPresentationService');

module.exports = (router, { pool, requireMembership, safeError, insertarAudit, getClientIp, realtimeHub }) => {
  for (const key of ['conversationId', 'userId', 'attachmentId']) router.param(key, (_req, res, next, value) => {
    if (!Number.isSafeInteger(Number(value)) || Number(value) <= 0) return res.status(400).json({ message: 'El registro solicitado no es válido. Vuelve a abrirlo desde el chat.' });
    next();
  });
  const audit = (client, req, cid, action, detail) => insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo, accion: action, entidad: 'chat_conversacion', entidad_id: cid, detalle: detail, ip: getClientIp(req) });
  const signal = async (cid, removed) => {
    try {
      const people = await pool.query('SELECT usuario_id FROM chat_miembros WHERE id_conversacion=$1 AND activo=true', [cid]);
      realtimeHub?.publishToUsers([...people.rows.map((person) => person.usuario_id), ...(removed ? [removed] : [])], 'chat-message', { conversation_id: Number(cid), type: 'conversation_updated', notify: false });
    } catch (error) { console.error('[chat:actualizacion]', error.message); }
  };
  const transaction = (handler, fallback) => async (req, res) => {
    let client;
    try {
      client = await pool.connect(); await client.query('BEGIN');
      const result = await handler(client, req);
      await client.query('COMMIT');
      client.release();
      client = null;
      await signal(req.params.conversationId, result?.retirado);
      res.json(result);
    } catch (error) { if (client) await client.query('ROLLBACK').catch(() => {}); safeError(res, error, fallback); }
    finally { client?.release(); }
  };
  router.get('/apariencia', async (req, res) => {
    try { const result = await pool.query('SELECT fondo,tamano_texto,fondo_data FROM chat_apariencia_usuario WHERE usuario_id=$1', [req.user.id]); res.json(result.rows[0] || DEFAULT_APPEARANCE); }
    catch (error) { safeError(res, error, 'No pudimos cargar tu apariencia del chat.'); }
  });
  router.patch('/apariencia', async (req, res) => {
    try {
      const { fondo, tamano_texto } = req.body;
      if (!BACKGROUNDS.has(fondo) || !['normal', 'grande'].includes(tamano_texto)) throw fail('Elige un fondo y un tamaño de texto válidos.');
      const data = fondo === 'personalizado' ? await processChatImage(req.body.fondo_data) : null;
      const result = await pool.query(`INSERT INTO chat_apariencia_usuario (usuario_id,fondo,tamano_texto,fondo_data) VALUES ($1,$2,$3,$4)
        ON CONFLICT (usuario_id) DO UPDATE SET fondo=EXCLUDED.fondo,tamano_texto=EXCLUDED.tamano_texto,fondo_data=EXCLUDED.fondo_data,actualizada_en=CURRENT_TIMESTAMP RETURNING fondo,tamano_texto,fondo_data`, [req.user.id, fondo, tamano_texto, data]);
      res.json(result.rows[0]);
    } catch (error) { safeError(res, error, 'No pudimos guardar tu apariencia. Tus cambios todavía no se aplicaron.'); }
  });
  router.patch('/conversaciones/:conversationId/grupo', transaction(async (client, req) => {
    const cid = req.params.conversationId;
    const conversation = await requireMembership(client, cid, req.user.id, { lock: true });
    assertManualConversation(conversation);
    if (conversation.tipo === 'DIRECTA' || !MANAGERS.has(conversation.miembro_rol)) throw fail('Solo los administradores del grupo pueden cambiar estos datos.', 403);
    const nombre = String(req.body.nombre || '').trim();
    const descripcion = String(req.body.descripcion || '').trim();
    if (!nombre || nombre.length > 180 || descripcion.length > 500 || typeof req.body.solo_administradores !== 'boolean') throw fail('Indica un nombre de hasta 180 caracteres, una descripción de hasta 500 y quién puede escribir.');
    const photoChanged = Object.hasOwn(req.body, 'foto_data');
    const photo = photoChanged ? (req.body.foto_data === null ? null : await processChatImage(req.body.foto_data, true)) : conversation.foto_data;
    const version = photoChanged ? (photo ? crypto.randomUUID() : null) : conversation.foto_version;
    const result = await client.query(`UPDATE chat_conversaciones SET nombre=$2,descripcion=$3,solo_administradores=$4,foto_data=$5,foto_version=$6,actualizada_en=CURRENT_TIMESTAMP WHERE id_conversacion=$1 RETURNING *`, [cid, nombre, descripcion || null, req.body.solo_administradores, photo, version]);
    await audit(client, req, cid, 'CONFIGURAR_GRUPO_CHAT', { cambio_foto: photoChanged, solo_administradores: req.body.solo_administradores });
    return publicConversation(result.rows[0]);
  }, 'No pudimos actualizar el grupo.'));
  router.get('/conversaciones/:conversationId/foto', async (req, res) => {
    try {
      const conversation = await requireMembership(pool, req.params.conversationId, req.user.id);
      if (!conversation.foto_data) throw fail('Este grupo no tiene foto.', 404);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.type('image/jpeg').send(Buffer.from(conversation.foto_data.split(',')[1], 'base64'));
    } catch (error) { safeError(res, error, 'No pudimos cargar la foto del grupo.'); }
  });
  router.patch('/conversaciones/:conversationId/miembros/:userId/rol', transaction(async (client, req) => {
    const cid = req.params.conversationId;
    const conversation = await requireMembership(client, cid, req.user.id, { lock: true });
    assertManualConversation(conversation);
    if (conversation.tipo === 'DIRECTA' || conversation.miembro_rol !== 'PROPIETARIO') throw fail('Solo un propietario puede cambiar los roles del grupo.', 403);
    const role = req.body.rol;
    if (!ROLES.has(role)) throw fail('Selecciona un rol válido.');
    const target = await client.query('SELECT rol FROM chat_miembros WHERE id_conversacion=$1 AND usuario_id=$2 AND activo=true FOR UPDATE', [cid, req.params.userId]);
    if (!target.rowCount) throw fail('Esta persona ya no pertenece al grupo.', 404);
    if (target.rows[0].rol === 'PROPIETARIO' && role !== 'PROPIETARIO') {
      const owners = await client.query("SELECT COUNT(*)::int AS total FROM chat_miembros WHERE id_conversacion=$1 AND rol='PROPIETARIO' AND activo=true", [cid]);
      if (owners.rows[0].total <= 1) throw fail('Asigna otro propietario antes de cambiar este rol.', 409);
    }
    await client.query('UPDATE chat_miembros SET rol=$3 WHERE id_conversacion=$1 AND usuario_id=$2', [cid, req.params.userId, role]);
    await audit(client, req, cid, 'CAMBIAR_ROL_CHAT', { usuario_id: Number(req.params.userId), rol: role });
    return { ok: true };
  }, 'No pudimos cambiar el rol.'));
  // Every active owner is protected, not just the original creator.
  // The conversation lock serializes role changes.
  router.delete('/conversaciones/:conversationId/miembros/:userId', transaction(async (client, req) => {
    const cid = req.params.conversationId;
    const targetId = Number(req.params.userId);
    const conversation = await requireMembership(client, cid, req.user.id, { lock: true });
    assertManualConversation(conversation);
    if (conversation.tipo === 'DIRECTA') throw fail('No se pueden retirar integrantes de una conversación directa.', 409);
    const target = await client.query('SELECT rol FROM chat_miembros WHERE id_conversacion=$1 AND usuario_id=$2 AND activo=true FOR UPDATE', [cid, targetId]);
    if (!target.rowCount) throw fail('Esta persona ya no pertenece al grupo.', 404);
    if (targetId !== Number(req.user.id) && (!MANAGERS.has(conversation.miembro_rol) || (conversation.miembro_rol === 'MODERADOR' && target.rows[0].rol !== 'MIEMBRO'))) throw fail('No tienes permiso para retirar a esta persona.', 403);
    if (target.rows[0].rol === 'PROPIETARIO') {
      const owners = await client.query("SELECT COUNT(*)::int AS total FROM chat_miembros WHERE id_conversacion=$1 AND rol='PROPIETARIO' AND activo=true", [cid]);
      if (owners.rows[0].total <= 1) throw fail('Asigna otro propietario antes de salir o retirar a esta persona.', 409);
    }
    await client.query('UPDATE chat_miembros SET activo=false,retirado_en=CURRENT_TIMESTAMP WHERE id_conversacion=$1 AND usuario_id=$2', [cid, targetId]);
    await audit(client, req, cid, 'RETIRAR_MIEMBRO_CHAT', { usuario_id: targetId });
    return { ok: true, retirado: targetId };
  }, 'No pudimos retirar a la persona.'));
  router.get('/conversaciones/:conversationId/adjuntos/:attachmentId/vista', async (req, res) => {
    try {
      await requireMembership(pool, req.params.conversationId, req.user.id);
      const result = await pool.query(`SELECT d.* FROM chat_adjuntos a JOIN chat_mensajes msg ON msg.id_mensaje=a.id_mensaje JOIN justification_documents d ON d.id_documento=a.id_documento WHERE a.id_adjunto=$1 AND msg.id_conversacion=$2 AND msg.eliminado_en IS NULL`, [req.params.attachmentId, req.params.conversationId]);
      const doc = result.rows[0];
      if (!doc || !['image/jpeg', 'image/png'].includes(doc.mime_type)) throw fail('No hay una imagen disponible para visualizar.', 404);
      const file = resolveDocumentPath(doc.nombre_almacenado);
      if (!file || !fs.existsSync(file)) throw fail('La imagen ya no está disponible.', 404);
      res.setHeader('Content-Disposition', 'inline'); res.setHeader('X-Content-Type-Options', 'nosniff');
      res.type(doc.mime_type).sendFile(file);
    } catch (error) { safeError(res, error, 'No pudimos cargar la imagen.'); }
  });
};
