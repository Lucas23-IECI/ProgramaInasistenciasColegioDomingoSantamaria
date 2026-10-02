const express = require('express');

const EVENT_TYPES = new Set(['REUNION', 'REVISION', 'RECORDATORIO', 'OTRO']);
const RESPONSES = new Set(['ACEPTADA', 'RECHAZADA']);
const REMINDER_MINUTES = new Set([0, 10, 30, 60, 1440]);
const positiveId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const clean = (value, max = 300) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const narrative = (value, max = 1500) => String(value || '').trim().slice(0, max);
const uniqueIds = (values) => [...new Set((Array.isArray(values) ? values : []).map(positiveId).filter(Boolean))];

const parseInstant = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

const dateWindow = (query) => {
  const from = parseInstant(query.desde);
  const to = parseInstant(query.hasta);
  if (!from || !to || to <= from) return null;
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  return days <= 93 ? { from, to } : null;
};

const publicError = (res, error, fallback) => {
  const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500
    ? error.statusCode
    : 500;
  if (status >= 500) console.error('[agenda]', error.message);
  res.status(status).json({ message: status >= 500 ? fallback : error.message });
};

const eventQuery = `
  SELECT e.id_evento, e.titulo, e.detalle, e.tipo, e.estado, e.inicio, e.fin,
         e.todo_el_dia, e.ubicacion, e.alcance, e.creado_por, e.version,
         e.cancelado_en, e.motivo_cancelacion,
         COALESCE(NULLIF(creador.nombre, ''), creador.correo) AS creador_nombre,
         participante.rol AS mi_rol, participante.respuesta AS mi_respuesta,
         COALESCE((
           SELECT jsonb_agg(jsonb_build_object(
             'id', u.id,
             'nombre', COALESCE(NULLIF(u.nombre, ''), u.correo),
             'cargo', COALESCE(NULLIF(u.cargo, ''), perfil.nombre, 'Personal'),
             'rol', p.rol,
             'respuesta', p.respuesta
           ) ORDER BY CASE WHEN p.rol = 'ORGANIZADOR' THEN 0 ELSE 1 END, lower(COALESCE(NULLIF(u.nombre, ''), u.correo)))
           FROM agenda_evento_participantes p
           JOIN usuarios u ON u.id = p.usuario_id
           LEFT JOIN perfiles_acceso perfil ON perfil.codigo = u.rol
           WHERE p.id_evento = e.id_evento
         ), '[]'::jsonb) AS participantes,
         recordatorio.minutos_antes AS mi_recordatorio_minutos
  FROM agenda_eventos e
  JOIN agenda_evento_participantes participante
    ON participante.id_evento = e.id_evento AND participante.usuario_id = $1
  JOIN usuarios creador ON creador.id = e.creado_por
  LEFT JOIN agenda_recordatorios recordatorio
    ON recordatorio.id_evento = e.id_evento AND recordatorio.usuario_id = $1`;

