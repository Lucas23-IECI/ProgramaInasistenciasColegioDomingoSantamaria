const express = require('express');

const { isIsoDate, validateDateRange, validateReason } = require('../utils/validation');
const { registerAuthorizationRoutes } = require('./visits/authorizations');
const { registerWithdrawalRoutes } = require('./visits/withdrawals');
const {
  cleanDocument,
  formatChilePhone,
  maskDocument,
  normalizeVisitorDocument,
  validateVisitorInput
} = require('../utils/visitors');
const {
  buildVisitsMarkdown,
  buildVisitsWorkbook,
  streamVisitsPdf
} = require('../services/visitReportService');
const { protectStudentRecord } = require('../utils/studentPrivacy');

const VISIT_PERMISSIONS = [
  'visits.view',
  'visits.register',
  'visits.checkout',
  'visits.manage',
  'visits.history',
  'withdrawals.register',
  'withdrawals.approve',
  'withdrawals.authorizations',
  'withdrawals.import_guardians',
  'visits.reports',
  'visits.settings'
];

const sanitizeText = (value, max = 500) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const sanitizeEmail = (value) => {
  const email = String(value || '').trim().toLowerCase().slice(0, 160);
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
};
const parsePositiveId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const visitorPayload = (row, { revealDocument = false } = {}) => ({
  id: row.visitante_id || row.id,
  tipo_documento: row.tipo_documento,
  documento: revealDocument ? row.documento_numero : undefined,
  documento_mostrado: revealDocument
    ? (normalizeVisitorDocument(row.tipo_documento, row.documento_numero).value?.formatted || row.documento_numero)
    : maskDocument(row.tipo_documento, row.documento_numero),
  nombre_completo: row.nombre_completo,
  telefono: revealDocument ? formatChilePhone(row.telefono) : undefined,
  email: revealDocument ? row.email || undefined : undefined
});

