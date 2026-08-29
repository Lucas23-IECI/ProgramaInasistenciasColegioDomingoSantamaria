const express = require('express');

const PRIORITIES = new Set(['NORMAL', 'IMPORTANTE', 'URGENTE']);
const id = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const uniqueIds = (values) => [...new Set((Array.isArray(values) ? values : []).map(id).filter(Boolean))];
const clean = (value, max = 300) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const narrative = (value, max = 1000) => String(value || '').trim().slice(0, max);

const safeInternalLink = (value) => {
  const link = clean(value, 300);
  if (!link.startsWith('/') || link.startsWith('//') || link.includes('\\') || /[\u0000-\u001f\u007f]/u.test(link)) {
    return null;
  }
  try {
    const base = 'https://asistencia.ldsm.test';
    const parsed = new URL(link, base);
    return parsed.origin === base ? `${parsed.pathname}${parsed.search}${parsed.hash}` : null;
  } catch {
    return null;
  }
};

const publicError = (error, fallback) => {
  const candidate = Number(error?.statusCode);
  const clientStatus = Number.isInteger(candidate) && candidate >= 400 && candidate < 500 ? candidate : null;
  const status = clientStatus || 500;
  if (status >= 500) console.error('[notificaciones institucionales]', error.message);
  return { status, message: clientStatus ? error.message : fallback };
};

const safeError = (res, error, fallback, extra = {}) => {
  const result = publicError(error, fallback);
  res.status(result.status).json({ message: result.message, ...extra });
};

const reconcileStaleShipments = (pool, senderId) => pool.query(`
  UPDATE notificaciones_envios
  SET estado = 'FALLIDO',
      error_publico = COALESCE(error_publico,
        'El proceso se interrumpió antes de confirmar la entrega. Puedes reintentarlo de forma segura.'),
      actualizado_en = CURRENT_TIMESTAMP
  WHERE enviado_por = $1 AND estado = 'PENDIENTE'
    AND creado_en < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
`, [senderId]);

