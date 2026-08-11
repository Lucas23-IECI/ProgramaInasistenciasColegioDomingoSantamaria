const express = require('express');
const fs = require('fs');
const { createDocument, removeStoredFile, resolveDocumentPath } = require('../services/documentService');
const { previewChatRetention, runChatRetention } = require('../services/chatRetentionService');

const TYPES = new Set(['DIRECTA', 'GRUPO', 'CANAL', 'CONTEXTO']);
const MESSAGE_TYPES = new Set(['NORMAL', 'URGENTE']);
const NOTIFICATION_LEVELS = new Set(['TODAS', 'MENCIONES', 'SILENCIADAS']);
const clean = (value, max = 300) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const narrative = (value, max = 6000) => String(value || '').trim().slice(0, max);
const id = (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const uniqueIds = (values) => [...new Set((Array.isArray(values) ? values : []).map(id).filter(Boolean))];
const hasPermission = (req, permission) => Array.isArray(req.user?.permissions) && req.user.permissions.includes(permission);
const optionalTime = (value) => value === undefined || value === null || value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value));

const safeError = (res, error, fallback) => {
  const status = error.statusCode || (error.code === '23505' ? 409 : 500);
  if (status >= 500) console.error('[chat interno]', error.message);
  res.status(status).json({ message: status >= 500 ? fallback : error.message });
};

