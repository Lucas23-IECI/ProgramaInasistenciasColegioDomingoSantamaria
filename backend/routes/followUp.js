const express = require('express');
const fs = require('fs');
const { createDocument, removeStoredFile, resolveDocumentPath } = require('../services/documentService');
const {
  previewInstitutionalFollowUp,
  runInstitutionalFollowUp
} = require('../services/institutionalFollowUpService');

const STATES = new Set(['ABIERTO', 'ASIGNADO', 'EN_CONTACTO', 'EN_SEGUIMIENTO', 'ESCALADO', 'RESUELTO', 'CERRADO', 'ANULADO']);
const PRIORITIES = new Set(['BAJA', 'MEDIA', 'ALTA', 'URGENTE']);
const TASK_STATES = new Set(['PENDIENTE', 'EN_PROGRESO', 'COMPLETADA', 'CANCELADA']);
const CONTACT_TYPES = new Set(['LLAMADA', 'MENSAJE', 'CORREO', 'ENTREVISTA', 'REUNION', 'OTRO']);
const CONTACT_RESULTS = new Set(['CONTACTADO', 'SIN_RESPUESTA', 'REPROGRAMADO', 'RECHAZADO', 'ACUERDO', 'OTRO']);
const AGREEMENT_STATES = new Set(['VIGENTE', 'CUMPLIDO', 'INCUMPLIDO', 'ANULADO']);
const clean = (value, max = 300) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const narrative = (value, max = 12000) => String(value || '').trim().slice(0, max);
const id = (value) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const isoDate = (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value));

const safeError = (res, error, fallback) => {
  const status = error.statusCode || (error.code === '23505' ? 409 : 500);
  if (status >= 500) console.error('[seguimiento]', error.message);
  res.status(status).json({ message: status >= 500 ? fallback : error.message });
};