const findOrCreateVisitor = async (client, input, userId) => {
  const validation = validateVisitorInput(input);
  if (validation.error) {
    const error = new Error(validation.error);
    error.status = 400;
    throw error;
  }

  const visitor = validation.value;
  const email = sanitizeEmail(input.email);
  const result = await client.query(
    `INSERT INTO visitantes
      (tipo_documento, documento_numero, nombre_completo, telefono, email, creado_por, actualizado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     ON CONFLICT (tipo_documento, documento_numero) DO UPDATE SET
       nombre_completo = EXCLUDED.nombre_completo,
       telefono = COALESCE(EXCLUDED.telefono, visitantes.telefono),
       email = COALESCE(EXCLUDED.email, visitantes.email),
       actualizado_por = EXCLUDED.actualizado_por,
       actualizado_en = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      visitor.tipo_documento,
      visitor.documento_numero,
      visitor.nombre_completo,
      visitor.telefono,
      email,
      userId
    ]
  );
  return result.rows[0];
};

const visitSelect = `
  SELECT v.id, v.estado, v.origen, v.motivo_codigo, vm.nombre AS motivo_nombre,
         v.motivo_detalle, v.destino_codigo, vd.nombre AS destino_nombre,
         v.persona_contactada, v.observaciones, v.ingreso_en, v.salida_en,
         v.motivo_anulacion, v.registrado_por, v.finalizado_por,
         p.id AS visitante_id, p.tipo_documento, p.documento_numero,
         p.nombre_completo, p.telefono, p.email,
         ur.nombre AS registrado_por_nombre, uf.nombre AS finalizado_por_nombre
  FROM visitas v
  JOIN visitantes p ON p.id = v.visitante_id
  JOIN visita_motivos vm ON vm.codigo = v.motivo_codigo
  JOIN visita_destinos vd ON vd.codigo = v.destino_codigo
  LEFT JOIN usuarios ur ON ur.id = v.registrado_por
  LEFT JOIN usuarios uf ON uf.id = v.finalizado_por
`;

const mapVisit = (row) => ({
  id: row.id,
  estado: row.estado,
  origen: row.origen,
  motivo_codigo: row.motivo_codigo,
  motivo_nombre: row.motivo_nombre,
  motivo_detalle: row.motivo_detalle,
  destino_codigo: row.destino_codigo,
  destino_nombre: row.destino_nombre,
  persona_contactada: row.persona_contactada,
  observaciones: row.observaciones,
  ingreso_en: row.ingreso_en,
  salida_en: row.salida_en,
  motivo_anulacion: row.motivo_anulacion,
  registrado_por_nombre: row.registrado_por_nombre,
  finalizado_por_nombre: row.finalizado_por_nombre,
  visitante: visitorPayload(row)
});

const withdrawalSelect = `
  SELECT r.id, r.estado, r.motivo, r.motivo_codigo, rm.nombre AS motivo_nombre,
         r.motivo_detalle, r.parentesco_declarado_codigo,
         tp.nombre AS parentesco_declarado_nombre, r.parentesco_declarado_detalle,
         r.solicitado_en, r.decidido_en, r.entregado_en,
         r.motivo_decision, r.autorizacion_id,
         a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv,
         a.documento_erp, a.uuid_erp,
         c.nombre_curso,
         p.id AS visitante_id, p.tipo_documento, p.documento_numero,
         p.nombre_completo, p.telefono, p.email,
         pa.parentesco, pa.parentesco_codigo, pa.origen_autorizacion,
         us.nombre AS solicitado_por_nombre, ud.nombre AS decidido_por_nombre,
         ue.nombre AS entregado_por_nombre
  FROM retiros_alumno r
  JOIN alumno a ON a.id_alumno = r.id_alumno
  LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
  LEFT JOIN curso c ON c.id_curso = m.id_curso
  JOIN visitantes p ON p.id = r.visitante_id
  JOIN retiro_motivos rm ON rm.codigo = r.motivo_codigo
  JOIN tipos_parentesco tp ON tp.codigo = r.parentesco_declarado_codigo
  LEFT JOIN personas_autorizadas_retiro pa ON pa.id = r.autorizacion_id
  LEFT JOIN usuarios us ON us.id = r.solicitado_por
  LEFT JOIN usuarios ud ON ud.id = r.decidido_por
  LEFT JOIN usuarios ue ON ue.id = r.entregado_por
`;

const mapWithdrawal = (row) => ({
  id: row.id,
  estado: row.estado,
  motivo: row.motivo,
  motivo_codigo: row.motivo_codigo,
  motivo_nombre: row.motivo_nombre,
  motivo_detalle: row.motivo_detalle,
  parentesco_declarado_codigo: row.parentesco_declarado_codigo,
  parentesco_declarado_nombre: row.parentesco_declarado_nombre,
  parentesco_declarado_detalle: row.parentesco_declarado_detalle,
  solicitado_en: row.solicitado_en,
  decidido_en: row.decidido_en,
  entregado_en: row.entregado_en,
  motivo_decision: row.motivo_decision,
  coincidencia_autorizada: Boolean(row.autorizacion_id),
  autorizacion: row.autorizacion_id ? {
    id: row.autorizacion_id,
    parentesco: row.parentesco,
    parentesco_codigo: row.parentesco_codigo,
    origen: row.origen_autorizacion
  } : null,
  estudiante: protectStudentRecord({
    id_alumno: row.id_alumno,
    nombres: row.nombres,
    paterno: row.paterno,
    materno: row.materno,
    rut: row.rut,
    dv: row.dv,
    documento_erp: row.documento_erp,
    uuid_erp: row.uuid_erp,
    nombre_curso: row.nombre_curso
  }),
  visitante: visitorPayload(row),
  solicitado_por_nombre: row.solicitado_por_nombre,
  decidido_por_nombre: row.decidido_por_nombre,
  entregado_por_nombre: row.entregado_por_nombre
});

const createVisitsRouter = ({
  pool,
  verifyToken,
  verifyPermission,
  verifyAnyPermission,
  insertarAudit,
  getClientIp
}) => {
  const router = express.Router();
  router.use(verifyToken);

  router.get('/catalogos', verifyAnyPermission(VISIT_PERMISSIONS), async (req, res) => {
    try {
      const [reasons, destinations, withdrawalReasons, relationships] = await Promise.all([
        pool.query('SELECT codigo, nombre, requiere_detalle FROM visita_motivos WHERE activo = true ORDER BY orden, nombre'),
        pool.query('SELECT codigo, nombre, requiere_contacto FROM visita_destinos WHERE activo = true ORDER BY orden, nombre'),
        pool.query('SELECT codigo, nombre, requiere_detalle FROM retiro_motivos WHERE activo = true ORDER BY orden, nombre'),
        pool.query('SELECT codigo, nombre, requiere_detalle FROM tipos_parentesco WHERE activo = true ORDER BY orden, nombre')
      ]);
      res.json({
        motivos: reasons.rows,
        destinos: destinations.rows,
        motivos_retiro: withdrawalReasons.rows,
        parentescos: relationships.rows
      });
    } catch (error) {
      console.error('[visitas:catalogos]', error.message);
      res.status(500).json({ message: 'No fue posible cargar la configuración de visitas.' });
    }
  });

  router.get('/resumen', verifyAnyPermission([
    'visits.view',
    'visits.register',
    'visits.history',
    'visits.reports',
    'withdrawals.register',
    'withdrawals.approve',
    'withdrawals.authorizations'
  ]), async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM visitas WHERE estado = 'DENTRO') AS dentro,
          (SELECT COUNT(*)::int FROM visitas WHERE ingreso_en::date = CURRENT_DATE AND estado <> 'ANULADA') AS ingresos_hoy,
          (SELECT COUNT(*)::int FROM visitas WHERE salida_en::date = CURRENT_DATE AND estado = 'FINALIZADA') AS salidas_hoy,
          (SELECT COUNT(*)::int FROM retiros_alumno WHERE estado = 'SOLICITADO') AS retiros_pendientes,
          (SELECT COUNT(*)::int FROM retiros_alumno WHERE entregado_en::date = CURRENT_DATE AND estado = 'ENTREGADO') AS retiros_entregados_hoy
      `);
      res.json(result.rows[0]);
    } catch (error) {
      console.error('[visitas:resumen]', error.message);
      res.status(500).json({ message: 'No fue posible obtener el resumen de visitas.' });
    }
  });

  router.get('/visitantes/buscar', verifyAnyPermission(['visits.register', 'withdrawals.register', 'withdrawals.authorizations']), async (req, res) => {
    const query = sanitizeText(req.query.q, 80);
    if (query.length < 2) return res.json([]);
    const document = cleanDocument(query);
    try {
      const result = await pool.query(
        `SELECT id, tipo_documento, documento_numero, nombre_completo, telefono, email
         FROM visitantes
         WHERE activo = true
           AND (LOWER(nombre_completo) LIKE LOWER($1) OR documento_numero LIKE $2)
         ORDER BY nombre_completo
         LIMIT 12`,
        [`%${query}%`, `%${document}%`]
      );
      res.json(result.rows.map((row) => visitorPayload(row, { revealDocument: true })));
    } catch (error) {
      console.error('[visitas:buscar-visitante]', error.message);
      res.status(500).json({ message: 'No fue posible buscar visitantes.' });
    }
  });

  router.get('/apoderados/buscar', verifyPermission('withdrawals.register'), async (req, res) => {
    const query = sanitizeText(req.query.q, 80);
    if (query.length < 2) return res.json([]);
    const document = cleanDocument(query);
    try {
      const result = await pool.query(
        `SELECT p.id, p.tipo_documento, p.documento_numero, p.nombre_completo,
                p.telefono, p.email,
                COALESCE(
                  JSON_AGG(
                    JSON_BUILD_OBJECT(
                      'autorizacion_id', pa.id,
                      'parentesco', pa.parentesco,
                      'parentesco_codigo', pa.parentesco_codigo,
                      'es_principal', pa.es_principal,
                      'id_alumno', a.id_alumno,
                      'nombres', a.nombres,
                      'paterno', a.paterno,
                      'materno', a.materno,
                      'rut', a.rut,
                      'dv', a.dv,
                      'nombre_curso', c.nombre_curso
                    )
                    ORDER BY a.paterno, a.materno, a.nombres
                  ) FILTER (WHERE pa.id IS NOT NULL),
                  '[]'::json
                ) AS estudiantes
         FROM visitantes p
         JOIN personas_autorizadas_retiro pa
           ON pa.visitante_id = p.id
          AND pa.activo = true
          AND pa.vigente_desde <= CURRENT_DATE
          AND (pa.vigente_hasta IS NULL OR pa.vigente_hasta >= CURRENT_DATE)
         JOIN alumno a ON a.id_alumno = pa.id_alumno AND a.activo = true
         LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
         LEFT JOIN curso c ON c.id_curso = m.id_curso
         WHERE p.activo = true
           AND (
             LOWER(p.nombre_completo) LIKE LOWER($1)
             OR p.documento_numero LIKE $2
           )
         GROUP BY p.id
         ORDER BY p.nombre_completo
         LIMIT 12`,
        [`%${query}%`, `%${document}%`]
      );
      res.json(result.rows.map((row) => ({
        ...visitorPayload(row, { revealDocument: true }),
        estudiantes: (row.estudiantes || []).map((student) => protectStudentRecord(student))
      })));
    } catch (error) {
      console.error('[retiros:buscar-apoderado]', error.message);
      res.status(500).json({ message: 'No fue posible consultar la ficha de apoderados.' });
    }
  });

  router.get('/estudiantes/buscar', verifyAnyPermission(['withdrawals.register', 'withdrawals.approve', 'withdrawals.authorizations']), async (req, res) => {
    const query = sanitizeText(req.query.q, 80);
    if (query.length < 2) return res.json([]);
    const document = cleanDocument(query);
    const body = document.replace(/[0-9K]$/, '');
    try {
      const result = await pool.query(
        `SELECT a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv,
                a.documento_erp, a.uuid_erp,
                c.nombre_curso
         FROM alumno a
         LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
         LEFT JOIN curso c ON c.id_curso = m.id_curso
         WHERE a.activo = true
           AND (
             LOWER(CONCAT_WS(' ', a.nombres, a.paterno, a.materno)) LIKE LOWER($1)
             OR a.rut LIKE $2
             OR CONCAT(a.rut, a.dv) LIKE $3
             OR LOWER(COALESCE(a.documento_erp, '')) LIKE LOWER($1)
             OR LOWER(COALESCE(a.uuid_erp, '')) LIKE LOWER($1)
           )
         ORDER BY a.paterno, a.materno, a.nombres
         LIMIT 15`,
        [`%${query}%`, `%${body || document}%`, `%${document}%`]
      );
      res.json(result.rows.map((student) => protectStudentRecord(student)));
    } catch (error) {
      console.error('[visitas:buscar-estudiante]', error.message);
      res.status(500).json({ message: 'No fue posible buscar estudiantes.' });
    }
  });

  router.get('/', verifyAnyPermission(['visits.view', 'visits.history', 'visits.reports']), async (req, res) => {
    const {
      estado = '',
      q = '',
      desde = '',
      hasta = '',
      motivo_codigo: motiveCode = '',
      id = '',
      page = '1',
      limit = '30'
    } = req.query;
    const requestedId = id ? parsePositiveId(id) : null;
    if (id && !requestedId) {
      return res.status(400).json({ message: 'La visita indicada no es válida.' });
    }
    if ((desde && !isIsoDate(desde)) || (hasta && !isIsoDate(hasta))) {
      return res.status(400).json({ message: 'El período indicado no es válido.' });
    }
    if (desde && hasta) {
      const range = validateDateRange(desde, hasta, { maxDays: 366 });
      if (range.error) return res.status(400).json({ message: range.error });
    }

    const pageNumber = Math.max(1, Number(page) || 1);
    const limitNumber = Math.min(100, Math.max(1, Number(limit) || 30));
    const conditions = [];
    const params = [];
    let index = 1;

    if (requestedId) {
      conditions.push(`v.id = $${index++}`);
      params.push(requestedId);
    }

    if (estado) {
      conditions.push(`v.estado = $${index++}`);
      params.push(String(estado).toUpperCase());
    }
    if (q) {
      const search = sanitizeText(q, 80);
      const document = cleanDocument(search);
      conditions.push(`(
        p.nombre_completo ILIKE $${index}
        OR p.documento_numero LIKE $${index + 1}
        OR vd.nombre ILIKE $${index}
        OR COALESCE(v.persona_contactada, '') ILIKE $${index}
      )`);
      params.push(`%${search}%`, `%${document}%`);
      index += 2;
    }
    if (desde) {
      conditions.push(`v.ingreso_en >= $${index++}::date`);
      params.push(desde);
    }
    if (hasta) {
      conditions.push(`v.ingreso_en < ($${index++}::date + interval '1 day')`);
      params.push(hasta);
    }
    if (motiveCode) {
      conditions.push(`v.motivo_codigo = $${index++}`);
      params.push(sanitizeText(motiveCode, 40).toUpperCase());
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      const [countResult, dataResult] = await Promise.all([
        pool.query(`SELECT COUNT(*) FROM visitas v JOIN visitantes p ON p.id = v.visitante_id JOIN visita_destinos vd ON vd.codigo = v.destino_codigo ${where}`, params),
        pool.query(
          `${visitSelect}
           ${where}
           ORDER BY CASE WHEN v.estado = 'DENTRO' THEN 0 ELSE 1 END, v.ingreso_en DESC
           LIMIT $${index++} OFFSET $${index++}`,
          [...params, limitNumber, (pageNumber - 1) * limitNumber]
        )
      ]);
      const total = Number(countResult.rows[0].count);
      res.json({
        total,
        page: pageNumber,
        pages: Math.max(1, Math.ceil(total / limitNumber)),
        rows: dataResult.rows.map(mapVisit)
      });
    } catch (error) {
      console.error('[visitas:listar]', error.message);
      res.status(500).json({ message: 'No fue posible obtener las visitas.' });
    }
  });

  router.post('/', verifyPermission('visits.register'), async (req, res) => {
    const motive = sanitizeText(req.body?.motivo_codigo, 40).toUpperCase();
    const destination = sanitizeText(req.body?.destino_codigo, 40).toUpperCase();
    const motiveDetail = sanitizeText(req.body?.motivo_detalle, 500);
    const contactedPerson = sanitizeText(req.body?.persona_contactada, 160);
    const observations = sanitizeText(req.body?.observaciones, 500);
    const origin = String(req.body?.origen || 'MANUAL').toUpperCase() === 'LECTOR' ? 'LECTOR' : 'MANUAL';
    const expectedExit = req.body?.salida_esperada_en ? new Date(req.body.salida_esperada_en) : null;

    if (!motive || !destination) return res.status(400).json({ message: 'Selecciona el motivo y el destino de la visita.' });
    if (expectedExit && (!Number.isFinite(expectedExit.getTime()) || expectedExit <= new Date())) {
      return res.status(400).json({ message: 'La salida estimada debe ser una fecha y hora futura.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const motiveConfig = await client.query(
        'SELECT nombre, requiere_detalle FROM visita_motivos WHERE codigo = $1 AND activo = true',
        [motive]
      );
      if (!motiveConfig.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'El motivo seleccionado ya no está disponible.' });
      }
      if (motiveConfig.rows[0].requiere_detalle && motiveDetail.length < 3) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Describe brevemente el motivo de la visita.' });
      }

      const destinationConfig = await client.query(
        'SELECT nombre, requiere_contacto FROM visita_destinos WHERE codigo = $1 AND activo = true',
        [destination]
      );
      if (!destinationConfig.rows.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'El destino seleccionado ya no está disponible.' });
      }
      if (destinationConfig.rows[0].requiere_contacto && contactedPerson.length < 3) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Indica la persona o unidad que recibirá la visita.' });
      }

      const visitor = await findOrCreateVisitor(client, req.body?.visitante, req.user.id);
      const accessRestriction = await client.query(
        `SELECT tipo
         FROM visita_restricciones_acceso
         WHERE visitante_id = $1
           AND activo = true
           AND tipo IN ('BLOQUEO', 'REQUIERE_AUTORIZACION')
           AND vigente_desde <= CURRENT_TIMESTAMP
           AND (vigente_hasta IS NULL OR vigente_hasta >= CURRENT_TIMESTAMP)
         ORDER BY CASE tipo WHEN 'BLOQUEO' THEN 0 ELSE 1 END, creado_en DESC
         LIMIT 1`,
        [visitor.id]
      );
      if (accessRestriction.rows.length) {
        await client.query('ROLLBACK');
        const isBlocked = accessRestriction.rows[0].tipo === 'BLOQUEO';
        return res.status(409).json({
          code: isBlocked ? 'VISITOR_ACCESS_BLOCKED' : 'VISITOR_AUTHORIZATION_REQUIRED',
          message: isBlocked
            ? 'Esta persona tiene un bloqueo de acceso vigente. Inspectoría debe resolverlo.'
            : 'Esta persona requiere autorización de Inspectoría antes de registrar su ingreso.'
        });
      }
      const active = await client.query(
        "SELECT id FROM visitas WHERE visitante_id = $1 AND estado = 'DENTRO' FOR UPDATE",
        [visitor.id]
      );
      if (active.rows.length) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'Esta persona ya tiene una visita activa.' });
      }

      const result = await client.query(
        `INSERT INTO visitas
          (visitante_id, motivo_codigo, motivo_detalle, destino_codigo,
           persona_contactada, observaciones, origen, registrado_por, salida_esperada_en)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [visitor.id, motive, motiveDetail || null, destination, contactedPerson || null,
          observations || null, origin, req.user.id, expectedExit?.toISOString() || null]
      );
      const visitId = result.rows[0].id;
      await client.query(
        `INSERT INTO visita_eventos (visita_id, accion, detalle, realizado_por)
         VALUES ($1, 'REGISTRAR_ENTRADA', $2, $3)`,
        [visitId, JSON.stringify({ origen: origin, destino: destination }), req.user.id]
      );
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'REGISTRAR_VISITA',
        entidad: 'visita',
        entidad_id: visitId,
        detalle: {
          visitante_id: visitor.id,
          documento: maskDocument(visitor.tipo_documento, visitor.documento_numero),
          destino: destination,
          motivo: motive,
          origen: origin,
          salida_esperada_en: expectedExit?.toISOString() || null
        },
        ip: getClientIp(req)
      });
      const created = await client.query(`${visitSelect} WHERE v.id = $1`, [visitId]);
      await client.query('COMMIT');
      res.status(201).json(mapVisit(created.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[visitas:registrar]', error.message);
      if (error.code === '23503') return res.status(400).json({ message: 'El motivo o destino seleccionado ya no está disponible.' });
      if (error.code === '23505') return res.status(409).json({ message: 'Esta persona ya tiene una visita activa.' });
      res.status(error.status || 500).json({ message: error.status ? error.message : 'No fue posible registrar la visita.' });
    } finally {
      client.release();
    }
  });

  router.patch('/:id/salida', verifyPermission('visits.checkout'), async (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) return res.status(400).json({ message: 'La visita indicada no es válida.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM visitas WHERE id = $1 FOR UPDATE', [id]);
      if (!locked.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'La visita indicada no existe.' });
      }
      if (locked.rows[0].estado !== 'DENTRO') {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'La visita ya no se encuentra activa.' });
      }
      await client.query(
        `UPDATE visitas
         SET estado = 'FINALIZADA', salida_en = CURRENT_TIMESTAMP,
             finalizado_por = $2, actualizado_en = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, req.user.id]
      );
      await client.query(
        `INSERT INTO visita_eventos (visita_id, accion, realizado_por)
         VALUES ($1, 'REGISTRAR_SALIDA', $2)`,
        [id, req.user.id]
      );
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'REGISTRAR_SALIDA_VISITA',
        entidad: 'visita',
        entidad_id: id,
        detalle: { estado_anterior: 'DENTRO', estado_nuevo: 'FINALIZADA' },
        ip: getClientIp(req)
      });
      const updated = await client.query(`${visitSelect} WHERE v.id = $1`, [id]);
      await client.query('COMMIT');
      res.json(mapVisit(updated.rows[0]));
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[visitas:salida]', error.message);
      res.status(500).json({ message: 'No fue posible registrar la salida.' });
    } finally {
      client.release();
    }
  });

  router.patch('/:id/anular', verifyPermission('visits.manage'), async (req, res) => {
    const id = parsePositiveId(req.params.id);
    const reason = validateReason(req.body?.motivo, { min: 8, max: 500 });
    if (!id) return res.status(400).json({ message: 'La visita indicada no es válida.' });
    if (reason.error) return res.status(400).json({ message: reason.error });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT * FROM visitas WHERE id = $1 FOR UPDATE', [id]);
      if (!locked.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'La visita indicada no existe.' });
      }
      if (['ANULADA', 'RECHAZADA'].includes(locked.rows[0].estado)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'La visita ya fue anulada o rechazada.' });
      }
      await client.query(
        `UPDATE visitas
         SET estado = 'ANULADA', salida_en = COALESCE(salida_en, CURRENT_TIMESTAMP),
             anulado_por = $2, motivo_anulacion = $3, actualizado_en = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [id, req.user.id, reason.value]
      );
      await client.query(
        `INSERT INTO visita_eventos (visita_id, accion, detalle, realizado_por)
         VALUES ($1, 'ANULAR', $2, $3)`,
        [id, JSON.stringify({ motivo: reason.value, estado_anterior: locked.rows[0].estado }), req.user.id]
      );
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'ANULAR_VISITA',
        entidad: 'visita',
        entidad_id: id,
        detalle: { motivo: reason.value, estado_anterior: locked.rows[0].estado },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: 'Visita anulada con trazabilidad.' });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[visitas:anular]', error.message);
      res.status(500).json({ message: 'No fue posible anular la visita.' });
    } finally {
      client.release();
    }
  });

  const routeContext = {
    router,
    pool,
    verifyPermission,
    verifyAnyPermission,
    insertarAudit,
    getClientIp,
    sanitizeText,
    parsePositiveId,
    findOrCreateVisitor,
    visitorPayload,
    visitSelect,
    mapVisit,
    withdrawalSelect,
    mapWithdrawal,
    isIsoDate,
    validateDateRange,
    cleanDocument,
    maskDocument,
    normalizeVisitorDocument,
    buildVisitsMarkdown,
    buildVisitsWorkbook,
    streamVisitsPdf
  };
  registerAuthorizationRoutes(routeContext);
  registerWithdrawalRoutes(routeContext);

  return router;
};

module.exports = {
  VISIT_PERMISSIONS,
  createVisitsRouter
};
