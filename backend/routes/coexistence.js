const express = require('express');
const fs = require('fs');
const {
  createDocument,
  removeStoredFile,
  resolveDocumentPath
} = require('../services/documentService');

const CASE_STATES = new Set(['ABIERTO', 'EN_SEGUIMIENTO', 'EN_REVISION', 'CERRADO', 'ANULADO']);
const CASE_CATEGORIES = new Set(['CONVIVENCIA', 'CONFLICTO', 'ACOSO', 'VIOLENCIA', 'DISCRIMINACION', 'VULNERACION', 'OTRO']);
const CASE_PRIORITIES = new Set(['BAJA', 'MEDIA', 'ALTA', 'URGENTE']);
const EVENT_TYPES = new Set(['SITUACION', 'MEDIDA', 'ENTREVISTA', 'MEDIACION', 'ACUERDO', 'SEGUIMIENTO', 'DERIVACION', 'REVISION']);
const PARTICIPANT_TYPES = new Set(['ESTUDIANTE', 'PERSONAL', 'EXTERNA', 'OTRA']);
const PARTICIPANT_ROLES = new Set(['AFECTADO', 'INVOLUCRADO', 'TESTIGO', 'APODERADO', 'PROFESIONAL', 'OTRO']);

const cleanText = (value, max = 300) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const cleanNarrative = (value, max = 12000) => String(value || '').trim().slice(0, max);
const positiveInteger = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const isDate = (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value));
const isDateTime = (value) => !value || !Number.isNaN(Date.parse(String(value)));

const validateParticipant = (input = {}) => {
  const type = String(input.tipo_persona || '').toUpperCase();
  const role = String(input.rol_en_caso || '').toUpperCase();
  if (!PARTICIPANT_TYPES.has(type) || !PARTICIPANT_ROLES.has(role)) {
    return { error: 'Revisa el tipo de persona y su participacion en el caso.' };
  }

  const participant = {
    tipo_persona: type,
    rol_en_caso: role,
    detalle_relacion: cleanText(input.detalle_relacion, 300) || null,
    estudiante_id: type === 'ESTUDIANTE' ? positiveInteger(input.estudiante_id) : null,
    usuario_id: type === 'PERSONAL' ? positiveInteger(input.usuario_id) : null,
    nombre_externo: ['EXTERNA', 'OTRA'].includes(type) ? cleanText(input.nombre_externo, 180) : null
  };

  if (type === 'ESTUDIANTE' && !participant.estudiante_id) return { error: 'Selecciona un estudiante valido.' };
  if (type === 'PERSONAL' && !participant.usuario_id) return { error: 'Selecciona una persona del equipo.' };
  if (['EXTERNA', 'OTRA'].includes(type) && (participant.nombre_externo || '').length < 2) {
    return { error: 'Indica el nombre de la persona externa.' };
  }
  return { participant };
};

const insertParticipant = async (client, caseId, input, userId) => {
  const validation = validateParticipant(input);
  if (validation.error) {
    const error = new Error(validation.error);
    error.statusCode = 400;
    throw error;
  }
  const participant = validation.participant;
  const referenceTable = participant.tipo_persona === 'ESTUDIANTE' ? 'alumno' : participant.tipo_persona === 'PERSONAL' ? 'usuarios' : null;
  const referenceId = participant.estudiante_id || participant.usuario_id;
  if (referenceTable) {
    const exists = await client.query(
      `SELECT 1 FROM ${referenceTable} WHERE ${referenceTable === 'alumno' ? 'id_alumno' : 'id'} = $1 AND activo = true`,
      [referenceId]
    );
    if (!exists.rowCount) {
      const error = new Error('La persona seleccionada no esta disponible.');
      error.statusCode = 404;
      throw error;
    }
  }

  const result = await client.query(
    `INSERT INTO convivencia_participantes (
       id_caso, tipo_persona, estudiante_id, usuario_id, nombre_externo,
       rol_en_caso, detalle_relacion, creado_por
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id_participante`,
    [caseId, participant.tipo_persona, participant.estudiante_id, participant.usuario_id,
      participant.nombre_externo, participant.rol_en_caso, participant.detalle_relacion, userId]
  );
  return result.rows[0].id_participante;
};