const createAgendaRouter = ({ pool, verifyToken, verifyPermission, insertarAudit, getClientIp, realtimeHub }) => {
  const router = express.Router();
  router.use(verifyToken);
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    next();
  });

  router.get('/', verifyPermission('agenda.view'), async (req, res) => {
    const window = dateWindow(req.query);
    if (!window) {
      return res.status(400).json({ message: 'Selecciona un período válido de hasta 93 días.' });
    }
    try {
      const result = await pool.query(`${eventQuery}
        WHERE e.inicio < $3 AND e.fin > $2
        ORDER BY e.inicio, e.id_evento`, [req.user.id, window.from, window.to]);
      res.json({ events: result.rows, from: window.from.toISOString(), to: window.to.toISOString() });
    } catch (error) {
      publicError(res, error, 'No fue posible cargar tu agenda.');
    }
  });

  router.get('/directorio', verifyPermission('agenda.create'), async (req, res) => {
    const query = clean(req.query.q, 100);
    try {
      const result = await pool.query(`
        SELECT u.id, COALESCE(NULLIF(u.nombre, ''), u.correo) AS nombre,
               COALESCE(NULLIF(u.cargo, ''), p.nombre, 'Personal') AS cargo
        FROM usuarios u
        LEFT JOIN perfiles_acceso p ON p.codigo = u.rol
        WHERE u.activo = true AND u.eliminado_en IS NULL AND u.id <> $1
          AND ($2 = '' OR COALESCE(u.nombre, '') ILIKE '%' || $2 || '%'
            OR COALESCE(u.cargo, '') ILIKE '%' || $2 || '%'
            OR COALESCE(p.nombre, '') ILIKE '%' || $2 || '%')
        ORDER BY lower(COALESCE(NULLIF(u.nombre, ''), u.correo))
        LIMIT 40`, [req.user.id, query]);
      res.json({ people: result.rows });
    } catch (error) {
      publicError(res, error, 'No fue posible cargar el directorio interno.');
    }
  });

  router.post('/', verifyPermission('agenda.create'), async (req, res) => {
    const title = clean(req.body?.titulo, 180);
    const detail = narrative(req.body?.detalle, 1500);
    const type = clean(req.body?.tipo, 24).toUpperCase() || 'REUNION';
    const location = clean(req.body?.ubicacion, 180);
    const start = parseInstant(req.body?.inicio);
    const end = parseInstant(req.body?.fin);
    const invitees = uniqueIds(req.body?.participantes_ids).filter((userId) => userId !== Number(req.user.id));
    const reminderMinutes = Number(req.body?.recordatorio_minutos ?? 30);
    if (title.length < 3) return res.status(400).json({ message: 'Escribe un título de al menos 3 caracteres.' });
    if (!EVENT_TYPES.has(type)) return res.status(400).json({ message: 'Selecciona un tipo de evento válido.' });
    if (!start || !end || end <= start) return res.status(400).json({ message: 'Selecciona un inicio y un término válidos.' });
    if ((end.getTime() - start.getTime()) > 7 * 86_400_000) return res.status(400).json({ message: 'Un evento no puede extenderse por más de 7 días.' });
    if (invitees.length > 50) return res.status(400).json({ message: 'Puedes invitar a un máximo de 50 personas.' });
    if (!REMINDER_MINUTES.has(reminderMinutes)) return res.status(400).json({ message: 'Selecciona una anticipación válida para el recordatorio.' });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const activeInvitees = invitees.length ? await client.query(`
        SELECT id FROM usuarios
        WHERE id = ANY($1::int[]) AND activo = true AND eliminado_en IS NULL
        FOR SHARE`, [invitees]) : { rows: [], rowCount: 0 };
      if (activeInvitees.rowCount !== invitees.length) {
        const error = new Error('Una persona seleccionada ya no tiene una cuenta activa. Actualiza el directorio.');
        error.statusCode = 409;
        throw error;
      }

      const event = await client.query(`
        INSERT INTO agenda_eventos
          (titulo, detalle, tipo, inicio, fin, todo_el_dia, ubicacion, alcance, creado_por)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`, [title, detail || null, type, start, end, req.body?.todo_el_dia === true,
        location || null, invitees.length ? 'INVITADOS' : 'PERSONAL', req.user.id]);
      const eventId = event.rows[0].id_evento;
      const participants = [Number(req.user.id), ...invitees];
      await client.query(`
        INSERT INTO agenda_evento_participantes (id_evento, usuario_id, rol, respuesta)
        SELECT $1, persona,
               CASE WHEN persona = $2 THEN 'ORGANIZADOR' ELSE 'PARTICIPANTE' END,
               CASE WHEN persona = $2 THEN 'ACEPTADA' ELSE 'PENDIENTE' END
        FROM unnest($3::int[]) AS persona`, [eventId, req.user.id, participants]);
      await client.query(`
        INSERT INTO agenda_recordatorios (id_evento, usuario_id, minutos_antes)
        SELECT $1, persona, $2 FROM unnest($3::int[]) AS persona`, [eventId, reminderMinutes, participants]);

      const notifications = invitees.length ? await client.query(`
        INSERT INTO notificaciones_internas
          (usuario_id, modulo, tipo, titulo, detalle, enlace, clave_dedupe, enviado_por, prioridad)
        SELECT persona, 'AGENDA', 'INVITACION_AGENDA', $2, $3, $4,
               'agenda:invitacion:' || $1::text || ':' || persona::text, $5, 'NORMAL'
        FROM unnest($6::int[]) AS persona
        RETURNING id_notificacion, usuario_id, creada_en`, [eventId,
        `Invitación: ${title}`, `Te invitaron a un evento interno que comienza el ${new Intl.DateTimeFormat('es-CL', {
          dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Santiago'
        }).format(start)}.`,
        `/agenda?evento=${eventId}`, req.user.id, invitees]) : { rows: [] };
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CREAR_EVENTO_AGENDA',
        entidad: 'agenda_evento',
        entidad_id: eventId,
        detalle: { tipo: type, invitados: invitees.length, todo_el_dia: req.body?.todo_el_dia === true },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      for (const notification of notifications.rows) {
        realtimeHub?.publishToUsers([notification.usuario_id], 'institutional-notification', {
          notification_id: notification.id_notificacion,
          title: `Invitación: ${title}`,
          detail: 'Tienes una nueva invitación en tu agenda interna.',
          priority: 'NORMAL',
          link: `/agenda?evento=${eventId}`,
          sender: req.user.nombre || req.user.correo || 'Equipo institucional',
          created_at: notification.creada_en,
          notify: true
        });
      }
      res.status(201).json({ id_evento: eventId, message: 'El evento quedó guardado en la agenda interna.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      publicError(res, error, 'No fue posible guardar el evento.');
    } finally {
      client.release();
    }
  });

  router.patch('/:id/respuesta', verifyPermission('agenda.view'), async (req, res) => {
    const eventId = positiveId(req.params.id);
    const response = clean(req.body?.respuesta, 20).toUpperCase();
    if (!eventId || !RESPONSES.has(response)) return res.status(400).json({ message: 'Selecciona una respuesta válida.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(`
        UPDATE agenda_evento_participantes p
        SET respuesta = $3, respondido_en = CURRENT_TIMESTAMP
        FROM agenda_eventos e
        WHERE p.id_evento = $1 AND p.usuario_id = $2 AND p.rol = 'PARTICIPANTE'
          AND e.id_evento = p.id_evento AND e.estado = 'PROGRAMADO'
        RETURNING p.id_evento`, [eventId, req.user.id, response]);
      if (!updated.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'La invitación ya no está disponible para responder.' });
      }
      if (response === 'RECHAZADA') {
        await client.query(`UPDATE agenda_recordatorios
          SET estado = 'CANCELADO', actualizado_en = CURRENT_TIMESTAMP
          WHERE id_evento = $1 AND usuario_id = $2 AND estado = 'PENDIENTE'`, [eventId, req.user.id]);
      }
      await insertarAudit(client, {
        usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'RESPONDER_EVENTO_AGENDA', entidad: 'agenda_evento', entidad_id: eventId,
        detalle: { respuesta: response }, ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: response === 'ACEPTADA' ? 'Confirmaste tu asistencia.' : 'Rechazaste la invitación.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      publicError(res, error, 'No fue posible guardar tu respuesta.');
    } finally {
      client.release();
    }
  });

  router.patch('/:id/cancelar', verifyPermission('agenda.create'), async (req, res) => {
    const eventId = positiveId(req.params.id);
    const reason = narrative(req.body?.motivo, 500);
    if (!eventId || reason.length < 5) return res.status(400).json({ message: 'Indica un motivo de cancelación de al menos 5 caracteres.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const cancelled = await client.query(`
        UPDATE agenda_eventos
        SET estado = 'CANCELADO', cancelado_por = $2, cancelado_en = CURRENT_TIMESTAMP,
            motivo_cancelacion = $3, actualizado_en = CURRENT_TIMESTAMP, version = version + 1
        WHERE id_evento = $1 AND creado_por = $2 AND estado = 'PROGRAMADO'
        RETURNING titulo`, [eventId, req.user.id, reason]);
      if (!cancelled.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'El evento no está disponible o solo puede cancelarlo quien lo organizó.' });
      }
      await client.query(`UPDATE agenda_recordatorios SET estado = 'CANCELADO', actualizado_en = CURRENT_TIMESTAMP
        WHERE id_evento = $1 AND estado = 'PENDIENTE'`, [eventId]);
      await insertarAudit(client, {
        usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'CANCELAR_EVENTO_AGENDA', entidad: 'agenda_evento', entidad_id: eventId,
        detalle: { motivo_omitido: true }, ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: 'El evento fue cancelado y permanecerá visible en el historial.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      publicError(res, error, 'No fue posible cancelar el evento.');
    } finally {
      client.release();
    }
  });

  router.get('/:id', verifyPermission('agenda.view'), async (req, res) => {
    const eventId = positiveId(req.params.id);
    if (!eventId) return res.status(400).json({ message: 'El evento seleccionado no es válido.' });
    try {
      const result = await pool.query(`${eventQuery} WHERE e.id_evento = $2`, [req.user.id, eventId]);
      if (!result.rowCount) return res.status(404).json({ message: 'El evento no existe o no forma parte de tu agenda.' });
      res.json({ event: result.rows[0] });
    } catch (error) {
      publicError(res, error, 'No fue posible abrir el evento.');
    }
  });

  return router;
};

module.exports = { createAgendaRouter, dateWindow, parseInstant };