const requireMembership = async (queryable, conversationId, userId, { lock = false } = {}) => {
  const result = await queryable.query(`
    SELECT c.*, m.rol AS miembro_rol, m.notificaciones, m.silenciado_hasta,
           m.horario_silencio_desde, m.horario_silencio_hasta, m.ultima_lectura_en,
           m.ultimo_mensaje_leido_id
    FROM chat_conversaciones c
    JOIN chat_miembros m ON m.id_conversacion = c.id_conversacion
    WHERE c.id_conversacion = $1 AND c.activa = true
      AND m.usuario_id = $2 AND m.activo = true
    ${lock ? 'FOR UPDATE OF c, m' : ''}
  `, [conversationId, userId]);
  if (!result.rowCount) {
    const error = new Error('La conversación no existe o tu cuenta no pertenece a ella.');
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
};

const insertMembers = async (client, conversationId, members, creatorId) => {
  for (const userId of members) {
    const exists = await client.query('SELECT 1 FROM usuarios WHERE id = $1 AND activo = true AND eliminado_en IS NULL', [userId]);
    if (!exists.rowCount) {
      const error = new Error(`La cuenta ${userId} no está disponible.`);
      error.statusCode = 400;
      throw error;
    }
    await client.query(`
      INSERT INTO chat_miembros (id_conversacion, usuario_id, rol, incorporado_por)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (id_conversacion, usuario_id) DO UPDATE SET
        activo = true, retirado_en = NULL
    `, [conversationId, userId, userId === creatorId ? 'PROPIETARIO' : 'MIEMBRO', creatorId]);
  }
};

const createInternalChatRouter = ({ pool, verifyToken, verifyPermission, insertarAudit, getClientIp, realtimeHub }) => {
  const router = express.Router();
  router.use(verifyToken);
  router.use(verifyPermission('chat.access'));
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  router.get('/eventos', (req, res) => {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`event: ready\ndata: ${JSON.stringify({ connected: true })}\n\n`);
    const unsubscribe = realtimeHub?.subscribe(req.user.id, res) || (() => {});
    req.on('close', unsubscribe);
  });

  router.get('/configuracion', verifyPermission('chat.channels.manage'), async (_req, res) => {
    try {
      const [configuration, preview] = await Promise.all([
        pool.query('SELECT * FROM chat_configuracion WHERE id_configuracion = 1'),
        previewChatRetention(pool)
      ]);
      res.json({ configuration: configuration.rows[0], preview });
    } catch (error) { safeError(res, error, 'No fue posible cargar la configuración del chat.'); }
  });

  router.patch('/configuracion', verifyPermission('chat.channels.manage'), async (req, res) => {
    const days = Number(req.body.retencion_predeterminada_dias);
    if (!Number.isInteger(days) || days < 30 || days > 3650) {
      return res.status(400).json({ message: 'La retención debe estar entre 30 días y 10 años.' });
    }
    try {
      const result = await pool.query(`
        UPDATE chat_configuracion SET retencion_activa = $1,
          retencion_predeterminada_dias = $2, preservar_fijados = $3,
          actualizada_por = $4, actualizada_en = CURRENT_TIMESTAMP
        WHERE id_configuracion = 1 RETURNING *
      `, [Boolean(req.body.retencion_activa), days, Boolean(req.body.preservar_fijados), req.user.id]);
      await insertarAudit(pool, {
        usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'CONFIGURAR_RETENCION_CHAT', entidad: 'chat_configuracion', entidad_id: 1,
        detalle: result.rows[0], ip: getClientIp(req)
      });
      res.json(result.rows[0]);
    } catch (error) { safeError(res, error, 'No fue posible guardar la política de retención.'); }
  });

  router.post('/configuracion/retencion/ejecutar', verifyPermission('chat.channels.manage'), async (req, res) => {
    try {
      const result = await runChatRetention(pool, { actorId: req.user.id });
      await insertarAudit(pool, {
        usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'EJECUTAR_RETENCION_CHAT', entidad: 'chat_configuracion', entidad_id: 1,
        detalle: result, ip: getClientIp(req)
      });
      res.json(result);
    } catch (error) { safeError(res, error, 'No fue posible ejecutar la retención del chat.'); }
  });

  router.get('/directorio', async (req, res) => {
    const q = clean(req.query.q, 100);
    try {
      const result = await pool.query(`
        SELECT u.id, COALESCE(NULLIF(u.nombre, ''), u.correo) AS nombre, u.correo,
               COALESCE(NULLIF(u.cargo, ''), p.nombre, 'Personal') AS cargo,
               u.rol AS perfil_codigo, p.nombre AS perfil_nombre
        FROM usuarios u LEFT JOIN perfiles_acceso p ON p.codigo = u.rol
        WHERE u.activo = true AND u.eliminado_en IS NULL AND u.id <> $1
          AND ($2 = '' OR COALESCE(u.nombre, '') ILIKE '%' || $2 || '%' OR u.correo ILIKE '%' || $2 || '%'
               OR COALESCE(u.cargo, '') ILIKE '%' || $2 || '%' OR COALESCE(p.nombre, '') ILIKE '%' || $2 || '%')
        ORDER BY lower(COALESCE(NULLIF(u.nombre, ''), u.correo)) LIMIT 60
      `, [req.user.id, q]);
      res.json(result.rows);
    } catch (error) { safeError(res, error, 'No fue posible cargar el directorio del chat.'); }
  });

  router.get('/resumen', async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT COUNT(DISTINCT m.id_conversacion)::int AS conversaciones,
               COUNT(msg.id_mensaje) FILTER (
                 WHERE msg.enviado_por <> $1 AND msg.eliminado_en IS NULL
                   AND (m.ultima_lectura_en IS NULL OR msg.enviado_en > m.ultima_lectura_en)
               )::int AS no_leidos,
               COUNT(msg.id_mensaje) FILTER (
                 WHERE msg.enviado_por <> $1 AND msg.tipo = 'URGENTE' AND msg.eliminado_en IS NULL
                   AND (m.ultima_lectura_en IS NULL OR msg.enviado_en > m.ultima_lectura_en)
               )::int AS urgentes
        FROM chat_miembros m
        JOIN chat_conversaciones c ON c.id_conversacion = m.id_conversacion AND c.activa = true
        LEFT JOIN chat_mensajes msg ON msg.id_conversacion = m.id_conversacion
        WHERE m.usuario_id = $1 AND m.activo = true
      `, [req.user.id]);
      res.json(result.rows[0]);
    } catch (error) { safeError(res, error, 'No fue posible cargar el estado del chat.'); }
  });

  router.get('/conversaciones', async (req, res) => {
    const q = clean(req.query.q, 100);
    try {
      const result = await pool.query(`
        SELECT c.id_conversacion, c.tipo, c.nombre, c.descripcion, c.contexto_tipo, c.contexto_id,
               c.actualizada_en, m.rol AS miembro_rol, m.notificaciones, m.silenciado_hasta,
               CASE WHEN c.tipo = 'DIRECTA' THEN (
                 SELECT COALESCE(NULLIF(u2.nombre, ''), u2.correo)
                 FROM chat_miembros m2 JOIN usuarios u2 ON u2.id = m2.usuario_id
                 WHERE m2.id_conversacion = c.id_conversacion AND m2.usuario_id <> $1 AND m2.activo = true
                 LIMIT 1
               ) ELSE c.nombre END AS titulo,
               last_message.id_mensaje AS ultimo_mensaje_id,
               last_message.contenido AS ultimo_mensaje,
               last_message.tipo AS ultimo_mensaje_tipo,
               last_message.enviado_en AS ultimo_mensaje_en,
               sender.nombre AS ultimo_emisor,
               COUNT(unread.id_mensaje)::int AS no_leidos
        FROM chat_miembros m
        JOIN chat_conversaciones c ON c.id_conversacion = m.id_conversacion AND c.activa = true
        LEFT JOIN LATERAL (
          SELECT msg.* FROM chat_mensajes msg
          WHERE msg.id_conversacion = c.id_conversacion
          ORDER BY msg.enviado_en DESC, msg.id_mensaje DESC LIMIT 1
        ) last_message ON true
        LEFT JOIN usuarios sender ON sender.id = last_message.enviado_por
        LEFT JOIN chat_mensajes unread ON unread.id_conversacion = c.id_conversacion
          AND unread.enviado_por <> $1 AND unread.eliminado_en IS NULL
          AND (m.ultima_lectura_en IS NULL OR unread.enviado_en > m.ultima_lectura_en)
        WHERE m.usuario_id = $1 AND m.activo = true
          AND ($2 = '' OR COALESCE(c.nombre, '') ILIKE '%' || $2 || '%'
            OR EXISTS (SELECT 1 FROM chat_miembros mx JOIN usuarios ux ON ux.id=mx.usuario_id
                       WHERE mx.id_conversacion=c.id_conversacion AND mx.activo=true
                         AND (COALESCE(ux.nombre,'') ILIKE '%'||$2||'%' OR ux.correo ILIKE '%'||$2||'%')))
        GROUP BY c.id_conversacion, m.rol, m.notificaciones, m.silenciado_hasta,
                 last_message.id_mensaje,last_message.contenido,last_message.tipo,last_message.enviado_en,sender.nombre
        ORDER BY COALESCE(last_message.enviado_en, c.actualizada_en) DESC
      `, [req.user.id, q]);
      res.json(result.rows);
    } catch (error) { safeError(res, error, 'No fue posible cargar las conversaciones.'); }
  });

  router.post('/conversaciones/directa', verifyPermission('chat.direct.create'), async (req, res) => {
    const otherId = id(req.body.usuario_id);
    if (!otherId || otherId === req.user.id) return res.status(400).json({ message: 'Selecciona otra cuenta institucional.' });
    const memberIds = [req.user.id, otherId].sort((a, b) => a - b);
    const key = `directa:${memberIds.join(':')}`;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query('SELECT id_conversacion FROM chat_conversaciones WHERE clave_dedupe = $1 AND activa = true', [key]);
      let conversationId = existing.rows[0]?.id_conversacion;
      if (!conversationId) {
        const created = await client.query(`INSERT INTO chat_conversaciones (tipo,clave_dedupe,creada_por) VALUES ('DIRECTA',$1,$2) RETURNING id_conversacion`, [key, req.user.id]);
        conversationId = created.rows[0].id_conversacion;
      }
      await insertMembers(client, conversationId, memberIds, req.user.id);
      await client.query('COMMIT'); res.status(existing.rowCount ? 200 : 201).json({ id_conversacion: conversationId });
    } catch (error) { await client.query('ROLLBACK'); safeError(res, error, 'No fue posible iniciar la conversación.'); } finally { client.release(); }
  });

  router.post('/conversaciones', async (req, res) => {
    const type = String(req.body.tipo || 'GRUPO').toUpperCase();
    if (!TYPES.has(type) || type === 'DIRECTA') return res.status(400).json({ message: 'Tipo de conversación no válido.' });
    if (type === 'CANAL' && !hasPermission(req, 'chat.channels.manage')) return res.status(403).json({ message: 'No tienes permiso para administrar canales.' });
    if (type !== 'CANAL' && !hasPermission(req, 'chat.group.create')) return res.status(403).json({ message: 'No tienes permiso para crear grupos.' });
    const name = clean(req.body.nombre, 180); const members = uniqueIds([req.user.id, ...(req.body.miembros || [])]);
    if (name.length < 3 || members.length < 2) return res.status(400).json({ message: 'Indica un nombre y al menos otra persona.' });
    const contextType = clean(req.body.contexto_tipo, 40).toUpperCase() || null;
    const contextId = clean(req.body.contexto_id, 80) || null;
    const key = type === 'CONTEXTO' && contextType && contextId ? `contexto:${contextType}:${contextId}` : null;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (key) {
        const existing = await client.query(
          'SELECT * FROM chat_conversaciones WHERE clave_dedupe = $1 AND activa = true FOR UPDATE',
          [key]
        );
        if (existing.rowCount) {
          const conversation = existing.rows[0];
          await insertMembers(client, conversation.id_conversacion, members, req.user.id);
          await client.query(
            `INSERT INTO chat_vinculos (id_conversacion,entidad_tipo,entidad_id,creado_por)
             VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [conversation.id_conversacion, contextType, contextId, req.user.id]
          );
          await client.query('COMMIT');
          return res.status(200).json(conversation);
        }
      }
      const created = await client.query(`INSERT INTO chat_conversaciones (tipo,nombre,descripcion,clave_dedupe,contexto_tipo,contexto_id,retencion_dias,creada_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [type, name, clean(req.body.descripcion, 500) || null, key, contextType, contextId, Number(req.body.retencion_dias) || null, req.user.id]);
      await insertMembers(client, created.rows[0].id_conversacion, members, req.user.id);
      if (contextType && contextId) await client.query(`INSERT INTO chat_vinculos (id_conversacion,entidad_tipo,entidad_id,creado_por) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [created.rows[0].id_conversacion, contextType, contextId, req.user.id]);
      await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo, accion: 'CREAR_CONVERSACION_CHAT', entidad: 'chat_conversacion', entidad_id: created.rows[0].id_conversacion, detalle: { tipo: type, miembros: members.length, contexto_tipo: contextType }, ip: getClientIp(req) });
      await client.query('COMMIT'); res.status(201).json(created.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); safeError(res, error, 'No fue posible crear la conversación.'); } finally { client.release(); }
  });

  router.get('/conversaciones/:conversationId', async (req, res) => {
    try {
      const conversation = await requireMembership(pool, id(req.params.conversationId), req.user.id);
      const [members, links, pinned] = await Promise.all([
        pool.query(`SELECT m.usuario_id,m.rol,m.notificaciones,m.silenciado_hasta,u.nombre,u.correo,u.cargo,p.nombre AS perfil_nombre FROM chat_miembros m JOIN usuarios u ON u.id=m.usuario_id LEFT JOIN perfiles_acceso p ON p.codigo=u.rol WHERE m.id_conversacion=$1 AND m.activo=true ORDER BY CASE m.rol WHEN 'PROPIETARIO' THEN 1 WHEN 'MODERADOR' THEN 2 ELSE 3 END,lower(COALESCE(u.nombre,u.correo))`, [conversation.id_conversacion]),
        pool.query('SELECT * FROM chat_vinculos WHERE id_conversacion=$1 ORDER BY creado_en', [conversation.id_conversacion]),
        pool.query(`SELECT f.id_mensaje,f.fijado_en,msg.contenido,msg.tipo,u.nombre AS autor FROM chat_mensajes_fijados f JOIN chat_mensajes msg ON msg.id_mensaje=f.id_mensaje JOIN usuarios u ON u.id=msg.enviado_por WHERE f.id_conversacion=$1 ORDER BY f.fijado_en DESC`, [conversation.id_conversacion])
      ]);
      res.json({ ...conversation, members: members.rows, links: links.rows, pinned: pinned.rows });
    } catch (error) { safeError(res, error, 'No fue posible cargar la conversación.'); }
  });

  router.patch('/conversaciones/:conversationId/configuracion', async (req, res) => {
    const days = req.body.retencion_dias === null || req.body.retencion_dias === '' ? null : Number(req.body.retencion_dias);
    if (days !== null && (!Number.isInteger(days) || days < 30 || days > 3650)) {
      return res.status(400).json({ message: 'La retención de la conversación debe estar entre 30 días y 10 años.' });
    }
    try {
      const conversationId = id(req.params.conversationId);
      const conversation = await requireMembership(pool, conversationId, req.user.id);
      const canManage = ['PROPIETARIO', 'MODERADOR'].includes(conversation.miembro_rol)
        && hasPermission(req, 'chat.channels.manage');
      if (!canManage) return res.status(403).json({ message: 'No puedes modificar la política de esta conversación.' });
      const result = await pool.query(`
        UPDATE chat_conversaciones SET retencion_dias = $2, actualizada_en = CURRENT_TIMESTAMP
        WHERE id_conversacion = $1 RETURNING *
      `, [conversationId, days]);
      await insertarAudit(pool, {
        usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'CONFIGURAR_CONVERSACION_CHAT', entidad: 'chat_conversacion', entidad_id: conversationId,
        detalle: { retencion_dias: days }, ip: getClientIp(req)
      });
      res.json(result.rows[0]);
    } catch (error) { safeError(res, error, 'No fue posible configurar la conversación.'); }
  });

  router.get('/conversaciones/:conversationId/mensajes', async (req, res) => {
    const limit = Math.min(100, Math.max(20, Number(req.query.limite) || 50)); const before = id(req.query.antes_de);
    try {
      const conversationId = id(req.params.conversationId); await requireMembership(pool, conversationId, req.user.id);
      const result = await pool.query(`
        SELECT msg.id_mensaje,msg.tipo,msg.contenido,msg.responde_a_id,msg.editado_en,msg.eliminado_en,
               msg.motivo_eliminacion,msg.enviado_en,msg.enviado_por,u.nombre AS autor_nombre,u.correo AS autor_correo,
               reply.contenido AS respuesta_contenido,reply_user.nombre AS respuesta_autor,
               EXISTS(SELECT 1 FROM chat_mensajes_fijados f WHERE f.id_mensaje=msg.id_mensaje) AS fijado,
               (SELECT COUNT(*)::int FROM chat_lecturas l WHERE l.id_mensaje=msg.id_mensaje) AS lecturas,
               COALESCE((SELECT json_agg(json_build_object('id_adjunto',a.id_adjunto,'id_documento',d.id_documento,'nombre',d.nombre_original,'mime_type',d.mime_type,'tamano',d.tamano_bytes)) FROM chat_adjuntos a JOIN justification_documents d ON d.id_documento=a.id_documento WHERE a.id_mensaje=msg.id_mensaje),'[]'::json) AS adjuntos
        FROM chat_mensajes msg JOIN usuarios u ON u.id=msg.enviado_por
        LEFT JOIN chat_mensajes reply ON reply.id_mensaje=msg.responde_a_id
        LEFT JOIN usuarios reply_user ON reply_user.id=reply.enviado_por
        WHERE msg.id_conversacion=$1 AND ($2::bigint IS NULL OR msg.id_mensaje < $2)
        ORDER BY msg.id_mensaje DESC LIMIT $3
      `, [conversationId, before, limit]);
      res.json(result.rows.reverse());
    } catch (error) { safeError(res, error, 'No fue posible cargar los mensajes.'); }
  });

  router.get('/buscar', async (req, res) => {
    const q = clean(req.query.q, 120); if (q.length < 2) return res.json([]);
    try {
      const result = await pool.query(`
        SELECT msg.id_mensaje,msg.id_conversacion,msg.contenido,msg.tipo,msg.enviado_en,u.nombre AS autor,c.tipo AS conversacion_tipo,c.nombre AS conversacion_nombre
        FROM chat_mensajes msg JOIN chat_conversaciones c ON c.id_conversacion=msg.id_conversacion
        JOIN chat_miembros m ON m.id_conversacion=c.id_conversacion AND m.usuario_id=$1 AND m.activo=true
        JOIN usuarios u ON u.id=msg.enviado_por
        WHERE c.activa=true AND msg.eliminado_en IS NULL AND msg.contenido ILIKE '%'||$2||'%'
        ORDER BY msg.enviado_en DESC LIMIT 100
      `, [req.user.id, q]); res.json(result.rows);
    } catch (error) { safeError(res, error, 'No fue posible buscar mensajes.'); }
  });

  router.post('/conversaciones/:conversationId/mensajes', async (req, res) => {
    const conversationId = id(req.params.conversationId); const content = narrative(req.body.contenido); const type = String(req.body.tipo || 'NORMAL').toUpperCase();
    if (content.length < 1 || !MESSAGE_TYPES.has(type)) return res.status(400).json({ message: 'Escribe un mensaje válido.' });
    if (type === 'URGENTE' && !hasPermission(req, 'chat.urgent')) return res.status(403).json({ message: 'No tienes permiso para marcar mensajes urgentes.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN'); await requireMembership(client, conversationId, req.user.id, { lock: true });
      const replyId = id(req.body.responde_a_id);
      if (replyId) { const reply = await client.query('SELECT 1 FROM chat_mensajes WHERE id_mensaje=$1 AND id_conversacion=$2', [replyId, conversationId]); if (!reply.rowCount) { const e = new Error('El mensaje respondido no pertenece a esta conversación.'); e.statusCode = 400; throw e; } }
      const created = await client.query(`INSERT INTO chat_mensajes (id_conversacion,enviado_por,tipo,contenido,responde_a_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [conversationId, req.user.id, type, content, replyId]);
      const messageId = created.rows[0].id_mensaje;
      const mentions = uniqueIds(req.body.menciones).filter((userId) => userId !== req.user.id);
      for (const userId of mentions) await client.query(`INSERT INTO chat_menciones (id_mensaje,usuario_id) SELECT $1,$2 WHERE EXISTS(SELECT 1 FROM chat_miembros WHERE id_conversacion=$3 AND usuario_id=$2 AND activo=true) ON CONFLICT DO NOTHING`, [messageId, userId, conversationId]);
      await client.query(`INSERT INTO chat_lecturas (id_mensaje,usuario_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [messageId, req.user.id]);
      await client.query(`UPDATE chat_miembros SET ultima_lectura_en=CURRENT_TIMESTAMP,ultimo_mensaje_leido_id=$2 WHERE id_conversacion=$1 AND usuario_id=$3`, [conversationId, messageId, req.user.id]);
      await client.query('UPDATE chat_conversaciones SET actualizada_en=CURRENT_TIMESTAMP WHERE id_conversacion=$1', [conversationId]);
      const recipients = await client.query(`
        SELECT m.usuario_id,
               COALESCE(NULLIF(c.nombre, ''), NULLIF(sender.nombre, ''), sender.correo, 'Conversación institucional') AS conversation_title,
               (
                 m.usuario_id <> $2
                 AND m.notificaciones <> 'SILENCIADAS'
                 AND (m.notificaciones = 'TODAS' OR m.usuario_id = ANY($3::int[]) OR $4 = 'URGENTE')
                 AND (m.silenciado_hasta IS NULL OR m.silenciado_hasta <= CURRENT_TIMESTAMP)
                 AND (
                   $4 = 'URGENTE'
                   OR m.horario_silencio_desde IS NULL OR m.horario_silencio_hasta IS NULL
                   OR CASE WHEN m.horario_silencio_desde <= m.horario_silencio_hasta
                     THEN (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago')::time NOT BETWEEN m.horario_silencio_desde AND m.horario_silencio_hasta
                     ELSE NOT ((CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago')::time >= m.horario_silencio_desde
                       OR (CURRENT_TIMESTAMP AT TIME ZONE 'America/Santiago')::time <= m.horario_silencio_hasta)
                   END
                 )
               ) AS notify
        FROM chat_miembros m
        JOIN chat_conversaciones c ON c.id_conversacion = m.id_conversacion
        JOIN usuarios sender ON sender.id = $2
        WHERE m.id_conversacion = $1 AND m.activo = true
      `, [conversationId, req.user.id, mentions, type]);
      await client.query('COMMIT');
      for (const recipient of recipients.rows) realtimeHub?.publishToUsers([recipient.usuario_id], 'chat-message', {
        conversation_id: conversationId,
        conversation_title: recipient.conversation_title,
        message_id: messageId,
        sender_id: req.user.id,
        type,
        notify: recipient.notify
      });
      res.status(201).json(created.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); safeError(res, error, 'No fue posible enviar el mensaje.'); } finally { client.release(); }
  });

  router.post('/conversaciones/:conversationId/mensajes/:messageId/adjuntos', verifyPermission('chat.attach'), async (req, res) => {
    const conversationId = id(req.params.conversationId); const messageId = id(req.params.messageId); const client = await pool.connect(); let storedName = null;
    try { await client.query('BEGIN'); await requireMembership(client, conversationId, req.user.id, { lock: true }); const message = await client.query('SELECT 1 FROM chat_mensajes WHERE id_mensaje=$1 AND id_conversacion=$2 AND enviado_por=$3 AND eliminado_en IS NULL', [messageId, conversationId, req.user.id]); if (!message.rowCount) { const e = new Error('Solo puedes adjuntar archivos a un mensaje propio vigente.'); e.statusCode = 403; throw e; } const document = await createDocument(client, { fileData: req.body.file_data, fileName: req.body.file_name, userId: req.user.id }); storedName = document.nombre_almacenado; const linked = await client.query(`INSERT INTO chat_adjuntos (id_mensaje,id_documento) VALUES ($1,$2) RETURNING *`, [messageId, document.id_documento]); await client.query('COMMIT'); res.status(201).json({ ...linked.rows[0], nombre: document.nombre_original, mime_type: document.mime_type }); } catch (error) { await client.query('ROLLBACK'); if (storedName) await removeStoredFile(storedName).catch(()=>{}); safeError(res, error, 'No fue posible adjuntar el archivo.'); } finally { client.release(); }
  });

  router.get('/conversaciones/:conversationId/adjuntos/:attachmentId', async (req, res) => {
    try { const conversationId = id(req.params.conversationId); await requireMembership(pool, conversationId, req.user.id); const result = await pool.query(`SELECT d.* FROM chat_adjuntos a JOIN chat_mensajes msg ON msg.id_mensaje=a.id_mensaje JOIN justification_documents d ON d.id_documento=a.id_documento WHERE a.id_adjunto=$1 AND msg.id_conversacion=$2 AND msg.eliminado_en IS NULL`, [id(req.params.attachmentId), conversationId]); if (!result.rowCount) return res.status(404).json({ message: 'El adjunto no existe o ya cumplió su retención.' }); const doc=result.rows[0]; const filePath=resolveDocumentPath(doc.nombre_almacenado); if (!filePath||!fs.existsSync(filePath)) return res.status(404).json({ message:'El archivo no está disponible.' }); await insertarAudit(pool,{usuario_id:req.user.id,usuario_correo:req.user.correo,accion:'DESCARGAR_ADJUNTO_CHAT',entidad:'chat_conversacion',entidad_id:conversationId,detalle:{documento_id:doc.id_documento},ip:getClientIp(req)}); res.type(doc.mime_type).download(filePath,doc.nombre_original); } catch(error){safeError(res,error,'No fue posible descargar el adjunto.');}
  });

  router.post('/conversaciones/:conversationId/leer', async (req, res) => {
    const conversationId=id(req.params.conversationId); const messageId=id(req.body.ultimo_mensaje_id); try { await requireMembership(pool,conversationId,req.user.id); const last=messageId?await pool.query('SELECT id_mensaje FROM chat_mensajes WHERE id_mensaje=$1 AND id_conversacion=$2',[messageId,conversationId]):await pool.query('SELECT id_mensaje FROM chat_mensajes WHERE id_conversacion=$1 ORDER BY id_mensaje DESC LIMIT 1',[conversationId]); const finalId=last.rows[0]?.id_mensaje||null; if(finalId){await pool.query(`INSERT INTO chat_lecturas (id_mensaje,usuario_id) SELECT id_mensaje,$2 FROM chat_mensajes WHERE id_conversacion=$1 AND id_mensaje<=$3 ON CONFLICT DO NOTHING`,[conversationId,req.user.id,finalId]);} await pool.query(`UPDATE chat_miembros SET ultima_lectura_en=CURRENT_TIMESTAMP,ultimo_mensaje_leido_id=$3 WHERE id_conversacion=$1 AND usuario_id=$2`,[conversationId,req.user.id,finalId]); res.json({ok:true,ultimo_mensaje_leido_id:finalId}); }catch(error){safeError(res,error,'No fue posible actualizar la lectura.');}
  });

  router.post('/conversaciones/:conversationId/mensajes/:messageId/fijar', async (req,res)=>{try{const conversationId=id(req.params.conversationId);const conversation=await requireMembership(pool,conversationId,req.user.id);if(!['PROPIETARIO','MODERADOR'].includes(conversation.miembro_rol)){return res.status(403).json({message:'Solo propietarios y moderadores pueden fijar mensajes.'});}const messageId=id(req.params.messageId);const exists=await pool.query('SELECT 1 FROM chat_mensajes WHERE id_mensaje=$1 AND id_conversacion=$2 AND eliminado_en IS NULL',[messageId,conversationId]);if(!exists.rowCount)return res.status(404).json({message:'El mensaje no existe.'});await pool.query(`INSERT INTO chat_mensajes_fijados (id_conversacion,id_mensaje,fijado_por) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,[conversationId,messageId,req.user.id]);res.json({ok:true});}catch(error){safeError(res,error,'No fue posible fijar el mensaje.');}});
  router.delete('/conversaciones/:conversationId/mensajes/:messageId/fijar', async (req,res)=>{try{const conversationId=id(req.params.conversationId);const conversation=await requireMembership(pool,conversationId,req.user.id);if(!['PROPIETARIO','MODERADOR'].includes(conversation.miembro_rol))return res.status(403).json({message:'Solo propietarios y moderadores pueden quitar mensajes fijados.'});await pool.query('DELETE FROM chat_mensajes_fijados WHERE id_conversacion=$1 AND id_mensaje=$2',[conversationId,id(req.params.messageId)]);res.json({ok:true});}catch(error){safeError(res,error,'No fue posible quitar el mensaje fijado.');}});

  router.delete('/conversaciones/:conversationId/mensajes/:messageId', async (req,res)=>{
    const reason=clean(req.body.motivo,300);if(reason.length<5)return res.status(400).json({message:'Indica el motivo de moderación.'});
    const client=await pool.connect();try{await client.query('BEGIN');const conversationId=id(req.params.conversationId);const conversation=await requireMembership(client,conversationId,req.user.id,{lock:true});const message=await client.query('SELECT * FROM chat_mensajes WHERE id_mensaje=$1 AND id_conversacion=$2 FOR UPDATE',[id(req.params.messageId),conversationId]);if(!message.rowCount){const e=new Error('El mensaje no existe.');e.statusCode=404;throw e;}const own=message.rows[0].enviado_por===req.user.id;const moderator=['PROPIETARIO','MODERADOR'].includes(conversation.miembro_rol)&&hasPermission(req,'chat.moderate');if(!own&&!moderator){const e=new Error('No puedes moderar este mensaje.');e.statusCode=403;throw e;}await client.query(`UPDATE chat_mensajes SET eliminado_en=CURRENT_TIMESTAMP,eliminado_por=$2,motivo_eliminacion=$3 WHERE id_mensaje=$1`,[id(req.params.messageId),req.user.id,reason]);await client.query('DELETE FROM chat_mensajes_fijados WHERE id_mensaje=$1',[id(req.params.messageId)]);await insertarAudit(client,{usuario_id:req.user.id,usuario_correo:req.user.correo,accion:'MODERAR_MENSAJE_CHAT',entidad:'chat_mensaje',entidad_id:id(req.params.messageId),detalle:{conversacion_id:conversationId,motivo:reason},ip:getClientIp(req)});await client.query('COMMIT');res.json({ok:true});}catch(error){await client.query('ROLLBACK');safeError(res,error,'No fue posible moderar el mensaje.');}finally{client.release();}
  });

  router.patch('/conversaciones/:conversationId/preferencias', async (req,res)=>{const level=String(req.body.notificaciones||'TODAS').toUpperCase();if(!NOTIFICATION_LEVELS.has(level))return res.status(400).json({message:'Preferencia de notificaciones no válida.'});if(!optionalTime(req.body.horario_silencio_desde)||!optionalTime(req.body.horario_silencio_hasta))return res.status(400).json({message:'Los horarios de silencio no son válidos.'});try{const conversationId=id(req.params.conversationId);await requireMembership(pool,conversationId,req.user.id);const result=await pool.query(`UPDATE chat_miembros SET notificaciones=$3,silenciado_hasta=$4,horario_silencio_desde=$5,horario_silencio_hasta=$6 WHERE id_conversacion=$1 AND usuario_id=$2 RETURNING notificaciones,silenciado_hasta,horario_silencio_desde,horario_silencio_hasta`,[conversationId,req.user.id,level,req.body.silenciado_hasta||null,req.body.horario_silencio_desde||null,req.body.horario_silencio_hasta||null]);res.json(result.rows[0]);}catch(error){safeError(res,error,'No fue posible guardar las preferencias.');}});

  router.post('/conversaciones/:conversationId/miembros', async (req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');const conversationId=id(req.params.conversationId);const conversation=await requireMembership(client,conversationId,req.user.id,{lock:true});if(!['PROPIETARIO','MODERADOR'].includes(conversation.miembro_rol)){const e=new Error('No puedes incorporar miembros a esta conversación.');e.statusCode=403;throw e;}if(conversation.tipo==='DIRECTA'){const e=new Error('Una conversación directa no admite más miembros.');e.statusCode=409;throw e;}const members=uniqueIds(req.body.miembros);await insertMembers(client,conversationId,members,req.user.id);await client.query('COMMIT');res.json({ok:true,agregados:members.length});}catch(error){await client.query('ROLLBACK');safeError(res,error,'No fue posible agregar miembros.');}finally{client.release();}});

  router.delete('/conversaciones/:conversationId/miembros/:userId', async (req,res)=>{const client=await pool.connect();try{await client.query('BEGIN');const conversationId=id(req.params.conversationId);const target=id(req.params.userId);const conversation=await requireMembership(client,conversationId,req.user.id,{lock:true});if(target!==req.user.id&&!['PROPIETARIO','MODERADOR'].includes(conversation.miembro_rol)){const e=new Error('No puedes retirar a esa persona.');e.statusCode=403;throw e;}if(target===conversation.creada_por&&conversation.tipo!=='DIRECTA'){const owners=await client.query(`SELECT COUNT(*)::int AS total FROM chat_miembros WHERE id_conversacion=$1 AND rol='PROPIETARIO' AND activo=true`,[conversationId]);if(owners.rows[0].total<=1){const e=new Error('Asigna otro propietario antes de abandonar la conversación.');e.statusCode=409;throw e;}}await client.query(`UPDATE chat_miembros SET activo=false,retirado_en=CURRENT_TIMESTAMP WHERE id_conversacion=$1 AND usuario_id=$2`,[conversationId,target]);await client.query('COMMIT');res.json({ok:true});}catch(error){await client.query('ROLLBACK');safeError(res,error,'No fue posible retirar a la persona.');}finally{client.release();}});

  return router;
};

module.exports = { createInternalChatRouter, requireMembership };