const requireOpenCase = async (client, caseId) => {
  const result = await client.query(
    'SELECT id_caso, codigo, estado, version FROM convivencia_casos WHERE id_caso = $1 FOR UPDATE',
    [caseId]
  );
  if (!result.rowCount) {
    const error = new Error('El caso no existe.');
    error.statusCode = 404;
    throw error;
  }
  if (result.rows[0].estado === 'CERRADO' || result.rows[0].estado === 'ANULADO') {
    const error = new Error('El caso no admite cambios mientras se encuentre cerrado o anulado.');
    error.statusCode = 409;
    throw error;
  }
  return result.rows[0];
};

const safeErrorResponse = (res, error, fallback) => {
  const status = error.statusCode || (error.code === '23505' ? 409 : 500);
  if (status >= 500) console.error('[convivencia]', error.message);
  return res.status(status).json({ message: status >= 500 ? fallback : error.message });
};

const createCoexistenceRouter = ({
  pool,
  verifyToken,
  verifyPermission,
  insertarAudit,
  getClientIp
}) => {
  const router = express.Router();
  router.use(verifyToken);
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  router.get('/resumen', verifyPermission('convivencia.view'), async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE estado <> 'CERRADO' AND estado <> 'ANULADO')::int AS activos,
          COUNT(*) FILTER (WHERE estado = 'EN_SEGUIMIENTO')::int AS en_seguimiento,
          COUNT(*) FILTER (
            WHERE estado <> 'CERRADO' AND estado <> 'ANULADO'
              AND proxima_revision IS NOT NULL AND proxima_revision <= CURRENT_DATE
          )::int AS revisiones_pendientes,
          COUNT(*) FILTER (
            WHERE estado = 'CERRADO' AND cerrado_en >= date_trunc('month', CURRENT_TIMESTAMP)
          )::int AS cerrados_mes
        FROM convivencia_casos
      `);
      res.json(result.rows[0]);
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible cargar el resumen de convivencia.');
    }
  });

  router.get('/personas/buscar', verifyPermission('convivencia.view'), async (req, res) => {
    const query = cleanText(req.query.q, 100);
    if (query.length < 2) return res.json([]);
    try {
      const result = await pool.query(`
        SELECT * FROM (
          SELECT 'ESTUDIANTE'::text AS tipo_persona,
                 a.id_alumno AS referencia_id,
                 trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS nombre,
                 COALESCE(c.nombre_curso, 'Sin curso') AS detalle
          FROM alumno a
          LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
          LEFT JOIN curso c ON c.id_curso = m.id_curso
          WHERE a.activo = true
            AND trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) ILIKE '%' || $1 || '%'
          UNION ALL
          SELECT 'PERSONAL'::text AS tipo_persona,
                 u.id AS referencia_id,
                 COALESCE(NULLIF(trim(u.nombre), ''), u.correo) AS nombre,
                 COALESCE(NULLIF(trim(u.cargo), ''), p.nombre, 'Personal') AS detalle
          FROM usuarios u
          LEFT JOIN perfiles_acceso p ON p.codigo = u.rol
          WHERE u.activo = true AND u.eliminado_en IS NULL
            AND (COALESCE(u.nombre, '') ILIKE '%' || $1 || '%' OR u.correo ILIKE '%' || $1 || '%')
        ) personas
        ORDER BY lower(nombre)
        LIMIT 20
      `, [query]);
      res.json(result.rows);
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible buscar personas.');
    }
  });

  router.get('/casos', verifyPermission('convivencia.view'), async (req, res) => {
    const search = cleanText(req.query.q, 120);
    const state = CASE_STATES.has(String(req.query.estado || '').toUpperCase()) ? String(req.query.estado).toUpperCase() : null;
    const priority = CASE_PRIORITIES.has(String(req.query.prioridad || '').toUpperCase()) ? String(req.query.prioridad).toUpperCase() : null;
    const onlyPending = String(req.query.revision_pendiente || '') === 'true';
    const page = Math.max(1, positiveInteger(req.query.pagina) || 1);
    const limit = Math.min(50, Math.max(10, positiveInteger(req.query.limite) || 20));
    try {
      const values = [search, state, priority, onlyPending, limit, (page - 1) * limit];
      const result = await pool.query(`
        WITH filtrados AS (
          SELECT c.*,
                 COALESCE(NULLIF(trim(u.nombre), ''), u.correo) AS responsable_nombre,
                 (SELECT COUNT(*)::int FROM convivencia_participantes p WHERE p.id_caso = c.id_caso AND p.activo) AS participantes,
                 (SELECT COUNT(*)::int FROM convivencia_eventos e WHERE e.id_caso = c.id_caso) AS actuaciones
          FROM convivencia_casos c
          LEFT JOIN usuarios u ON u.id = c.responsable_usuario_id
          WHERE ($1 = '' OR c.codigo ILIKE '%' || $1 || '%' OR c.titulo ILIKE '%' || $1 || '%'
            OR EXISTS (
              SELECT 1 FROM convivencia_participantes p
              LEFT JOIN alumno a ON a.id_alumno = p.estudiante_id
              LEFT JOIN usuarios pu ON pu.id = p.usuario_id
              WHERE p.id_caso = c.id_caso AND p.activo
                AND COALESCE(
                  NULLIF(trim(concat_ws(' ', a.nombres, a.paterno, a.materno)), ''),
                  NULLIF(trim(pu.nombre), ''),
                  p.nombre_externo,
                  ''
                ) ILIKE '%' || $1 || '%'
            ))
            AND ($2::varchar IS NULL OR c.estado = $2)
            AND ($3::varchar IS NULL OR c.prioridad = $3)
            AND ($4::boolean = false OR (
              c.estado NOT IN ('CERRADO', 'ANULADO') AND c.proxima_revision IS NOT NULL AND c.proxima_revision <= CURRENT_DATE
            ))
        )
        SELECT f.*, COUNT(*) OVER()::int AS total
        FROM filtrados f
        ORDER BY
          CASE f.prioridad WHEN 'URGENTE' THEN 1 WHEN 'ALTA' THEN 2 WHEN 'MEDIA' THEN 3 ELSE 4 END,
          CASE WHEN f.proxima_revision IS NOT NULL AND f.proxima_revision <= CURRENT_DATE AND f.estado NOT IN ('CERRADO', 'ANULADO') THEN 0 ELSE 1 END,
          f.actualizado_en DESC
        LIMIT $5 OFFSET $6
      `, values);
      res.json({
        items: result.rows.map(({ total, ...row }) => row),
        total: result.rows[0]?.total || 0,
        pagina: page,
        limite: limit
      });
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible cargar los casos de convivencia.');
    }
  });

  router.get('/casos/:caseId', verifyPermission('convivencia.view'), async (req, res) => {
    const caseId = positiveInteger(req.params.caseId);
    if (!caseId) return res.status(400).json({ message: 'Caso invalido.' });
    try {
      const [caseResult, participants, events, documents] = await Promise.all([
        pool.query(`
          SELECT c.*,
                 COALESCE(NULLIF(trim(responsable.nombre), ''), responsable.correo) AS responsable_nombre,
                 COALESCE(NULLIF(trim(creador.nombre), ''), creador.correo) AS creado_por_nombre
          FROM convivencia_casos c
          LEFT JOIN usuarios responsable ON responsable.id = c.responsable_usuario_id
          LEFT JOIN usuarios creador ON creador.id = c.creado_por
          WHERE c.id_caso = $1
        `, [caseId]),
        pool.query(`
          SELECT p.*,
                 COALESCE(
                   NULLIF(trim(concat_ws(' ', a.nombres, a.paterno, a.materno)), ''),
                   NULLIF(trim(u.nombre), ''), u.correo, p.nombre_externo
                 ) AS nombre,
                 CASE WHEN p.tipo_persona = 'ESTUDIANTE' THEN COALESCE(c.nombre_curso, 'Sin curso')
                      WHEN p.tipo_persona = 'PERSONAL' THEN COALESCE(NULLIF(trim(u.cargo), ''), pa.nombre, 'Personal')
                      ELSE p.detalle_relacion END AS referencia
          FROM convivencia_participantes p
          LEFT JOIN alumno a ON a.id_alumno = p.estudiante_id
          LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
          LEFT JOIN curso c ON c.id_curso = m.id_curso
          LEFT JOIN usuarios u ON u.id = p.usuario_id
          LEFT JOIN perfiles_acceso pa ON pa.codigo = u.rol
          WHERE p.id_caso = $1 AND p.activo = true
          ORDER BY p.id_participante
        `, [caseId]),
        pool.query(`
          SELECT e.*,
                 COALESCE(NULLIF(trim(u.nombre), ''), u.correo) AS creado_por_nombre,
                 COALESCE(
                   json_agg(ep.id_participante ORDER BY ep.id_participante) FILTER (WHERE ep.id_participante IS NOT NULL),
                   '[]'::json
                 ) AS participantes
          FROM convivencia_eventos e
          LEFT JOIN usuarios u ON u.id = e.creado_por
          LEFT JOIN convivencia_evento_participantes ep ON ep.id_evento = e.id_evento
          WHERE e.id_caso = $1
          GROUP BY e.id_evento, u.nombre, u.correo
          ORDER BY e.fecha_evento DESC, e.id_evento DESC
        `, [caseId]),
        pool.query(`
          SELECT cd.id_convivencia_documento, cd.id_evento, cd.descripcion, cd.creado_en,
                 d.nombre_original, d.mime_type, d.tamano_bytes,
                 COALESCE(NULLIF(trim(u.nombre), ''), u.correo) AS creado_por_nombre
          FROM convivencia_documentos cd
          JOIN justification_documents d ON d.id_documento = cd.id_documento
          LEFT JOIN usuarios u ON u.id = cd.creado_por
          WHERE cd.id_caso = $1 AND cd.activo = true
          ORDER BY cd.creado_en DESC
        `, [caseId])
      ]);
      if (!caseResult.rowCount) return res.status(404).json({ message: 'El caso no existe.' });
      res.json({
        case: caseResult.rows[0],
        participants: participants.rows,
        events: events.rows,
        documents: documents.rows
      });
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible cargar el caso.');
    }
  });

  router.post('/casos', verifyPermission('convivencia.create'), async (req, res) => {
    const title = cleanText(req.body?.titulo, 180);
    const description = cleanNarrative(req.body?.descripcion_inicial);
    const category = String(req.body?.categoria || 'CONVIVENCIA').toUpperCase();
    const priority = String(req.body?.prioridad || 'MEDIA').toUpperCase();
    const incidentDate = String(req.body?.fecha_situacion || '').slice(0, 10);
    const reviewDate = req.body?.proxima_revision ? String(req.body.proxima_revision).slice(0, 10) : null;
    const participants = Array.isArray(req.body?.participantes) ? req.body.participantes.slice(0, 30) : [];
    if (title.length < 5 || description.length < 10 || !CASE_CATEGORIES.has(category) || !CASE_PRIORITIES.has(priority)
      || !isDate(incidentDate) || !incidentDate || !isDate(reviewDate) || participants.length < 1) {
      return res.status(400).json({ message: 'Completa la situacion, la fecha y al menos una persona involucrada.' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const responsibleId = positiveInteger(req.body?.responsable_usuario_id) || req.user.id;
      const result = await client.query(`
        INSERT INTO convivencia_casos (
          titulo, categoria, prioridad, descripcion_inicial, fecha_situacion,
          proxima_revision, responsable_usuario_id, creado_por, actualizado_por
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        RETURNING id_caso, version
      `, [title, category, priority, description, incidentDate, reviewDate, responsibleId, req.user.id]);
      const caseId = result.rows[0].id_caso;
      const code = `CE-${new Date().getFullYear()}-${String(caseId).padStart(6, '0')}`;
      await client.query('UPDATE convivencia_casos SET codigo = $1 WHERE id_caso = $2', [code, caseId]);
      const participantIds = [];
      for (const participant of participants) {
        participantIds.push(await insertParticipant(client, caseId, participant, req.user.id));
      }
      const event = await client.query(`
        INSERT INTO convivencia_eventos (
          id_caso, tipo, titulo, detalle, fecha_evento, proxima_revision, creado_por
        ) VALUES ($1, 'SITUACION', $2, $3, $4::date::timestamp, $5, $6)
        RETURNING id_evento
      `, [caseId, title, description, incidentDate, reviewDate, req.user.id]);
      for (const participantId of participantIds) {
        await client.query(
          'INSERT INTO convivencia_evento_participantes (id_evento, id_participante) VALUES ($1, $2)',
          [event.rows[0].id_evento, participantId]
        );
      }
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CONVIVENCIA_CASO_CREADO',
        entidad: 'convivencia_caso',
        entidad_id: caseId,
        detalle: { codigo: code, categoria: category, prioridad: priority, participantes: participantIds.length },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.status(201).json({ id_caso: caseId, codigo: code });
    } catch (error) {
      await client.query('ROLLBACK');
      safeErrorResponse(res, error, 'No fue posible registrar el caso.');
    } finally {
      client.release();
    }
  });

  router.patch('/casos/:caseId', verifyPermission('convivencia.manage'), async (req, res) => {
    const caseId = positiveInteger(req.params.caseId);
    const version = positiveInteger(req.body?.version);
    const title = cleanText(req.body?.titulo, 180);
    const category = String(req.body?.categoria || '').toUpperCase();
    const priority = String(req.body?.prioridad || '').toUpperCase();
    const state = String(req.body?.estado || '').toUpperCase();
    const reviewDate = req.body?.proxima_revision ? String(req.body.proxima_revision).slice(0, 10) : null;
    if (!caseId || !version || title.length < 5 || !CASE_CATEGORIES.has(category) || !CASE_PRIORITIES.has(priority)
      || !['ABIERTO', 'EN_SEGUIMIENTO', 'EN_REVISION'].includes(state) || !isDate(reviewDate)) {
      return res.status(400).json({ message: 'Revisa los datos del caso.' });
    }
    try {
      const result = await pool.query(`
        UPDATE convivencia_casos
        SET titulo = $1, categoria = $2, prioridad = $3, estado = $4,
            proxima_revision = $5, responsable_usuario_id = $6,
            actualizado_por = $7, actualizado_en = CURRENT_TIMESTAMP, version = version + 1
        WHERE id_caso = $8 AND version = $9 AND estado NOT IN ('CERRADO', 'ANULADO')
        RETURNING id_caso, codigo, version
      `, [title, category, priority, state, reviewDate,
        positiveInteger(req.body?.responsable_usuario_id) || req.user.id,
        req.user.id, caseId, version]);
      if (!result.rowCount) return res.status(409).json({ message: 'El caso fue actualizado por otra persona o ya se encuentra cerrado. Recarga la página.' });
      await insertarAudit(pool, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CONVIVENCIA_CASO_EDITADO',
        entidad: 'convivencia_caso',
        entidad_id: caseId,
        detalle: { categoria: category, prioridad: priority, estado: state, version: result.rows[0].version },
        ip: getClientIp(req)
      });
      res.json(result.rows[0]);
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible actualizar el caso.');
    }
  });

  router.post('/casos/:caseId/participantes', verifyPermission('convivencia.manage'), async (req, res) => {
    const caseId = positiveInteger(req.params.caseId);
    if (!caseId) return res.status(400).json({ message: 'Caso invalido.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireOpenCase(client, caseId);
      const participantId = await insertParticipant(client, caseId, req.body, req.user.id);
      await client.query(
        'UPDATE convivencia_casos SET actualizado_por = $1, actualizado_en = CURRENT_TIMESTAMP, version = version + 1 WHERE id_caso = $2',
        [req.user.id, caseId]
      );
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CONVIVENCIA_PARTICIPANTE_AGREGADO',
        entidad: 'convivencia_caso',
        entidad_id: caseId,
        detalle: { id_participante: participantId, tipo_persona: String(req.body?.tipo_persona || '').toUpperCase() },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.status(201).json({ id_participante: participantId });
    } catch (error) {
      await client.query('ROLLBACK');
      safeErrorResponse(res, error, 'No fue posible agregar a la persona.');
    } finally {
      client.release();
    }
  });

  router.post('/casos/:caseId/actuaciones', verifyPermission('convivencia.manage'), async (req, res) => {
    const caseId = positiveInteger(req.params.caseId);
    const type = String(req.body?.tipo || '').toUpperCase();
    const title = cleanText(req.body?.titulo, 180);
    const detail = cleanNarrative(req.body?.detalle);
    const resultText = cleanNarrative(req.body?.resultado, 6000) || null;
    const eventDate = req.body?.fecha_evento ? String(req.body.fecha_evento) : new Date().toISOString();
    const reviewDate = req.body?.proxima_revision ? String(req.body.proxima_revision).slice(0, 10) : null;
    const participantIds = [...new Set((Array.isArray(req.body?.participantes) ? req.body.participantes : [])
      .map(positiveInteger).filter(Boolean))].slice(0, 50);
    if (!caseId || !EVENT_TYPES.has(type) || title.length < 3 || detail.length < 5 || !isDateTime(eventDate) || !isDate(reviewDate)) {
      return res.status(400).json({ message: 'Completa el tipo, titulo, detalle y fecha de la actuacion.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await requireOpenCase(client, caseId);
      if (participantIds.length) {
        const available = await client.query(
          'SELECT id_participante FROM convivencia_participantes WHERE id_caso = $1 AND activo = true AND id_participante = ANY($2::int[])',
          [caseId, participantIds]
        );
        if (available.rowCount !== participantIds.length) {
          const error = new Error('Una de las personas seleccionadas no pertenece al caso.');
          error.statusCode = 400;
          throw error;
        }
      }
      const event = await client.query(`
        INSERT INTO convivencia_eventos (
          id_caso, tipo, titulo, detalle, resultado, fecha_evento, proxima_revision, creado_por
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id_evento
      `, [caseId, type, title, detail, resultText, eventDate, reviewDate, req.user.id]);
      for (const participantId of participantIds) {
        await client.query(
          'INSERT INTO convivencia_evento_participantes (id_evento, id_participante) VALUES ($1, $2)',
          [event.rows[0].id_evento, participantId]
        );
      }
      const nextState = type === 'REVISION' ? 'EN_REVISION' : 'EN_SEGUIMIENTO';
      await client.query(`
        UPDATE convivencia_casos
        SET estado = $1, proxima_revision = COALESCE($2, proxima_revision),
            actualizado_por = $3, actualizado_en = CURRENT_TIMESTAMP, version = version + 1
        WHERE id_caso = $4
      `, [nextState, reviewDate, req.user.id, caseId]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CONVIVENCIA_ACTUACION_REGISTRADA',
        entidad: 'convivencia_caso',
        entidad_id: caseId,
        detalle: { id_evento: event.rows[0].id_evento, tipo: type, participantes: participantIds.length },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.status(201).json({ id_evento: event.rows[0].id_evento });
    } catch (error) {
      await client.query('ROLLBACK');
      safeErrorResponse(res, error, 'No fue posible registrar la actuacion.');
    } finally {
      client.release();
    }
  });

  router.post('/casos/:caseId/cerrar', verifyPermission('convivencia.close'), async (req, res) => {
    const caseId = positiveInteger(req.params.caseId);
    const reason = cleanNarrative(req.body?.motivo, 4000);
    if (!caseId || reason.length < 10) return res.status(400).json({ message: 'Explica el cierre en al menos 10 caracteres.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await requireOpenCase(client, caseId);
      await client.query(`
        UPDATE convivencia_casos
        SET estado = 'CERRADO', motivo_cierre = $1, cerrado_por = $2, cerrado_en = CURRENT_TIMESTAMP,
            actualizado_por = $2, actualizado_en = CURRENT_TIMESTAMP, version = version + 1
        WHERE id_caso = $3
      `, [reason, req.user.id, caseId]);
      await client.query(`
        INSERT INTO convivencia_eventos (id_caso, tipo, titulo, detalle, creado_por)
        VALUES ($1, 'CIERRE', 'Cierre del caso', $2, $3)
      `, [caseId, reason, req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CONVIVENCIA_CASO_CERRADO',
        entidad: 'convivencia_caso',
        entidad_id: caseId,
        detalle: { codigo: current.codigo },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: 'Caso cerrado con trazabilidad.' });
    } catch (error) {
      await client.query('ROLLBACK');
      safeErrorResponse(res, error, 'No fue posible cerrar el caso.');
    } finally {
      client.release();
    }
  });

  router.post('/casos/:caseId/reabrir', verifyPermission('convivencia.close'), async (req, res) => {
    const caseId = positiveInteger(req.params.caseId);
    const reason = cleanNarrative(req.body?.motivo, 4000);
    if (!caseId || reason.length < 10) return res.status(400).json({ message: 'Explica la reapertura en al menos 10 caracteres.' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query(
        "SELECT id_caso, codigo FROM convivencia_casos WHERE id_caso = $1 AND estado = 'CERRADO' FOR UPDATE",
        [caseId]
      );
      if (!current.rowCount) {
        const error = new Error('Solo se puede reabrir un caso cerrado.');
        error.statusCode = 409;
        throw error;
      }
      await client.query(`
        UPDATE convivencia_casos
        SET estado = 'EN_SEGUIMIENTO', motivo_cierre = NULL, cerrado_por = NULL, cerrado_en = NULL,
            actualizado_por = $1, actualizado_en = CURRENT_TIMESTAMP, version = version + 1
        WHERE id_caso = $2
      `, [req.user.id, caseId]);
      await client.query(`
        INSERT INTO convivencia_eventos (id_caso, tipo, titulo, detalle, creado_por)
        VALUES ($1, 'REAPERTURA', 'Reapertura del caso', $2, $3)
      `, [caseId, reason, req.user.id]);
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CONVIVENCIA_CASO_REABIERTO',
        entidad: 'convivencia_caso',
        entidad_id: caseId,
        detalle: { codigo: current.rows[0].codigo },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({ message: 'Caso reabierto para seguimiento.' });
    } catch (error) {
      await client.query('ROLLBACK');
      safeErrorResponse(res, error, 'No fue posible reabrir el caso.');
    } finally {
      client.release();
    }
  });

  router.post('/casos/:caseId/documentos', verifyPermission('convivencia.documents'), async (req, res) => {
    const caseId = positiveInteger(req.params.caseId);
    if (!caseId) return res.status(400).json({ message: 'Caso invalido.' });
    const client = await pool.connect();
    let storedName = null;
    try {
      await client.query('BEGIN');
      await requireOpenCase(client, caseId);
      const eventId = positiveInteger(req.body?.id_evento);
      if (eventId) {
        const event = await client.query('SELECT 1 FROM convivencia_eventos WHERE id_evento = $1 AND id_caso = $2', [eventId, caseId]);
        if (!event.rowCount) {
          const error = new Error('La actuacion seleccionada no pertenece al caso.');
          error.statusCode = 400;
          throw error;
        }
      }
      const document = await createDocument(client, {
        fileData: req.body?.archivo,
        fileName: req.body?.nombre_archivo,
        userId: req.user.id
      });
      storedName = document.nombre_almacenado;
      const result = await client.query(`
        INSERT INTO convivencia_documentos (id_caso, id_evento, id_documento, descripcion, creado_por)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id_convivencia_documento
      `, [caseId, eventId, document.id_documento, cleanText(req.body?.descripcion, 300) || null, req.user.id]);
      await client.query(
        'UPDATE convivencia_casos SET actualizado_por = $1, actualizado_en = CURRENT_TIMESTAMP, version = version + 1 WHERE id_caso = $2',
        [req.user.id, caseId]
      );
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CONVIVENCIA_DOCUMENTO_ADJUNTADO',
        entidad: 'convivencia_caso',
        entidad_id: caseId,
        detalle: { id_convivencia_documento: result.rows[0].id_convivencia_documento, mime_type: document.mime_type, tamano_bytes: document.tamano_bytes },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.status(201).json({ id_convivencia_documento: result.rows[0].id_convivencia_documento });
    } catch (error) {
      await client.query('ROLLBACK');
      if (storedName) await removeStoredFile(storedName).catch(() => {});
      safeErrorResponse(res, error, 'No fue posible adjuntar el documento.');
    } finally {
      client.release();
    }
  });

  router.get('/documentos/:documentId/descargar', verifyPermission('convivencia.documents'), async (req, res) => {
    const documentId = positiveInteger(req.params.documentId);
    if (!documentId) return res.status(400).json({ message: 'Documento invalido.' });
    try {
      const result = await pool.query(`
        SELECT cd.id_caso, d.nombre_original, d.nombre_almacenado, d.mime_type
        FROM convivencia_documentos cd
        JOIN justification_documents d ON d.id_documento = cd.id_documento
        WHERE cd.id_convivencia_documento = $1 AND cd.activo = true
      `, [documentId]);
      if (!result.rowCount) return res.status(404).json({ message: 'El documento no existe.' });
      const document = result.rows[0];
      const filePath = resolveDocumentPath(document.nombre_almacenado);
      if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ message: 'El archivo no esta disponible.' });
      await insertarAudit(pool, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'CONVIVENCIA_DOCUMENTO_DESCARGADO',
        entidad: 'convivencia_caso',
        entidad_id: document.id_caso,
        detalle: { id_convivencia_documento: documentId },
        ip: getClientIp(req)
      });
      res.type(document.mime_type);
      res.setHeader('Cache-Control', 'no-store, max-age=0');
      res.download(filePath, document.nombre_original, (downloadError) => {
        if (!downloadError) return;
        if (!res.headersSent) {
          safeErrorResponse(res, downloadError, 'No fue posible descargar el documento.');
          return;
        }
        console.error('[convivencia] La descarga protegida fue interrumpida:', downloadError.message);
      });
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible descargar el documento.');
    }
  });

  return router;
};

module.exports = {
  CASE_CATEGORIES,
  CASE_PRIORITIES,
  CASE_STATES,
  EVENT_TYPES,
  PARTICIPANT_ROLES,
  PARTICIPANT_TYPES,
  createCoexistenceRouter,
  validateParticipant
};