const createNotificationsRouter = ({
  pool,
  verifyToken,
  verifyPermission,
  insertarAudit,
  getClientIp,
  realtimeHub
}) => {
  const router = express.Router();
  router.use(verifyToken);
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

  router.get('/', async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
    const limit = Math.min(50, Math.max(5, Number.parseInt(req.query.limite, 10) || 20));
    const offset = (page - 1) * limit;
    try {
      const [items, total] = await Promise.all([
        pool.query(`
          SELECT n.id_notificacion, n.modulo, n.tipo, n.titulo, n.detalle, n.enlace,
                 n.prioridad, n.leida_en, n.creada_en, n.enviado_por,
                 COALESCE(NULLIF(emisor.nombre, ''), emisor.correo) AS emisor_nombre,
                 COALESCE(NULLIF(emisor.cargo, ''), perfil.nombre) AS emisor_cargo
          FROM notificaciones_internas n
          LEFT JOIN usuarios emisor ON emisor.id = n.enviado_por
          LEFT JOIN perfiles_acceso perfil ON perfil.codigo = emisor.rol
          WHERE n.usuario_id = $1
          ORDER BY n.creada_en DESC, n.id_notificacion DESC
          LIMIT $2 OFFSET $3
        `, [req.user.id, limit, offset]),
        pool.query(`
          SELECT COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE leida_en IS NULL)::int AS no_leidas
          FROM notificaciones_internas WHERE usuario_id = $1
        `, [req.user.id])
      ]);
      const count = total.rows[0]?.total || 0;
      res.json({
        items: items.rows,
        pagination: {
          page,
          limit,
          total: count,
          pages: Math.max(1, Math.ceil(count / limit))
        },
        unread: total.rows[0]?.no_leidas || 0
      });
    } catch (error) {
      safeError(res, error, 'No fue posible cargar tus notificaciones.');
    }
  });

  router.get('/directorio', verifyPermission('notifications.send'), async (req, res) => {
    const query = clean(req.query.q, 100);
    try {
      const result = await pool.query(`
        SELECT u.id, COALESCE(NULLIF(u.nombre, ''), u.correo) AS nombre,
               u.correo, COALESCE(NULLIF(u.cargo, ''), p.nombre, 'Personal') AS cargo,
               p.nombre AS perfil_nombre
        FROM usuarios u
        LEFT JOIN perfiles_acceso p ON p.codigo = u.rol
        WHERE u.activo = true AND u.eliminado_en IS NULL AND u.id <> $1
          AND ($2 = '' OR COALESCE(u.nombre, '') ILIKE '%' || $2 || '%'
            OR u.correo ILIKE '%' || $2 || '%'
            OR COALESCE(u.cargo, '') ILIKE '%' || $2 || '%'
            OR COALESCE(p.nombre, '') ILIKE '%' || $2 || '%')
        ORDER BY lower(COALESCE(NULLIF(u.nombre, ''), u.correo))
        LIMIT 100
      `, [req.user.id, query]);
      res.json(result.rows);
    } catch (error) {
      safeError(res, error, 'No fue posible cargar el directorio de destinatarios.');
    }
  });

  router.get('/enviadas', verifyPermission('notifications.send'), async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.pagina, 10) || 1);
    const limit = Math.min(50, Math.max(5, Number.parseInt(req.query.limite, 10) || 20));
    const offset = (page - 1) * limit;
    try {
      await reconcileStaleShipments(pool, req.user.id);
      const [items, total, summary] = await Promise.all([
        pool.query(`
          SELECT e.id_envio, e.titulo, e.detalle, e.prioridad, e.enlace,
                 e.destinatarios_total, e.estado, e.error_publico, e.reintento_de,
                 e.reintento_numero, e.creado_en, e.actualizado_en,
                 COUNT(n.id_notificacion)::int AS entregadas,
                 COUNT(n.id_notificacion) FILTER (WHERE n.leida_en IS NOT NULL)::int AS leidas
          FROM notificaciones_envios e
          LEFT JOIN notificaciones_internas n ON n.envio_id = e.id_envio
          WHERE e.enviado_por = $1
          GROUP BY e.id_envio
          ORDER BY e.creado_en DESC, e.id_envio DESC
          LIMIT $2 OFFSET $3
        `, [req.user.id, limit, offset]),
        pool.query('SELECT COUNT(*)::int AS total FROM notificaciones_envios WHERE enviado_por = $1', [req.user.id]),
        pool.query(`
          WITH envios AS (
            SELECT e.id_envio, e.estado, e.destinatarios_total,
                   COUNT(n.id_notificacion)::int AS entregadas,
                   COUNT(n.id_notificacion) FILTER (WHERE n.leida_en IS NOT NULL)::int AS leidas
            FROM notificaciones_envios e
            LEFT JOIN notificaciones_internas n ON n.envio_id = e.id_envio
            WHERE e.enviado_por = $1
            GROUP BY e.id_envio
          )
          SELECT COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE estado = 'ENVIADO')::int AS enviados,
                 COUNT(*) FILTER (WHERE estado = 'FALLIDO')::int AS fallidos,
                 COALESCE(SUM(destinatarios_total), 0)::int AS destinatarios,
                 COALESCE(SUM(entregadas), 0)::int AS entregadas,
                 COALESCE(SUM(leidas), 0)::int AS leidas
          FROM envios
        `, [req.user.id])
      ]);
      const count = total.rows[0]?.total || 0;
      res.json({
        items: items.rows,
        pagination: { page, limit, total: count, pages: Math.max(1, Math.ceil(count / limit)) },
        summary: summary.rows[0] || { total: 0, enviados: 0, fallidos: 0, destinatarios: 0, entregadas: 0, leidas: 0 }
      });
    } catch (error) {
      safeError(res, error, 'No fue posible cargar las notificaciones enviadas.');
    }
  });

  router.get('/enviadas/:shipmentId', verifyPermission('notifications.send'), async (req, res) => {
    const shipmentId = id(req.params.shipmentId);
    if (!shipmentId) return res.status(400).json({ message: 'El envío seleccionado no es válido.' });
    try {
      const [shipment, recipients] = await Promise.all([
        pool.query(`
          SELECT id_envio, titulo, detalle, prioridad, enlace, destinatarios_total,
                 estado, error_publico, reintento_de, reintento_numero, creado_en, actualizado_en
          FROM notificaciones_envios
          WHERE id_envio = $1 AND enviado_por = $2
        `, [shipmentId, req.user.id]),
        pool.query(`
          SELECT n.id_notificacion, n.usuario_id,
                 COALESCE(NULLIF(u.nombre, ''), u.correo, 'Cuenta no disponible') AS destinatario_nombre,
                 COALESCE(NULLIF(u.cargo, ''), p.nombre, 'Personal') AS destinatario_cargo,
                 n.creada_en AS entregada_en, n.leida_en,
                 CASE WHEN n.leida_en IS NULL THEN 'ENTREGADA' ELSE 'LEIDA' END AS estado
          FROM notificaciones_internas n
          LEFT JOIN usuarios u ON u.id = n.usuario_id
          LEFT JOIN perfiles_acceso p ON p.codigo = u.rol
          WHERE n.envio_id = $1
          ORDER BY lower(COALESCE(NULLIF(u.nombre, ''), u.correo, '')), n.usuario_id
        `, [shipmentId])
      ]);
      if (!shipment.rowCount) return res.status(404).json({ message: 'El envío no existe o no pertenece a tu historial.' });
      res.json({ ...shipment.rows[0], recipients: recipients.rows });
    } catch (error) {
      safeError(res, error, 'No fue posible cargar el detalle del envío.');
    }
  });

  const deliverShipment = async (req, res, payload, { retryOf = null, retryNumber = 0 } = {}) => {
    const title = clean(payload.titulo, 180);
    const detail = narrative(payload.detalle, 1000);
    const priority = String(payload.prioridad || 'NORMAL').toUpperCase();
    const recipients = uniqueIds(payload.destinatarios).filter((userId) => userId !== req.user.id);
    const link = safeInternalLink(payload.enlace);

    if (title.length < 4) return res.status(400).json({ message: 'Escribe un título de al menos 4 caracteres.' });
    if (detail.length < 5) return res.status(400).json({ message: 'Escribe el contenido del aviso con al menos 5 caracteres.' });
    if (!PRIORITIES.has(priority)) return res.status(400).json({ message: 'Selecciona una prioridad válida.' });
    if (recipients.length === 0) return res.status(400).json({ message: 'Selecciona al menos una persona destinataria.' });
    if (recipients.length > 100) return res.status(400).json({ message: 'Puedes enviar un aviso a un máximo de 100 personas a la vez.' });

    let shipment = null;
    let client = null;
    try {
      shipment = await pool.query(`
        INSERT INTO notificaciones_envios (
          enviado_por, titulo, detalle, prioridad, enlace, destinatarios_total,
          destinatarios_ids, estado, reintento_de, reintento_numero
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'PENDIENTE', $8, $9)
        RETURNING id_envio, creado_en
      `, [req.user.id, title, detail, priority, link, recipients.length,
        JSON.stringify(recipients), retryOf, retryNumber]);

      client = await pool.connect();
      await client.query('BEGIN');
      const activeRecipients = await client.query(`
        SELECT id FROM usuarios
        WHERE id = ANY($1::int[]) AND activo = true AND eliminado_en IS NULL
        FOR SHARE
      `, [recipients]);
      if (activeRecipients.rowCount !== recipients.length) {
        const error = new Error('Una o más personas seleccionadas ya no tienen una cuenta activa. Actualiza el directorio antes de reintentar.');
        error.statusCode = 409;
        throw error;
      }

      const notifications = await client.query(`
        INSERT INTO notificaciones_internas
          (usuario_id, modulo, tipo, titulo, detalle, enlace, envio_id, enviado_por, prioridad)
        SELECT destinatario, 'INSTITUCIONAL', 'AVISO_DIRIGIDO', $2, $3, $4, $5, $6, $7
        FROM unnest($1::int[]) AS destinatario
        RETURNING id_notificacion, usuario_id, creada_en
      `, [recipients, title, detail, link, shipment.rows[0].id_envio, req.user.id, priority]);

      await client.query(`
        UPDATE notificaciones_envios
        SET estado = 'ENVIADO', error_publico = NULL, actualizado_en = CURRENT_TIMESTAMP
        WHERE id_envio = $1
      `, [shipment.rows[0].id_envio]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: retryOf ? 'REINTENTAR_NOTIFICACION_INSTITUCIONAL' : 'ENVIAR_NOTIFICACION_INSTITUCIONAL',
        entidad: 'notificacion_envio',
        entidad_id: shipment.rows[0].id_envio,
        detalle: { prioridad: priority, destinatarios_total: recipients.length, reintento_de: retryOf },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');

      for (const notification of notifications.rows) {
        realtimeHub?.publishToUsers([notification.usuario_id], 'institutional-notification', {
          notification_id: notification.id_notificacion,
          title,
          detail,
          priority,
          link,
          sender: req.user.nombre || req.user.correo || 'Equipo institucional',
          created_at: notification.creada_en,
          notify: true
        });
      }

      return res.status(201).json({
        id_envio: shipment.rows[0].id_envio,
        estado: 'ENVIADO',
        destinatarios_total: recipients.length,
        creada_en: shipment.rows[0].creado_en
      });
    } catch (error) {
      await client?.query('ROLLBACK').catch(() => {});
      const visible = retryOf && error?.code === '23505'
        ? { status: 409, message: 'Este intento ya tiene un reintento registrado. Actualiza el historial para revisar su estado.' }
        : publicError(error, 'No fue posible entregar la notificación. Puedes revisar el intento y reintentarlo desde el historial.');
      if (shipment?.rows?.[0]?.id_envio) {
        await pool.query(`
          UPDATE notificaciones_envios
          SET estado = 'FALLIDO', error_publico = $2, actualizado_en = CURRENT_TIMESTAMP
          WHERE id_envio = $1 AND estado = 'PENDIENTE'
        `, [shipment.rows[0].id_envio, visible.message]).catch(() => {});
      }
      return res.status(visible.status).json({
        message: visible.message,
        envio_id: shipment?.rows?.[0]?.id_envio || null
      });
    } finally {
      client?.release();
    }
  };

  router.post('/envios', verifyPermission('notifications.send'), async (req, res) => (
    deliverShipment(req, res, req.body)
  ));

  router.post('/envios/:shipmentId/reintentar', verifyPermission('notifications.send'), async (req, res) => {
    const shipmentId = id(req.params.shipmentId);
    if (!shipmentId) return res.status(400).json({ message: 'El envío seleccionado no es válido.' });
    try {
      const previous = await pool.query(`
        SELECT id_envio, titulo, detalle, prioridad, enlace, destinatarios_ids, reintento_numero
        FROM notificaciones_envios
        WHERE id_envio = $1 AND enviado_por = $2 AND estado = 'FALLIDO'
      `, [shipmentId, req.user.id]);
      if (!previous.rowCount) return res.status(409).json({ message: 'El envío no está disponible para reintento. Actualiza el historial para revisar su estado.' });
      const item = previous.rows[0];
      return deliverShipment(req, res, {
        titulo: item.titulo,
        detalle: item.detalle,
        prioridad: item.prioridad,
        enlace: item.enlace,
        destinatarios: item.destinatarios_ids
      }, { retryOf: item.id_envio, retryNumber: Number(item.reintento_numero) + 1 });
    } catch (error) {
      return safeError(res, error, 'No fue posible preparar el reintento de la notificación.');
    }
  });

  router.patch('/:notificationId/leer', async (req, res) => {
    const notificationId = id(req.params.notificationId);
    if (!notificationId) {
      return res.status(400).json({ message: 'La notificación seleccionada no es válida. Recarga la bandeja e inténtalo nuevamente.' });
    }
    try {
      const result = await pool.query(`
        UPDATE notificaciones_internas
        SET leida_en = COALESCE(leida_en, CURRENT_TIMESTAMP)
        WHERE id_notificacion = $1 AND usuario_id = $2
        RETURNING id_notificacion, leida_en
      `, [notificationId, req.user.id]);
      if (!result.rowCount) return res.status(404).json({ message: 'La notificación no existe o ya no está disponible.' });
      res.json(result.rows[0]);
    } catch (error) {
      safeError(res, error, 'No fue posible marcar la notificación como leída.');
    }
  });

  router.post('/leer-todas', async (req, res) => {
    try {
      const result = await pool.query(`
        UPDATE notificaciones_internas SET leida_en = CURRENT_TIMESTAMP
        WHERE usuario_id = $1 AND leida_en IS NULL
      `, [req.user.id]);
      res.json({ actualizadas: result.rowCount });
    } catch (error) {
      safeError(res, error, 'No fue posible marcar las notificaciones como leídas.');
    }
  });

  return router;
};

module.exports = { createNotificationsRouter, safeInternalLink, reconcileStaleShipments };
