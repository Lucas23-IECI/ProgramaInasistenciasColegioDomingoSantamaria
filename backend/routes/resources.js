const express = require('express');

const RESOURCE_STATES = new Set(['ACTIVO', 'MANTENCION', 'BAJA']);
const REQUEST_DECISIONS = new Set(['APROBADA', 'RECHAZADA']);
const clean = (value, max = 180) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const narrative = (value, max = 1000) => String(value || '').trim().slice(0, max);
const positiveId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const boundedInt = (value, max = 10000) => Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= max
  ? Number(value)
  : null;
const hasPermission = (req, permission) => req.user?.rol === 'admin'
  || (Array.isArray(req.user?.permissions) && req.user.permissions.includes(permission));
const pageData = (query) => ({
  page: boundedInt(query.pagina, 100000) || 1,
  limit: Math.min(boundedInt(query.limite, 100) || 20, 100)
});
const isoDate = (value) => {
  const text = clean(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) return null;
  const date = new Date(`${text}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
};
const instant = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const insertNotifications = async (client, { userIds, type, title, detail, link, dedupe, senderId, priority = 'NORMAL' }) => {
  const recipients = [...new Set(userIds.map(positiveId).filter(Boolean))];
  if (!recipients.length) return [];
  const result = await client.query(`INSERT INTO notificaciones_internas
    (usuario_id, modulo, tipo, titulo, detalle, enlace, clave_dedupe, enviado_por, prioridad)
    SELECT destinatario, 'RECURSOS', $2, $3, $4, $5, $6 || ':' || destinatario::text, $7, $8
    FROM unnest($1::int[]) AS destinatario
    ON CONFLICT (usuario_id, clave_dedupe) WHERE clave_dedupe IS NOT NULL DO NOTHING
    RETURNING id_notificacion, usuario_id, creada_en`,
  [recipients, clean(type, 48), clean(title, 180), narrative(detail, 600), clean(link, 300), clean(dedupe, 200), senderId, priority]);
  return result.rows;
};

const publishNotifications = (realtimeHub, rows, { title, detail, link, priority = 'NORMAL', sender }) => {
  for (const notification of rows) {
    realtimeHub?.publishToUsers([notification.usuario_id], 'institutional-notification', {
      notification_id: notification.id_notificacion,
      title, detail, priority, link,
      sender: sender || 'Equipo institucional',
      created_at: notification.creada_en,
      notify: true
    });
  }
};

const publicError = (res, error, fallback) => {
  if (error?.code === '23505') return res.status(409).json({ message: 'Ya existe un recurso con ese código interno.' });
  const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500
    ? error.statusCode
    : 500;
  if (status >= 500) console.error('[recursos]', error.message);
  return res.status(status).json({ message: status >= 500 ? fallback : error.message });
};

const resourceListSql = `
  SELECT r.id_recurso, r.nombre, r.categoria, r.codigo_interno, r.descripcion, r.ubicacion,
         r.stock_total, r.estado, r.creado_en, r.actualizado_en, r.version,
         COALESCE(prestado.cantidad, 0)::int AS stock_prestado,
         GREATEST(r.stock_total - COALESCE(prestado.cantidad, 0), 0)::int AS stock_disponible
  FROM recursos_inventario r
  LEFT JOIN LATERAL (
    SELECT SUM(p.cantidad)::int AS cantidad
    FROM recursos_prestamos p
    WHERE p.id_recurso = r.id_recurso AND p.estado = 'ACTIVO'
  ) prestado ON true`;

const lockAvailableResource = async (client, resourceId, quantity) => {
  const resource = await client.query('SELECT * FROM recursos_inventario WHERE id_recurso = $1 FOR UPDATE', [resourceId]);
  if (!resource.rowCount) throw fail('El recurso seleccionado ya no existe.', 404);
  if (resource.rows[0].estado !== 'ACTIVO') throw fail('El recurso no está disponible para nuevas entregas.', 409);
  const loaned = await client.query(`SELECT COALESCE(SUM(cantidad), 0)::int AS cantidad
    FROM recursos_prestamos WHERE id_recurso = $1 AND estado = 'ACTIVO'`, [resourceId]);
  const available = Number(resource.rows[0].stock_total) - Number(loaned.rows[0].cantidad);
  if (available < quantity) {
    throw fail(`Solo hay ${Math.max(available, 0)} unidad${available === 1 ? '' : 'es'} disponible${available === 1 ? '' : 's'}.`, 409);
  }
  return resource.rows[0];
};

const createResourcesRouter = ({ pool, verifyToken, verifyPermission, insertarAudit, getClientIp, realtimeHub }) => {
  const router = express.Router();
  router.use(verifyToken);
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    next();
  });

  router.get('/resumen', verifyPermission('resources.view'), async (req, res) => {
    const manager = hasPermission(req, 'resources.manage');
    try {
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM recursos_inventario WHERE estado <> 'BAJA') AS recursos,
          (SELECT COALESCE(SUM(GREATEST(r.stock_total - COALESCE(p.cantidad, 0), 0)), 0)::int
             FROM recursos_inventario r
             LEFT JOIN (SELECT id_recurso, SUM(cantidad)::int AS cantidad FROM recursos_prestamos WHERE estado = 'ACTIVO' GROUP BY id_recurso) p USING (id_recurso)
            WHERE r.estado = 'ACTIVO') AS unidades_disponibles,
          (SELECT COUNT(*)::int FROM recursos_prestamos
            WHERE estado = 'ACTIVO' AND ($1::boolean OR usuario_id = $2)) AS prestamos_activos,
          (SELECT COUNT(*)::int FROM recursos_prestamos
            WHERE estado = 'ACTIVO' AND vence_en < CURRENT_TIMESTAMP AND ($1::boolean OR usuario_id = $2)) AS prestamos_vencidos,
          (SELECT COUNT(*)::int FROM recursos_solicitudes
            WHERE estado = 'PENDIENTE' AND ($1::boolean OR solicitante_id = $2)) AS solicitudes_pendientes`,
      [manager, req.user.id]);
      res.json(result.rows[0]);
    } catch (error) {
      publicError(res, error, 'No fue posible cargar el resumen de recursos.');
    }
  });

  router.get('/catalogo', verifyPermission('resources.view'), async (req, res) => {
    const { page, limit } = pageData(req.query);
    const query = clean(req.query.q, 100);
    const category = clean(req.query.categoria, 80);
    const state = clean(req.query.estado, 20).toUpperCase();
    if (state && !RESOURCE_STATES.has(state)) return res.status(400).json({ message: 'Selecciona un estado de recurso válido.' });
    try {
      const result = await pool.query(`${resourceListSql}
        WHERE ($1 = '' OR r.nombre ILIKE '%' || $1 || '%' OR COALESCE(r.codigo_interno, '') ILIKE '%' || $1 || '%' OR r.categoria ILIKE '%' || $1 || '%')
          AND ($2 = '' OR r.categoria = $2)
          AND ($3 = '' OR r.estado = $3)
        ORDER BY CASE r.estado WHEN 'ACTIVO' THEN 0 WHEN 'MANTENCION' THEN 1 ELSE 2 END, lower(r.nombre), r.id_recurso
        LIMIT $4 OFFSET $5`, [query, category, state, limit, (page - 1) * limit]);
      const count = await pool.query(`SELECT COUNT(*)::int AS total FROM recursos_inventario r
        WHERE ($1 = '' OR r.nombre ILIKE '%' || $1 || '%' OR COALESCE(r.codigo_interno, '') ILIKE '%' || $1 || '%' OR r.categoria ILIKE '%' || $1 || '%')
          AND ($2 = '' OR r.categoria = $2) AND ($3 = '' OR r.estado = $3)`, [query, category, state]);
      const categories = await pool.query("SELECT DISTINCT categoria FROM recursos_inventario WHERE estado <> 'BAJA' ORDER BY categoria");
      res.json({ items: result.rows, total: count.rows[0].total, page, limit, categories: categories.rows.map((row) => row.categoria) });
    } catch (error) {
      publicError(res, error, 'No fue posible cargar el inventario.');
    }
  });

  router.get('/personas', verifyPermission('resources.manage'), async (_req, res) => {
    try {
      const result = await pool.query(`SELECT u.id, COALESCE(NULLIF(u.nombre, ''), u.correo) AS nombre,
        COALESCE(NULLIF(u.cargo, ''), p.nombre, 'Personal') AS cargo
        FROM usuarios u LEFT JOIN perfiles_acceso p ON p.codigo = u.rol
        WHERE u.activo = true AND u.eliminado_en IS NULL
        ORDER BY lower(COALESCE(NULLIF(u.nombre, ''), u.correo)) LIMIT 250`);
      res.json({ people: result.rows });
    } catch (error) {
      publicError(res, error, 'No fue posible cargar las personas habilitadas.');
    }
  });

  router.post('/catalogo', verifyPermission('resources.manage'), async (req, res) => {
    const name = clean(req.body?.nombre, 180);
    const category = clean(req.body?.categoria, 80);
    const code = clean(req.body?.codigo_interno, 80);
    const description = narrative(req.body?.descripcion, 1000);
    const location = clean(req.body?.ubicacion, 180);
    const stock = boundedInt(req.body?.stock_total);
    if (name.length < 3) return res.status(400).json({ message: 'Escribe un nombre de al menos 3 caracteres.' });
    if (category.length < 2) return res.status(400).json({ message: 'Indica una categoría para el recurso.' });
    if (!stock) return res.status(400).json({ message: 'El stock total debe ser un número entre 1 y 10.000.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`INSERT INTO recursos_inventario
        (nombre, categoria, codigo_interno, descripcion, ubicacion, stock_total, creado_por, actualizado_por)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id_recurso`,
      [name, category, code || null, description || null, location || null, stock, req.user.id]);
      await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'CREAR_RECURSO_INTERNO', entidad: 'recurso_interno', entidad_id: result.rows[0].id_recurso,
        detalle: { categoria: category, stock_total: stock }, ip: getClientIp(req) });
      await client.query('COMMIT');
      res.status(201).json({ id_recurso: result.rows[0].id_recurso, message: 'El recurso fue agregado al inventario.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      publicError(res, error, 'No fue posible agregar el recurso.');
    } finally {
      client.release();
    }
  });

  router.patch('/catalogo/:id', verifyPermission('resources.manage'), async (req, res) => {
    const resourceId = positiveId(req.params.id);
    const name = clean(req.body?.nombre, 180);
    const category = clean(req.body?.categoria, 80);
    const code = clean(req.body?.codigo_interno, 80);
    const description = narrative(req.body?.descripcion, 1000);
    const location = clean(req.body?.ubicacion, 180);
    const stock = boundedInt(req.body?.stock_total);
    const state = clean(req.body?.estado, 20).toUpperCase();
    const version = boundedInt(req.body?.version, 1000000000);
    if (!resourceId || name.length < 3 || category.length < 2 || !stock || !RESOURCE_STATES.has(state) || !version) {
      return res.status(400).json({ message: 'Revisa el nombre, categoría, stock, estado y versión del recurso.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM recursos_inventario WHERE id_recurso = $1 FOR UPDATE', [resourceId]);
      if (!locked.rowCount) throw fail('El recurso ya no existe.', 404);
      if (Number(locked.rows[0].version) !== version) throw fail('El recurso cambió mientras lo editabas. Recarga la información antes de guardar.', 409);
      const loaned = await client.query("SELECT COALESCE(SUM(cantidad), 0)::int AS cantidad FROM recursos_prestamos WHERE id_recurso = $1 AND estado = 'ACTIVO'", [resourceId]);
      if (stock < Number(loaned.rows[0].cantidad)) throw fail('El stock total no puede ser menor que las unidades actualmente prestadas.', 409);
      if (state === 'BAJA' && Number(loaned.rows[0].cantidad) > 0) throw fail('Devuelve o cancela los préstamos activos antes de dar de baja el recurso.', 409);
      await client.query(`UPDATE recursos_inventario SET nombre=$2, categoria=$3, codigo_interno=$4,
        descripcion=$5, ubicacion=$6, stock_total=$7, estado=$8, actualizado_por=$9,
        actualizado_en=CURRENT_TIMESTAMP, version=version+1 WHERE id_recurso=$1`,
      [resourceId, name, category, code || null, description || null, location || null, stock, state, req.user.id]);
      await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'ACTUALIZAR_RECURSO_INTERNO', entidad: 'recurso_interno', entidad_id: resourceId,
        detalle: { estado: state, stock_total: stock }, ip: getClientIp(req) });
      await client.query('COMMIT');
      res.json({ message: 'El recurso fue actualizado.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      publicError(res, error, 'No fue posible actualizar el recurso.');
    } finally {
      client.release();
    }
  });

  router.get('/prestamos', verifyPermission('resources.view'), async (req, res) => {
    const { page, limit } = pageData(req.query);
    const manager = hasPermission(req, 'resources.manage');
    const state = clean(req.query.estado, 20).toUpperCase();
    if (state && !new Set(['ACTIVO', 'DEVUELTO', 'CANCELADO', 'VENCIDO']).has(state)) return res.status(400).json({ message: 'Selecciona un estado de préstamo válido.' });
    try {
      const whereState = `($3::text = ''
        OR ($3::text = 'VENCIDO' AND p.estado = 'ACTIVO' AND p.vence_en < CURRENT_TIMESTAMP)
        OR ($3::text <> 'VENCIDO' AND p.estado = $3::text))`;
      const params = [manager, req.user.id, state, limit, (page - 1) * limit];
      const result = await pool.query(`SELECT p.*, r.nombre AS recurso_nombre, r.codigo_interno,
        COALESCE(NULLIF(u.nombre, ''), u.correo) AS usuario_nombre,
        COALESCE(NULLIF(u.cargo, ''), perfil.nombre, 'Personal') AS usuario_cargo,
        (p.estado = 'ACTIVO' AND p.vence_en < CURRENT_TIMESTAMP) AS vencido
        FROM recursos_prestamos p JOIN recursos_inventario r USING (id_recurso)
        JOIN usuarios u ON u.id = p.usuario_id LEFT JOIN perfiles_acceso perfil ON perfil.codigo = u.rol
        WHERE ($1::boolean OR p.usuario_id = $2) AND ${whereState}
        ORDER BY CASE WHEN p.estado='ACTIVO' AND p.vence_en < CURRENT_TIMESTAMP THEN 0 WHEN p.estado='ACTIVO' THEN 1 ELSE 2 END,
          p.prestado_en DESC LIMIT $4 OFFSET $5`, params);
      const count = await pool.query(`SELECT COUNT(*)::int AS total FROM recursos_prestamos p
        WHERE ($1::boolean OR p.usuario_id = $2) AND ${whereState}`, params.slice(0, 3));
      res.json({ items: result.rows, total: count.rows[0].total, page, limit });
    } catch (error) {
      publicError(res, error, 'No fue posible cargar los préstamos.');
    }
  });

  router.post('/prestamos', verifyPermission('resources.manage'), async (req, res) => {
    const resourceId = positiveId(req.body?.id_recurso);
    const userId = positiveId(req.body?.usuario_id);
    const quantity = boundedInt(req.body?.cantidad);
    const dueAt = instant(req.body?.vence_en);
    const condition = narrative(req.body?.condicion_entrega, 500);
    const notes = narrative(req.body?.observaciones, 1000);
    if (!resourceId || !userId || !quantity) return res.status(400).json({ message: 'Selecciona recurso, persona y una cantidad válida.' });
    if (req.body?.vence_en && (!dueAt || dueAt <= new Date())) return res.status(400).json({ message: 'La fecha de devolución debe estar en el futuro.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const resource = await lockAvailableResource(client, resourceId, quantity);
      const person = await client.query('SELECT id FROM usuarios WHERE id=$1 AND activo=true AND eliminado_en IS NULL FOR SHARE', [userId]);
      if (!person.rowCount) throw fail('La persona seleccionada ya no tiene una cuenta activa.', 409);
      const result = await client.query(`INSERT INTO recursos_prestamos
        (id_recurso, usuario_id, cantidad, vence_en, entregado_por, condicion_entrega, observaciones)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id_prestamo`,
      [resourceId, userId, quantity, dueAt, req.user.id, condition || null, notes || null]);
      await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'ENTREGAR_RECURSO_INTERNO', entidad: 'recurso_prestamo', entidad_id: result.rows[0].id_prestamo,
        detalle: { id_recurso: resourceId, usuario_id: userId, cantidad: quantity }, ip: getClientIp(req) });
      const notificationCopy = {
        title: 'Recurso entregado',
        detail: `Se registró la entrega de ${quantity} unidad${quantity === 1 ? '' : 'es'} de ${resource.nombre}.`,
        link: '/admin/recursos',
        sender: req.user.nombre || req.user.correo
      };
      const notifications = await insertNotifications(client, {
        userIds: [userId], type: 'PRESTAMO_RECURSO', ...notificationCopy,
        dedupe: `recursos:prestamo:${result.rows[0].id_prestamo}`, senderId: req.user.id
      });
      await client.query('COMMIT');
      publishNotifications(realtimeHub, notifications, notificationCopy);
      res.status(201).json({ id_prestamo: result.rows[0].id_prestamo, message: 'El préstamo quedó registrado.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      publicError(res, error, 'No fue posible registrar el préstamo.');
    } finally {
      client.release();
    }
  });

  router.patch('/prestamos/:id/devolver', verifyPermission('resources.manage'), async (req, res) => {
    const loanId = positiveId(req.params.id);
    const condition = narrative(req.body?.condicion_devolucion, 500);
    if (!loanId) return res.status(400).json({ message: 'El préstamo seleccionado no es válido.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`UPDATE recursos_prestamos SET estado='DEVUELTO',
        devuelto_en=CURRENT_TIMESTAMP, recibido_por=$2, condicion_devolucion=$3, actualizado_en=CURRENT_TIMESTAMP
        WHERE id_prestamo=$1 AND estado='ACTIVO' RETURNING id_recurso, usuario_id, cantidad`,
      [loanId, req.user.id, condition || null]);
      if (!result.rowCount) throw fail('El préstamo ya no está activo o no existe.', 409);
      await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'DEVOLVER_RECURSO_INTERNO', entidad: 'recurso_prestamo', entidad_id: loanId,
        detalle: { id_recurso: result.rows[0].id_recurso, cantidad: result.rows[0].cantidad }, ip: getClientIp(req) });
      const notificationCopy = {
        title: 'Devolución registrada',
        detail: 'La devolución del recurso quedó confirmada y su stock volvió a estar disponible.',
        link: '/admin/recursos',
        sender: req.user.nombre || req.user.correo
      };
      const notifications = await insertNotifications(client, {
        userIds: [result.rows[0].usuario_id], type: 'DEVOLUCION_RECURSO', ...notificationCopy,
        dedupe: `recursos:devolucion:${loanId}`, senderId: req.user.id
      });
      await client.query('COMMIT');
      publishNotifications(realtimeHub, notifications, notificationCopy);
      res.json({ message: 'La devolución quedó registrada y el stock volvió a estar disponible.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      publicError(res, error, 'No fue posible registrar la devolución.');
    } finally {
      client.release();
    }
  });

  router.get('/solicitudes', verifyPermission('resources.view'), async (req, res) => {
    const { page, limit } = pageData(req.query);
    const manager = hasPermission(req, 'resources.manage');
    const state = clean(req.query.estado, 20).toUpperCase();
    const allowed = new Set(['PENDIENTE', 'APROBADA', 'RECHAZADA', 'ENTREGADA', 'CANCELADA']);
    if (state && !allowed.has(state)) return res.status(400).json({ message: 'Selecciona un estado de solicitud válido.' });
    try {
      const result = await pool.query(`SELECT s.*, r.nombre AS recurso_nombre, r.codigo_interno,
        COALESCE(NULLIF(u.nombre, ''), u.correo) AS solicitante_nombre,
        COALESCE(NULLIF(u.cargo, ''), perfil.nombre, 'Personal') AS solicitante_cargo
        FROM recursos_solicitudes s JOIN recursos_inventario r USING (id_recurso)
        JOIN usuarios u ON u.id=s.solicitante_id LEFT JOIN perfiles_acceso perfil ON perfil.codigo=u.rol
        WHERE ($1::boolean OR s.solicitante_id=$2) AND ($3='' OR s.estado=$3)
        ORDER BY CASE s.estado WHEN 'PENDIENTE' THEN 0 WHEN 'APROBADA' THEN 1 ELSE 2 END, s.creado_en DESC
        LIMIT $4 OFFSET $5`, [manager, req.user.id, state, limit, (page - 1) * limit]);
      const count = await pool.query(`SELECT COUNT(*)::int AS total FROM recursos_solicitudes s
        WHERE ($1::boolean OR s.solicitante_id=$2) AND ($3='' OR s.estado=$3)`, [manager, req.user.id, state]);
      res.json({ items: result.rows, total: count.rows[0].total, page, limit });
    } catch (error) {
      publicError(res, error, 'No fue posible cargar las solicitudes.');
    }
  });

  router.post('/solicitudes', verifyPermission('resources.request'), async (req, res) => {
    const resourceId = positiveId(req.body?.id_recurso);
    const quantity = boundedInt(req.body?.cantidad);
    const reason = narrative(req.body?.motivo, 1000);
    const needDate = req.body?.necesita_en ? isoDate(req.body.necesita_en) : null;
    if (!resourceId || !quantity || reason.length < 5) return res.status(400).json({ message: 'Selecciona un recurso, cantidad y explica para qué lo necesitas.' });
    if (req.body?.necesita_en && !needDate) return res.status(400).json({ message: 'Selecciona una fecha necesaria válida.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const resource = await client.query("SELECT nombre, stock_total FROM recursos_inventario WHERE id_recurso=$1 AND estado='ACTIVO' FOR SHARE", [resourceId]);
      if (!resource.rowCount) throw fail('El recurso ya no admite nuevas solicitudes.', 409);
      if (quantity > Number(resource.rows[0].stock_total)) throw fail('La cantidad solicitada supera el stock total del recurso.');
      const result = await client.query(`INSERT INTO recursos_solicitudes
        (id_recurso, solicitante_id, cantidad, motivo, necesita_en) VALUES ($1,$2,$3,$4,$5) RETURNING id_solicitud`,
      [resourceId, req.user.id, quantity, reason, needDate]);
      await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'CREAR_SOLICITUD_RECURSO', entidad: 'recurso_solicitud', entidad_id: result.rows[0].id_solicitud,
        detalle: { id_recurso: resourceId, cantidad: quantity }, ip: getClientIp(req) });
      const managers = await client.query(`SELECT u.id FROM usuarios u
        WHERE u.activo=true AND u.eliminado_en IS NULL AND u.id<>$2
          AND COALESCE(
            (SELECT pu.concedido FROM permisos_usuario pu WHERE pu.usuario_id=u.id AND pu.permiso_codigo=$1),
            EXISTS (SELECT 1 FROM permisos_rol pr WHERE pr.rol=u.rol AND pr.permiso_codigo=$1)
          )=true FOR SHARE`, ['resources.manage', req.user.id]);
      const notificationCopy = {
        title: 'Nueva solicitud de recurso',
        detail: `${req.user.nombre || req.user.correo || 'Una persona del equipo'} solicitó ${quantity} unidad${quantity === 1 ? '' : 'es'} de ${resource.rows[0].nombre}.`,
        link: '/admin/recursos',
        sender: req.user.nombre || req.user.correo
      };
      const notifications = await insertNotifications(client, {
        userIds: managers.rows.map((row) => row.id), type: 'SOLICITUD_RECURSO', ...notificationCopy,
        dedupe: `recursos:solicitud:${result.rows[0].id_solicitud}`, senderId: req.user.id
      });
      await client.query('COMMIT');
      publishNotifications(realtimeHub, notifications, notificationCopy);
      res.status(201).json({ id_solicitud: result.rows[0].id_solicitud, message: 'La solicitud quedó enviada para revisión.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      publicError(res, error, 'No fue posible crear la solicitud.');
    } finally {
      client.release();
    }
  });

  router.patch('/solicitudes/:id/cancelar', verifyPermission('resources.request'), async (req, res) => {
    const requestId = positiveId(req.params.id);
    if (!requestId) return res.status(400).json({ message: 'La solicitud seleccionada no es válida.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`UPDATE recursos_solicitudes SET estado='CANCELADA', actualizado_en=CURRENT_TIMESTAMP
        WHERE id_solicitud=$1 AND solicitante_id=$2 AND estado IN ('PENDIENTE','APROBADA') RETURNING id_recurso`, [requestId, req.user.id]);
      if (!result.rowCount) throw fail('La solicitud ya fue resuelta o no te pertenece.', 409);
      await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'CANCELAR_SOLICITUD_RECURSO', entidad: 'recurso_solicitud', entidad_id: requestId,
        detalle: { id_recurso: result.rows[0].id_recurso }, ip: getClientIp(req) });
      await client.query('COMMIT');
      res.json({ message: 'La solicitud fue cancelada.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      publicError(res, error, 'No fue posible cancelar la solicitud.');
    } finally {
      client.release();
    }
  });

  router.patch('/solicitudes/:id/decision', verifyPermission('resources.manage'), async (req, res) => {
    const requestId = positiveId(req.params.id);
    const decision = clean(req.body?.estado, 20).toUpperCase();
    const response = narrative(req.body?.respuesta, 1000);
    if (!requestId || !REQUEST_DECISIONS.has(decision)) return res.status(400).json({ message: 'Selecciona una decisión válida.' });
    if (decision === 'RECHAZADA' && response.length < 5) return res.status(400).json({ message: 'Explica brevemente el motivo del rechazo.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`UPDATE recursos_solicitudes s SET estado=$2, resuelto_por=$3,
        resuelto_en=CURRENT_TIMESTAMP, respuesta=$4, actualizado_en=CURRENT_TIMESTAMP
        FROM recursos_inventario r
        WHERE s.id_solicitud=$1 AND s.estado='PENDIENTE' AND r.id_recurso=s.id_recurso
        RETURNING s.solicitante_id, s.id_recurso, r.nombre AS recurso_nombre`,
      [requestId, decision, req.user.id, response || null]);
      if (!result.rowCount) throw fail('La solicitud ya fue resuelta o cancelada.', 409);
      await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: decision === 'APROBADA' ? 'APROBAR_SOLICITUD_RECURSO' : 'RECHAZAR_SOLICITUD_RECURSO',
        entidad: 'recurso_solicitud', entidad_id: requestId,
        detalle: { id_recurso: result.rows[0].id_recurso, solicitante_id: result.rows[0].solicitante_id }, ip: getClientIp(req) });
      const notificationCopy = {
        title: decision === 'APROBADA' ? 'Solicitud de recurso aprobada' : 'Solicitud de recurso rechazada',
        detail: decision === 'APROBADA'
          ? `Tu solicitud de ${result.rows[0].recurso_nombre} fue aprobada. La entrega todavía debe registrarse.`
          : `Tu solicitud de ${result.rows[0].recurso_nombre} fue rechazada.${response ? ` Motivo: ${response}` : ''}`,
        link: '/admin/recursos',
        sender: req.user.nombre || req.user.correo
      };
      const notifications = await insertNotifications(client, {
        userIds: [result.rows[0].solicitante_id], type: `SOLICITUD_RECURSO_${decision}`, ...notificationCopy,
        dedupe: `recursos:solicitud:${requestId}:${decision.toLowerCase()}`, senderId: req.user.id
      });
      await client.query('COMMIT');
      publishNotifications(realtimeHub, notifications, notificationCopy);
      res.json({ message: decision === 'APROBADA' ? 'La solicitud fue aprobada; aún falta registrar su entrega.' : 'La solicitud fue rechazada.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      publicError(res, error, 'No fue posible guardar la decisión.');
    } finally {
      client.release();
    }
  });

  router.post('/solicitudes/:id/entregar', verifyPermission('resources.manage'), async (req, res) => {
    const requestId = positiveId(req.params.id);
    const dueAt = instant(req.body?.vence_en);
    const condition = narrative(req.body?.condicion_entrega, 500);
    const notes = narrative(req.body?.observaciones, 1000);
    if (!requestId) return res.status(400).json({ message: 'La solicitud seleccionada no es válida.' });
    if (req.body?.vence_en && (!dueAt || dueAt <= new Date())) return res.status(400).json({ message: 'La fecha de devolución debe estar en el futuro.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const request = await client.query(`SELECT * FROM recursos_solicitudes
        WHERE id_solicitud=$1 AND estado IN ('PENDIENTE','APROBADA') FOR UPDATE`, [requestId]);
      if (!request.rowCount) throw fail('La solicitud ya fue entregada, rechazada o cancelada.', 409);
      const item = request.rows[0];
      const resource = await lockAvailableResource(client, item.id_recurso, item.cantidad);
      const loan = await client.query(`INSERT INTO recursos_prestamos
        (id_recurso, usuario_id, cantidad, vence_en, entregado_por, condicion_entrega, observaciones)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id_prestamo`,
      [item.id_recurso, item.solicitante_id, item.cantidad, dueAt, req.user.id, condition || null, notes || null]);
      await client.query(`UPDATE recursos_solicitudes SET estado='ENTREGADA', id_prestamo=$2,
        resuelto_por=$3, resuelto_en=COALESCE(resuelto_en,CURRENT_TIMESTAMP), actualizado_en=CURRENT_TIMESTAMP
        WHERE id_solicitud=$1`, [requestId, loan.rows[0].id_prestamo, req.user.id]);
      await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'ENTREGAR_SOLICITUD_RECURSO', entidad: 'recurso_solicitud', entidad_id: requestId,
        detalle: { id_prestamo: loan.rows[0].id_prestamo, id_recurso: item.id_recurso, cantidad: item.cantidad }, ip: getClientIp(req) });
      const notificationCopy = {
        title: 'Recurso listo y entregado',
        detail: `Se registró la entrega de ${item.cantidad} unidad${item.cantidad === 1 ? '' : 'es'} de ${resource.nombre}.`,
        link: '/admin/recursos',
        sender: req.user.nombre || req.user.correo
      };
      const notifications = await insertNotifications(client, {
        userIds: [item.solicitante_id], type: 'SOLICITUD_RECURSO_ENTREGADA', ...notificationCopy,
        dedupe: `recursos:solicitud:${requestId}:entregada`, senderId: req.user.id
      });
      await client.query('COMMIT');
      publishNotifications(realtimeHub, notifications, notificationCopy);
      res.status(201).json({ id_prestamo: loan.rows[0].id_prestamo, message: 'La entrega y el préstamo quedaron registrados.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      publicError(res, error, 'No fue posible registrar la entrega.');
    } finally {
      client.release();
    }
  });

  return router;
};

module.exports = { createResourcesRouter, insertNotifications, lockAvailableResource, isoDate, pageData };