const loadCase = async (queryable, caseId, lock = false) => {
  const result = await queryable.query(`
    SELECT c.*, trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante,
           cr.nombre_curso, u.nombre AS responsable_nombre, u.correo AS responsable_correo,
           r.nombre AS regla_nombre
    FROM seguimiento_casos c
    LEFT JOIN alumno a ON a.id_alumno = c.estudiante_principal_id
    LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
    LEFT JOIN curso cr ON cr.id_curso = m.id_curso
    LEFT JOIN usuarios u ON u.id = c.responsable_usuario_id
    LEFT JOIN seguimiento_reglas r ON r.codigo = c.regla_codigo
    WHERE c.id_caso = $1 ${lock ? 'FOR UPDATE OF c' : ''}
  `, [caseId]);
  if (!result.rowCount) {
    const error = new Error('El seguimiento no existe.');
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
};

const addEvent = (client, { caseId, type, title, detail = null, metadata = {}, userId = null }) => client.query(`
  INSERT INTO seguimiento_eventos (id_caso, tipo, titulo, detalle, metadatos, realizado_por)
  VALUES ($1, $2, $3, $4, $5::jsonb, $6)
`, [caseId, type, title, detail, JSON.stringify(metadata), userId]);

const createFollowUpRouter = ({ pool, verifyToken, verifyPermission, verifyAnyPermission, insertarAudit, getClientIp }) => {
  const router = express.Router();
  router.use(verifyToken);
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  router.get('/resumen', verifyPermission('seguimiento.view'), async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT COUNT(*) FILTER (WHERE estado NOT IN ('CERRADO', 'ANULADO'))::int AS activos,
               COUNT(*) FILTER (WHERE estado NOT IN ('CERRADO', 'ANULADO') AND prioridad IN ('ALTA', 'URGENTE'))::int AS prioritarios,
               COUNT(*) FILTER (WHERE estado NOT IN ('CERRADO', 'ANULADO') AND fecha_limite < CURRENT_DATE)::int AS vencidos,
               COUNT(*) FILTER (WHERE responsable_usuario_id IS NULL AND estado NOT IN ('CERRADO', 'ANULADO'))::int AS sin_responsable,
               COUNT(*) FILTER (WHERE estado IN ('CERRADO', 'ANULADO') AND cerrado_en >= date_trunc('month', CURRENT_TIMESTAMP))::int AS cerrados_mes
        FROM seguimiento_casos
      `);
      const signals = await pool.query('SELECT COUNT(*)::int AS activas FROM seguimiento_senales WHERE activa = true');
      res.json({ ...result.rows[0], senales_activas: signals.rows[0].activas });
    } catch (error) { safeError(res, error, 'No fue posible cargar el resumen de seguimiento.'); }
  });

  router.get('/personas', verifyPermission('seguimiento.view'), async (req, res) => {
    const q = clean(req.query.q, 100);
    try {
      const result = await pool.query(`
        SELECT u.id, COALESCE(NULLIF(u.nombre, ''), u.correo) AS nombre, u.correo,
               COALESCE(NULLIF(u.cargo, ''), p.nombre, 'Personal') AS cargo
        FROM usuarios u LEFT JOIN perfiles_acceso p ON p.codigo = u.rol
        WHERE u.activo = true AND u.eliminado_en IS NULL
          AND ($1 = '' OR COALESCE(u.nombre, '') ILIKE '%' || $1 || '%' OR u.correo ILIKE '%' || $1 || '%')
        ORDER BY lower(COALESCE(NULLIF(u.nombre, ''), u.correo)) LIMIT 40
      `, [q]);
      res.json(result.rows);
    } catch (error) { safeError(res, error, 'No fue posible cargar el equipo institucional.'); }
  });

  router.get('/estudiantes', verifyPermission('seguimiento.view'), async (req, res) => {
    const q = clean(req.query.q, 100);
    if (q.length < 2) return res.json([]);
    try {
      const result = await pool.query(`
        SELECT a.id_alumno, trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS nombre,
               COALESCE(c.nombre_curso, 'Sin curso') AS curso,
               COALESCE(ai.valor_original, concat_ws('-', a.rut, a.dv), a.uuid_erp) AS identificador
        FROM alumno a
        LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
        LEFT JOIN curso c ON c.id_curso = m.id_curso
        LEFT JOIN LATERAL (
          SELECT valor_original FROM alumno_identificador
          WHERE id_alumno = a.id_alumno AND estado <> 'REVOCADO'
          ORDER BY es_principal DESC, actualizado_en DESC LIMIT 1
        ) ai ON true
        WHERE a.activo = true AND a.fusionado_en_id IS NULL
          AND (trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) ILIKE '%' || $1 || '%'
               OR COALESCE(ai.valor_normalizado, '') ILIKE '%' || regexp_replace(upper($1), '[^0-9A-Z]', '', 'g') || '%')
        ORDER BY a.paterno, a.materno, a.nombres LIMIT 30
      `, [q]);
      res.json(result.rows);
    } catch (error) { safeError(res, error, 'No fue posible buscar estudiantes.'); }
  });

  router.get('/reglas', verifyPermission('seguimiento.view'), async (_req, res) => {
    try {
      const result = await pool.query('SELECT * FROM seguimiento_reglas ORDER BY tipo_senal, nombre');
      res.json(result.rows);
    } catch (error) { safeError(res, error, 'No fue posible cargar las reglas.'); }
  });

  router.get('/configuracion', verifyPermission('seguimiento.automation.manage'), async (_req, res) => {
    try {
      const [configuration, rules, profiles, escalationGroups, escalationLinks] = await Promise.all([
        pool.query('SELECT * FROM seguimiento_configuracion WHERE id_configuracion = 1'),
        pool.query('SELECT * FROM seguimiento_reglas ORDER BY tipo_senal, nombre'),
        pool.query(`SELECT codigo, nombre FROM perfiles_acceso WHERE activo = true ORDER BY orden, nombre`),
        pool.query(`
          SELECT g.codigo, g.nombre, g.descripcion, g.orden,
                 COALESCE(json_agg(DISTINCT jsonb_build_object('codigo', p.codigo, 'nombre', p.nombre))
                   FILTER (WHERE p.codigo IS NOT NULL), '[]'::json) AS perfiles,
                 COUNT(DISTINCT u.id) FILTER (WHERE u.activo = true AND u.eliminado_en IS NULL)::int AS cuentas_activas
          FROM seguimiento_grupos_notificacion g
          LEFT JOIN seguimiento_grupo_perfiles gp ON gp.grupo_codigo = g.codigo
          LEFT JOIN perfiles_acceso p ON p.codigo = gp.perfil_codigo
          LEFT JOIN usuarios u ON u.rol = p.codigo
          WHERE g.activo = true
          GROUP BY g.codigo
          ORDER BY g.orden, g.nombre
        `),
        pool.query('SELECT regla_codigo, grupo_codigo FROM seguimiento_regla_escalamiento_grupos')
      ]);
      const groupsByRule = escalationLinks.rows.reduce((map, row) => {
        if (!map.has(row.regla_codigo)) map.set(row.regla_codigo, []);
        map.get(row.regla_codigo).push(row.grupo_codigo);
        return map;
      }, new Map());
      res.json({
        configuration: configuration.rows[0],
        rules: rules.rows.map((rule) => ({
          ...rule,
          escalamiento_grupos: groupsByRule.get(rule.codigo) || []
        })),
        profiles: profiles.rows,
        escalation_groups: escalationGroups.rows
      });
    } catch (error) { safeError(res, error, 'No fue posible cargar la configuración de seguimiento.'); }
  });

  router.patch('/configuracion', verifyPermission('seguimiento.automation.manage'), async (req, res) => {
    const interval = Number(req.body.intervalo_minutos);
    if (!Number.isInteger(interval) || interval < 5 || interval > 1440) {
      return res.status(400).json({ message: 'El intervalo debe estar entre 5 minutos y 24 horas.' });
    }
    try {
      const result = await pool.query(`
        UPDATE seguimiento_configuracion SET
          automatizacion_activa = $1, intervalo_minutos = $2,
          asignacion_automatica = $3, escalamiento_automatico = $4,
          notificaciones_activas = $5, actualizada_por = $6,
          actualizada_en = CURRENT_TIMESTAMP
        WHERE id_configuracion = 1 RETURNING *
      `, [Boolean(req.body.automatizacion_activa), interval,
        Boolean(req.body.asignacion_automatica), Boolean(req.body.escalamiento_automatico),
        Boolean(req.body.notificaciones_activas), req.user.id]);
      await insertarAudit(pool, {
        usuario_id: req.user.id, usuario_correo: req.user.correo,
        accion: 'CONFIGURAR_SEGUIMIENTO_AUTOMATICO', entidad: 'seguimiento_configuracion',
        entidad_id: 1, detalle: result.rows[0], ip: getClientIp(req)
      });
      res.json(result.rows[0]);
    } catch (error) { safeError(res, error, 'No fue posible guardar la configuración de seguimiento.'); }
  });

  router.patch('/reglas/:code', verifyPermission('seguimiento.automation.manage'), async (req, res) => {
    const priority = String(req.body.prioridad || '').toUpperCase();
    const threshold = Number(req.body.umbral);
    const windowDays = req.body.ventana_dias === null ? null : Number(req.body.ventana_dias);
    const dueDays = Number(req.body.plazo_dias);
    const escalationDays = req.body.escalamiento_dias === null ? null : Number(req.body.escalamiento_dias);
    const escalationGroups = [...new Set((Array.isArray(req.body.escalamiento_grupos) ? req.body.escalamiento_grupos : [])
      .map((value) => clean(value, 64)).filter(Boolean))];
    const responsibleProfile = clean(req.body.responsable_perfil_codigo, 64) || null;
    if (!PRIORITIES.has(priority) || !Number.isInteger(threshold) || threshold < 1 || !Number.isInteger(dueDays) || dueDays < 1 || (windowDays !== null && (!Number.isInteger(windowDays) || windowDays < 1)) || (escalationDays !== null && (!Number.isInteger(escalationDays) || escalationDays < 0))) {
      return res.status(400).json({ message: 'Revisa el umbral, período, prioridad y plazo.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (responsibleProfile) {
        const profile = await client.query('SELECT 1 FROM perfiles_acceso WHERE codigo = $1 AND activo = true', [responsibleProfile]);
        if (!profile.rowCount) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'El perfil responsable no está disponible.' });
        }
      }
      if (escalationGroups.length) {
        const available = await client.query(
          'SELECT codigo FROM seguimiento_grupos_notificacion WHERE activo = true AND codigo = ANY($1::varchar[])',
          [escalationGroups]
        );
        if (available.rowCount !== escalationGroups.length) {
          await client.query('ROLLBACK');
          return res.status(400).json({ message: 'Uno de los equipos de escalamiento no está disponible.' });
        }
      }
      const result = await client.query(`
        UPDATE seguimiento_reglas SET umbral = $2, ventana_dias = $3, prioridad = $4,
          plazo_dias = $5, activa = $6, actualizada_en = CURRENT_TIMESTAMP, actualizada_por = $7,
          responsable_perfil_codigo = $8, escalamiento_dias = $9,
          notificar_responsable = $10
        WHERE codigo = $1 RETURNING *
      `, [req.params.code, threshold, windowDays, priority, dueDays, Boolean(req.body.activa), req.user.id,
        responsibleProfile, escalationDays, Boolean(req.body.notificar_responsable)]);
      if (!result.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'La regla no existe.' });
      }
      await client.query('DELETE FROM seguimiento_regla_escalamiento_grupos WHERE regla_codigo = $1', [req.params.code]);
      for (const groupCode of escalationGroups) {
        await client.query(`
          INSERT INTO seguimiento_regla_escalamiento_grupos (regla_codigo, grupo_codigo)
          VALUES ($1, $2)
        `, [req.params.code, groupCode]);
      }
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'EDITAR_REGLA_SEGUIMIENTO',
        entidad: 'seguimiento_regla',
        entidad_id: null,
        detalle: { codigo: req.params.code, escalamiento_grupos: escalationGroups },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      safeError(res, error, 'No fue posible actualizar la regla.');
    } finally { client.release(); }
  });

  router.post('/automatizaciones/ejecutar', verifyPermission('seguimiento.automation.manage'), async (req, res) => {
    try {
      const result = await runInstitutionalFollowUp(pool, { actorId: req.user.id });
      await insertarAudit(pool, { usuario_id: req.user.id, usuario_correo: req.user.correo, accion: 'EJECUTAR_SEGUIMIENTO_AUTOMATICO', entidad: 'seguimiento', entidad_id: null, detalle: result, ip: getClientIp(req) });
      res.json(result);
    } catch (error) { safeError(res, error, 'No fue posible ejecutar la revisión automática.'); }
  });

  router.get('/automatizaciones/previsualizar', verifyPermission('seguimiento.automation.manage'), async (_req, res) => {
    try {
      res.json(await previewInstitutionalFollowUp(pool));
    } catch (error) { safeError(res, error, 'No fue posible previsualizar la revisión automática.'); }
  });

  router.get('/notificaciones', verifyPermission('seguimiento.view'), async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT * FROM notificaciones_internas
        WHERE usuario_id = $1 AND modulo = 'SEGUIMIENTO'
        ORDER BY creada_en DESC LIMIT 50
      `, [req.user.id]);
      res.json(result.rows);
    } catch (error) { safeError(res, error, 'No fue posible cargar las notificaciones de seguimiento.'); }
  });

  router.patch('/notificaciones/:notificationId/leer', verifyPermission('seguimiento.view'), async (req, res) => {
    try {
      const result = await pool.query(`
        UPDATE notificaciones_internas SET leida_en = COALESCE(leida_en, CURRENT_TIMESTAMP)
        WHERE id_notificacion = $1 AND usuario_id = $2 AND modulo = 'SEGUIMIENTO'
        RETURNING *
      `, [id(req.params.notificationId), req.user.id]);
      if (!result.rowCount) return res.status(404).json({ message: 'La notificación no existe.' });
      res.json(result.rows[0]);
    } catch (error) { safeError(res, error, 'No fue posible actualizar la notificación.'); }
  });

  router.get('/casos', verifyPermission('seguimiento.view'), async (req, res) => {
    const q = clean(req.query.q, 120);
    const state = STATES.has(String(req.query.estado || '').toUpperCase()) ? String(req.query.estado).toUpperCase() : null;
    const priority = PRIORITIES.has(String(req.query.prioridad || '').toUpperCase()) ? String(req.query.prioridad).toUpperCase() : null;
    const owner = id(req.query.responsable);
    const overdue = String(req.query.vencidos || '').toLowerCase() === 'true';
    const unassigned = String(req.query.sin_responsable || '').toLowerCase() === 'true';
    const page = Math.max(1, Number(req.query.pagina) || 1);
    const limit = Math.min(100, Math.max(10, Number(req.query.limite) || 30));
    try {
      const values = [q, state, priority, owner, overdue, unassigned, limit, (page - 1) * limit];
      const base = `
        FROM seguimiento_casos c
        LEFT JOIN alumno a ON a.id_alumno = c.estudiante_principal_id
        LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
        LEFT JOIN curso cr ON cr.id_curso = m.id_curso
        LEFT JOIN usuarios u ON u.id = c.responsable_usuario_id
        LEFT JOIN seguimiento_tareas t ON t.id_caso = c.id_caso
        WHERE ($1 = '' OR c.titulo ILIKE '%' || $1 || '%' OR c.motivo_apertura ILIKE '%' || $1 || '%'
               OR trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) ILIKE '%' || $1 || '%')
          AND ($2::varchar IS NULL OR c.estado = $2)
          AND ($3::varchar IS NULL OR c.prioridad = $3)
          AND ($4::int IS NULL OR c.responsable_usuario_id = $4)
          AND ($5::boolean = false OR (c.estado NOT IN ('CERRADO', 'ANULADO') AND c.fecha_limite < CURRENT_DATE))
          AND ($6::boolean = false OR (c.estado NOT IN ('CERRADO', 'ANULADO') AND c.responsable_usuario_id IS NULL))`;
      const [rows, count] = await Promise.all([
        pool.query(`SELECT c.*, trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante,
          cr.nombre_curso, u.nombre AS responsable_nombre,
          COUNT(*) FILTER (WHERE t.estado NOT IN ('COMPLETADA', 'CANCELADA'))::int AS tareas_pendientes
          ${base}
          GROUP BY c.id_caso, a.nombres, a.paterno, a.materno, cr.nombre_curso, u.nombre
          ORDER BY CASE c.prioridad WHEN 'URGENTE' THEN 1 WHEN 'ALTA' THEN 2 WHEN 'MEDIA' THEN 3 ELSE 4 END,
                   (c.fecha_limite IS NULL), c.fecha_limite, c.actualizado_en DESC
          LIMIT $7 OFFSET $8`, values),
        pool.query(`SELECT COUNT(DISTINCT c.id_caso)::int AS total ${base}`, values.slice(0, 6))
      ]);
      res.json({ cases: rows.rows, total: count.rows[0].total, page, limit });
    } catch (error) { safeError(res, error, 'No fue posible cargar los seguimientos.'); }
  });

  router.post('/casos', verifyPermission('seguimiento.create'), async (req, res) => {
    const studentId = id(req.body.estudiante_id);
    const title = clean(req.body.titulo, 180);
    const reason = narrative(req.body.motivo_apertura, 5000);
    const priority = String(req.body.prioridad || 'MEDIA').toUpperCase();
    const dueDate = req.body.fecha_limite || null;
    if (title.length < 4 || reason.length < 8 || !PRIORITIES.has(priority) || !isoDate(dueDate)) return res.status(400).json({ message: 'Completa título, motivo, prioridad y fecha límite válidos.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (studentId) {
        const exists = await client.query('SELECT 1 FROM alumno WHERE id_alumno = $1 AND activo = true', [studentId]);
        if (!exists.rowCount) {
          const error = new Error('El estudiante no está disponible.');
          error.statusCode = 404;
          throw error;
        }
      }
      const created = await client.query(`
        INSERT INTO seguimiento_casos (titulo, motivo_apertura, origen, prioridad, estudiante_principal_id,
          responsable_usuario_id, fecha_limite, creado_por, actualizado_por)
        VALUES ($1, $2, 'MANUAL', $3, $4, $5, $6, $7, $7) RETURNING id_caso
      `, [title, reason, priority, studentId, id(req.body.responsable_usuario_id), dueDate, req.user.id]);
      const caseId = created.rows[0].id_caso;
      if (studentId) await client.query(`INSERT INTO seguimiento_caso_estudiantes (id_caso, id_alumno, relacion, agregado_por) VALUES ($1,$2,'PRINCIPAL',$3)`, [caseId, studentId, req.user.id]);
      await addEvent(client, { caseId, type: 'APERTURA_MANUAL', title: 'Seguimiento abierto manualmente', detail: reason, userId: req.user.id });
      await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo, accion: 'CREAR_SEGUIMIENTO', entidad: 'seguimiento_caso', entidad_id: caseId, detalle: { prioridad: priority, estudiante_id: studentId }, ip: getClientIp(req) });
      await client.query('COMMIT');
      res.status(201).json(await loadCase(pool, caseId));
    } catch (error) { await client.query('ROLLBACK'); safeError(res, error, 'No fue posible crear el seguimiento.'); } finally { client.release(); }
  });

  router.get('/casos/:caseId', verifyPermission('seguimiento.view'), async (req, res) => {
    try {
      const caseId = id(req.params.caseId);
      const item = await loadCase(pool, caseId);
      const [students, tasks, notes, contacts, agreements, documents, timeline] = await Promise.all([
        pool.query(`SELECT ce.*, trim(concat_ws(' ', a.nombres,a.paterno,a.materno)) AS nombre, cr.nombre_curso FROM seguimiento_caso_estudiantes ce JOIN alumno a ON a.id_alumno=ce.id_alumno LEFT JOIN matricula_actual m ON m.id_alumno=a.id_alumno LEFT JOIN curso cr ON cr.id_curso=m.id_curso WHERE ce.id_caso=$1 ORDER BY ce.relacion, nombre`, [caseId]),
        pool.query(`SELECT t.*, u.nombre AS responsable_nombre FROM seguimiento_tareas t LEFT JOIN usuarios u ON u.id=t.responsable_usuario_id WHERE t.id_caso=$1 ORDER BY CASE t.estado WHEN 'PENDIENTE' THEN 1 WHEN 'EN_PROGRESO' THEN 2 ELSE 3 END, t.fecha_limite, t.creada_en`, [caseId]),
        pool.query(`SELECT n.*, u.nombre AS autor_nombre FROM seguimiento_notas n JOIN usuarios u ON u.id=n.creada_por WHERE n.id_caso=$1 ORDER BY n.creada_en DESC`, [caseId]),
        pool.query(`SELECT c.*, u.nombre AS registrado_por_nombre FROM seguimiento_contactos c JOIN usuarios u ON u.id=c.registrado_por WHERE c.id_caso=$1 ORDER BY c.realizado_en DESC`, [caseId]),
        pool.query(`SELECT a.*, u.nombre AS registrado_por_nombre FROM seguimiento_acuerdos a JOIN usuarios u ON u.id=a.registrado_por WHERE a.id_caso=$1 ORDER BY a.registrado_en DESC`, [caseId]),
        pool.query(`SELECT sd.*, d.nombre_original,d.mime_type,d.tamano_bytes,d.fecha_creacion,u.nombre AS creado_por_nombre FROM seguimiento_documentos sd JOIN justification_documents d ON d.id_documento=sd.id_documento LEFT JOIN usuarios u ON u.id=sd.creado_por WHERE sd.id_caso=$1 AND sd.activo=true ORDER BY sd.creado_en DESC`, [caseId]),
        pool.query(`SELECT e.*, u.nombre AS realizado_por_nombre FROM seguimiento_eventos e LEFT JOIN usuarios u ON u.id=e.realizado_por WHERE e.id_caso=$1 ORDER BY e.realizado_en DESC,e.id_evento DESC`, [caseId])
      ]);
      res.json({ ...item, students: students.rows, tasks: tasks.rows, notes: notes.rows, contacts: contacts.rows, agreements: agreements.rows, documents: documents.rows, timeline: timeline.rows });
    } catch (error) { safeError(res, error, 'No fue posible cargar el seguimiento.'); }
  });

  router.patch('/casos/:caseId', verifyPermission('seguimiento.manage'), async (req, res) => {
    const priority = String(req.body.prioridad || '').toUpperCase();
    const state = String(req.body.estado || '').toUpperCase();
    const dueDate = req.body.fecha_limite || null;
    if (!PRIORITIES.has(priority) || !STATES.has(state) || !isoDate(dueDate) || ['CERRADO', 'ANULADO'].includes(state)) return res.status(400).json({ message: 'Revisa estado, prioridad y fecha límite.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await loadCase(client, id(req.params.caseId), true);
      if (['CERRADO', 'ANULADO'].includes(current.estado)) { const e = new Error('El caso debe reabrirse antes de editarlo.'); e.statusCode = 409; throw e; }
      const owner = req.body.responsable_usuario_id === null ? null : id(req.body.responsable_usuario_id);
      const updated = await client.query(`UPDATE seguimiento_casos SET titulo=$2, prioridad=$3, estado=$4,responsable_usuario_id=$5,fecha_limite=$6,actualizado_por=$7,actualizado_en=CURRENT_TIMESTAMP,version=version+1 WHERE id_caso=$1 RETURNING *`, [current.id_caso, clean(req.body.titulo || current.titulo, 180), priority, state, owner, dueDate, req.user.id]);
      await addEvent(client, { caseId: current.id_caso, type: 'ACTUALIZACION', title: 'Seguimiento actualizado', metadata: { anterior: { estado: current.estado, prioridad: current.prioridad, responsable: current.responsable_usuario_id, fecha_limite: current.fecha_limite }, posterior: { estado: state, prioridad, responsable: owner, fecha_limite: dueDate } }, userId: req.user.id });
      if (owner && owner !== current.responsable_usuario_id) {
        await client.query(`
          INSERT INTO notificaciones_internas (
            usuario_id, modulo, tipo, titulo, detalle, enlace, clave_dedupe
          ) VALUES ($1, 'SEGUIMIENTO', 'CASO_ASIGNADO', 'Seguimiento asignado', $2, $3, $4)
          ON CONFLICT (usuario_id, clave_dedupe) WHERE clave_dedupe IS NOT NULL DO NOTHING
        `, [owner, updated.rows[0].titulo, `/admin/seguimiento/${current.id_caso}`,
          `seguimiento:${current.id_caso}:asignacion-manual:${owner}:v${updated.rows[0].version}`]);
      }
      await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo, accion: 'EDITAR_SEGUIMIENTO', entidad: 'seguimiento_caso', entidad_id: current.id_caso, detalle: { estado: state, prioridad }, ip: getClientIp(req) });
      await client.query('COMMIT'); res.json(updated.rows[0]);
    } catch (error) { await client.query('ROLLBACK'); safeError(res, error, 'No fue posible actualizar el seguimiento.'); } finally { client.release(); }
  });

  router.post('/casos/:caseId/tareas', verifyPermission('seguimiento.manage'), async (req, res) => {
    const title = clean(req.body.titulo, 180); const priority = String(req.body.prioridad || 'MEDIA').toUpperCase();
    if (title.length < 3 || !PRIORITIES.has(priority) || !isoDate(req.body.fecha_limite)) return res.status(400).json({ message: 'Completa una tarea válida.' });
    try {
      const result = await pool.query(`INSERT INTO seguimiento_tareas (id_caso,titulo,detalle,prioridad,responsable_usuario_id,fecha_limite,creada_por) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [id(req.params.caseId), title, narrative(req.body.detalle, 3000) || null, priority, id(req.body.responsable_usuario_id), req.body.fecha_limite || null, req.user.id]);
      await addEvent(pool, { caseId: id(req.params.caseId), type: 'TAREA_CREADA', title: `Tarea creada: ${title}`, metadata: { id_tarea: result.rows[0].id_tarea }, userId: req.user.id }); res.status(201).json(result.rows[0]);
    } catch (error) { safeError(res, error, 'No fue posible crear la tarea.'); }
  });

  router.patch('/casos/:caseId/tareas/:taskId', verifyPermission('seguimiento.manage'), async (req, res) => {
    const state = String(req.body.estado || '').toUpperCase(); if (!TASK_STATES.has(state)) return res.status(400).json({ message: 'Estado de tarea no válido.' });
    try {
      const result = await pool.query(`UPDATE seguimiento_tareas SET estado=$3::varchar,completada_por=CASE WHEN $3::varchar='COMPLETADA' THEN $4::integer ELSE NULL END,completada_en=CASE WHEN $3::varchar='COMPLETADA' THEN CURRENT_TIMESTAMP ELSE NULL END,actualizada_en=CURRENT_TIMESTAMP WHERE id_tarea=$1 AND id_caso=$2 RETURNING *`, [id(req.params.taskId), id(req.params.caseId), state, req.user.id]);
      if (!result.rowCount) return res.status(404).json({ message: 'La tarea no existe.' });
      await addEvent(pool, { caseId: id(req.params.caseId), type: 'TAREA_ACTUALIZADA', title: `Tarea ${state.toLowerCase().replace('_', ' ')}`, metadata: { id_tarea: id(req.params.taskId), estado: state }, userId: req.user.id }); res.json(result.rows[0]);
    } catch (error) { safeError(res, error, 'No fue posible actualizar la tarea.'); }
  });

  router.post('/casos/:caseId/notas', verifyPermission('seguimiento.manage'), async (req, res) => {
    const content = narrative(req.body.contenido, 12000); if (content.length < 2) return res.status(400).json({ message: 'Escribe una nota.' });
    try { const result = await pool.query(`INSERT INTO seguimiento_notas (id_caso,contenido,interna,creada_por) VALUES ($1,$2,true,$3) RETURNING *`, [id(req.params.caseId), content, req.user.id]); await addEvent(pool, { caseId: id(req.params.caseId), type: 'NOTA', title: 'Nota interna registrada', userId: req.user.id }); res.status(201).json(result.rows[0]); } catch (error) { safeError(res, error, 'No fue posible registrar la nota.'); }
  });

  router.post('/casos/:caseId/contactos', verifyPermission('seguimiento.contacts'), async (req, res) => {
    const type = String(req.body.tipo || '').toUpperCase(); const resultType = String(req.body.resultado || '').toUpperCase(); const recipient = clean(req.body.destinatario, 180);
    if (!CONTACT_TYPES.has(type) || !CONTACT_RESULTS.has(resultType) || recipient.length < 2) return res.status(400).json({ message: 'Revisa tipo, destinatario y resultado del contacto.' });
    try { const result = await pool.query(`INSERT INTO seguimiento_contactos (id_caso,tipo,destinatario,resultado,detalle,registrado_por,proximo_contacto_en) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [id(req.params.caseId), type, recipient, resultType, narrative(req.body.detalle, 4000) || null, req.user.id, req.body.proximo_contacto_en || null]); await addEvent(pool, { caseId: id(req.params.caseId), type: 'CONTACTO', title: `${type}: ${recipient}`, detail: resultType, userId: req.user.id }); res.status(201).json(result.rows[0]); } catch (error) { safeError(res, error, 'No fue posible registrar el contacto.'); }
  });

  router.post('/casos/:caseId/acuerdos', verifyPermission('seguimiento.manage'), async (req, res) => {
    const description = narrative(req.body.descripcion, 5000); if (description.length < 3 || !isoDate(req.body.fecha_compromiso)) return res.status(400).json({ message: 'Completa el acuerdo y su fecha.' });
    try { const result = await pool.query(`INSERT INTO seguimiento_acuerdos (id_caso,descripcion,responsable,fecha_compromiso,registrado_por) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [id(req.params.caseId), description, clean(req.body.responsable, 180) || null, req.body.fecha_compromiso || null, req.user.id]); await addEvent(pool, { caseId: id(req.params.caseId), type: 'ACUERDO', title: 'Acuerdo registrado', detail: description, userId: req.user.id }); res.status(201).json(result.rows[0]); } catch (error) { safeError(res, error, 'No fue posible registrar el acuerdo.'); }
  });

  router.patch('/casos/:caseId/acuerdos/:agreementId', verifyPermission('seguimiento.manage'), async (req, res) => {
    const state = String(req.body.estado || '').toUpperCase(); if (!AGREEMENT_STATES.has(state)) return res.status(400).json({ message: 'Estado de acuerdo no válido.' });
    try { const result = await pool.query(`UPDATE seguimiento_acuerdos SET estado=$3,actualizado_en=CURRENT_TIMESTAMP WHERE id_acuerdo=$1 AND id_caso=$2 RETURNING *`, [id(req.params.agreementId), id(req.params.caseId), state]); if (!result.rowCount) return res.status(404).json({ message: 'El acuerdo no existe.' }); await addEvent(pool, { caseId: id(req.params.caseId), type: 'ACUERDO_ACTUALIZADO', title: `Acuerdo ${state.toLowerCase()}`, metadata: { id_acuerdo: id(req.params.agreementId) }, userId: req.user.id }); res.json(result.rows[0]); } catch (error) { safeError(res, error, 'No fue posible actualizar el acuerdo.'); }
  });

  router.post('/casos/:caseId/documentos', verifyPermission('seguimiento.documents'), async (req, res) => {
    const client = await pool.connect(); let storedName = null;
    try { await client.query('BEGIN'); await loadCase(client, id(req.params.caseId), true); const document = await createDocument(client, { fileData: req.body.file_data, fileName: req.body.file_name, userId: req.user.id }); storedName = document.nombre_almacenado; const linked = await client.query(`INSERT INTO seguimiento_documentos (id_caso,id_documento,descripcion,creado_por) VALUES ($1,$2,$3,$4) RETURNING *`, [id(req.params.caseId), document.id_documento, clean(req.body.descripcion, 300) || null, req.user.id]); await addEvent(client, { caseId: id(req.params.caseId), type: 'DOCUMENTO', title: `Documento adjuntado: ${document.nombre_original}`, metadata: { id_documento: document.id_documento }, userId: req.user.id }); await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo, accion: 'ADJUNTAR_DOCUMENTO_SEGUIMIENTO', entidad: 'seguimiento_caso', entidad_id: id(req.params.caseId), detalle: { documento_id: document.id_documento }, ip: getClientIp(req) }); await client.query('COMMIT'); res.status(201).json({ ...linked.rows[0], nombre_original: document.nombre_original }); } catch (error) { await client.query('ROLLBACK'); if (storedName) await removeStoredFile(storedName).catch(() => {}); safeError(res, error, 'No fue posible adjuntar el documento.'); } finally { client.release(); }
  });

  router.get('/casos/:caseId/documentos/:documentId', verifyPermission('seguimiento.documents'), async (req, res) => {
    try { const result = await pool.query(`SELECT d.* FROM seguimiento_documentos sd JOIN justification_documents d ON d.id_documento=sd.id_documento WHERE sd.id_caso=$1 AND sd.id_documento=$2 AND sd.activo=true`, [id(req.params.caseId), id(req.params.documentId)]); if (!result.rowCount) return res.status(404).json({ message: 'El documento no existe.' }); const doc = result.rows[0]; const filePath = resolveDocumentPath(doc.nombre_almacenado); if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ message: 'El archivo no está disponible.' }); await insertarAudit(pool, { usuario_id: req.user.id, usuario_correo: req.user.correo, accion: 'DESCARGAR_DOCUMENTO_SEGUIMIENTO', entidad: 'seguimiento_caso', entidad_id: id(req.params.caseId), detalle: { documento_id: doc.id_documento }, ip: getClientIp(req) }); res.type(doc.mime_type).download(filePath, doc.nombre_original); } catch (error) { safeError(res, error, 'No fue posible descargar el documento.'); }
  });

  router.post('/casos/:caseId/escalar-convivencia', verifyAnyPermission(['seguimiento.manage', 'convivencia.create']), async (req, res) => {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const current = await loadCase(client, id(req.params.caseId), true); if (current.convivencia_caso_id) { const e = new Error('El seguimiento ya está vinculado con Convivencia Escolar.'); e.statusCode = 409; throw e; } const created = await client.query(`INSERT INTO convivencia_casos (titulo,categoria,prioridad,estado,descripcion_inicial,fecha_situacion,responsable_usuario_id,creado_por,actualizado_por) VALUES ($1,'CONVIVENCIA',$2,'ABIERTO',$3,CURRENT_DATE,$4,$5,$5) RETURNING id_caso,codigo`, [current.titulo, current.prioridad, `Derivado desde Seguimiento Institucional. ${current.motivo_apertura}`, current.responsable_usuario_id, req.user.id]); const coexistenceId = created.rows[0].id_caso; if (current.estudiante_principal_id) await client.query(`INSERT INTO convivencia_participantes (id_caso,tipo_persona,estudiante_id,rol_en_caso,detalle_relacion,creado_por) VALUES ($1,'ESTUDIANTE',$2,'INVOLUCRADO','Derivación desde seguimiento institucional',$3)`, [coexistenceId, current.estudiante_principal_id, req.user.id]); await client.query(`UPDATE seguimiento_casos SET convivencia_caso_id=$2,estado='ESCALADO',actualizado_por=$3,actualizado_en=CURRENT_TIMESTAMP,version=version+1 WHERE id_caso=$1`, [current.id_caso, coexistenceId, req.user.id]); await addEvent(client, { caseId: current.id_caso, type: 'DERIVACION_CONVIVENCIA', title: 'Caso derivado a Convivencia Escolar', metadata: { convivencia_caso_id: coexistenceId }, userId: req.user.id }); await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo, accion: 'DERIVAR_SEGUIMIENTO_CONVIVENCIA', entidad: 'seguimiento_caso', entidad_id: current.id_caso, detalle: { convivencia_caso_id: coexistenceId }, ip: getClientIp(req) }); await client.query('COMMIT'); res.status(201).json({ convivencia_caso_id: coexistenceId, codigo: created.rows[0].codigo }); } catch (error) { await client.query('ROLLBACK'); safeError(res, error, 'No fue posible derivar el caso.'); } finally { client.release(); }
  });

  router.post('/casos/:caseId/cerrar', verifyPermission('seguimiento.close'), async (req, res) => {
    const state = String(req.body.estado || 'CERRADO').toUpperCase(); const resultText = narrative(req.body.resultado_final, 8000); if (!['CERRADO', 'ANULADO'].includes(state) || resultText.length < 8) return res.status(400).json({ message: 'Indica un resultado o motivo de cierre suficientemente claro.' });
    const client = await pool.connect(); try { await client.query('BEGIN'); const current = await loadCase(client, id(req.params.caseId), true); const pending = await client.query(`SELECT COUNT(*)::int AS total FROM seguimiento_tareas WHERE id_caso=$1 AND estado IN ('PENDIENTE','EN_PROGRESO')`, [current.id_caso]); if (state === 'CERRADO' && pending.rows[0].total > 0 && !req.body.confirmar_tareas_pendientes) { const e = new Error(`Existen ${pending.rows[0].total} tareas pendientes. Confirma el cierre para continuar.`); e.statusCode = 409; throw e; } const updated = await client.query(`UPDATE seguimiento_casos SET estado=$2,resultado_final=$3,cerrado_por=$4,cerrado_en=CURRENT_TIMESTAMP,actualizado_por=$4,actualizado_en=CURRENT_TIMESTAMP,version=version+1 WHERE id_caso=$1 RETURNING *`, [current.id_caso, state, resultText, req.user.id]); await addEvent(client, { caseId: current.id_caso, type: state, title: state === 'CERRADO' ? 'Seguimiento cerrado' : 'Seguimiento anulado', detail: resultText, userId: req.user.id }); await insertarAudit(client, { usuario_id: req.user.id, usuario_correo: req.user.correo, accion: state === 'CERRADO' ? 'CERRAR_SEGUIMIENTO' : 'ANULAR_SEGUIMIENTO', entidad: 'seguimiento_caso', entidad_id: current.id_caso, detalle: { resultado: resultText }, ip: getClientIp(req) }); await client.query('COMMIT'); res.json(updated.rows[0]); } catch (error) { await client.query('ROLLBACK'); safeError(res, error, 'No fue posible cerrar el seguimiento.'); } finally { client.release(); }
  });

  router.post('/casos/:caseId/reabrir', verifyPermission('seguimiento.close'), async (req, res) => {
    const reason = narrative(req.body.motivo, 3000); if (reason.length < 8) return res.status(400).json({ message: 'Indica el motivo de reapertura.' });
    try { const result = await pool.query(`UPDATE seguimiento_casos SET estado='EN_SEGUIMIENTO',resultado_final=NULL,cerrado_por=NULL,cerrado_en=NULL,actualizado_por=$2,actualizado_en=CURRENT_TIMESTAMP,version=version+1 WHERE id_caso=$1 AND estado IN ('CERRADO','ANULADO') RETURNING *`, [id(req.params.caseId), req.user.id]); if (!result.rowCount) return res.status(409).json({ message: 'El seguimiento no se encuentra cerrado.' }); await addEvent(pool, { caseId: id(req.params.caseId), type: 'REAPERTURA', title: 'Seguimiento reabierto', detail: reason, userId: req.user.id }); res.json(result.rows[0]); } catch (error) { safeError(res, error, 'No fue posible reabrir el seguimiento.'); }
  });

  return router;
};

module.exports = { createFollowUpRouter };
