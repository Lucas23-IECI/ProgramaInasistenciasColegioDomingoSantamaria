const express = require('express');
const fs = require('fs');
const {
  createDocument,
  createDocumentFromBuffer,
  removeStoredFile,
  resolveDocumentPath
} = require('../services/documentService');
const { createInstitutionalPdf } = require('../services/documentPdfService');
const { recognizeImage, normalizeOcrText } = require('../services/documentOcrService');

const CATEGORIES = new Set([
  'CERTIFICADO', 'JUSTIFICACION', 'AUTORIZACION', 'ACTA', 'COMPROMISO',
  'IDENTIDAD', 'MATRICULA', 'FAMILIAR', 'CONVIVENCIA', 'OTRO'
]);
const STATES = new Set(['PENDIENTE', 'VIGENTE', 'VENCIDO', 'ARCHIVADO']);
const ACCESS_LEVELS = new Set(['INSTITUCIONAL', 'RESERVADO', 'MUY_RESERVADO']);
const SIGNATURE_TYPES = new Set(['REVISION', 'CONFORMIDAD', 'APROBACION']);
const TEMPLATE_CATEGORIES = new Set(['CERTIFICADO', 'JUSTIFICACION', 'AUTORIZACION', 'ACTA', 'COMPROMISO', 'MATRICULA', 'FAMILIAR', 'OTRO']);

const cleanText = (value, max = 300) => String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
const cleanMultiline = (value, max = 12000) => String(value || '').trim().replace(/\r\n/g, '\n').slice(0, max);
const positiveInteger = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};
const isoDate = (value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(String(value));
const booleanValue = (value) => String(value).toLowerCase() === 'true';

const audit = (insertarAudit, queryable, req, action, entity, entityId, detail) => insertarAudit(queryable, {
  usuario_id: req.user.id,
  usuario_correo: req.user.correo,
  accion: action,
  entidad: entity,
  entidad_id: entityId,
  detalle: detail,
  ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || ''
});

const safeErrorResponse = (res, error, fallback) => {
  const candidate = Number(error?.statusCode);
  const clientStatus = Number.isInteger(candidate) && candidate >= 400 && candidate < 500 ? candidate : null;
  const status = clientStatus || (['23503', '23505'].includes(error.code) ? 409 : 500);
  if (status >= 500) console.error('[gestion-documental]', error.message);
  return res.status(status).json({ message: clientStatus ? error.message : fallback });
};

const studentDetailsQuery = `
  SELECT a.id_alumno,
         trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS nombre,
         COALESCE(c.nombre_curso, 'Sin curso') AS curso,
         COALESCE(
           (SELECT ai.valor_original FROM alumno_identificador ai
            WHERE ai.id_alumno = a.id_alumno AND ai.es_principal = true AND ai.estado <> 'REVOCADO'
            ORDER BY ai.id_identificador DESC LIMIT 1),
           NULLIF(trim(concat_ws('-', a.rut, a.dv)), '-'),
           'Sin documento'
         ) AS documento
  FROM alumno a
  LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
  LEFT JOIN curso c ON c.id_curso = m.id_curso
`;

const requireStudent = async (queryable, studentId) => {
  const result = await queryable.query(`${studentDetailsQuery} WHERE a.id_alumno = $1 AND a.activo = true`, [studentId]);
  if (!result.rowCount) {
    const error = new Error('El estudiante no existe o no está activo.');
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
};

const getOrCreateFile = async (client, studentId, userId) => {
  const result = await client.query(`
    INSERT INTO expedientes_documentales (id_alumno, creado_por, actualizado_por)
    VALUES ($1, $2, $2)
    ON CONFLICT (id_alumno) DO UPDATE SET actualizado_en = expedientes_documentales.actualizado_en
    RETURNING id_expediente
  `, [studentId, userId]);
  return result.rows[0].id_expediente;
};

const requireDocument = async (queryable, documentId, { lock = false } = {}) => {
  const result = await queryable.query(`
    SELECT d.*, e.id_alumno
    FROM documentos_expediente d
    JOIN expedientes_documentales e ON e.id_expediente = d.id_expediente
    WHERE d.id_documento_expediente = $1
    ${lock ? 'FOR UPDATE OF d' : ''}
  `, [documentId]);
  if (!result.rowCount) {
    const error = new Error('El documento no existe.');
    error.statusCode = 404;
    throw error;
  }
  return result.rows[0];
};

const createStudentDocumentsRouter = ({ pool, verifyToken, verifyPermission, verifyAnyPermission, insertarAudit }) => {
  const router = express.Router();
  router.use(verifyToken);
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    next();
  });

  router.get('/resumen', verifyPermission('documents.view'), async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE estado <> 'ARCHIVADO')::int AS documentos_activos,
          COUNT(*) FILTER (WHERE estado <> 'ARCHIVADO' AND vence_en < CURRENT_DATE)::int AS vencidos,
          COUNT(*) FILTER (WHERE estado <> 'ARCHIVADO' AND vence_en BETWEEN CURRENT_DATE AND CURRENT_DATE + 30)::int AS vencen_pronto,
          (SELECT COUNT(*)::int FROM documento_expediente_versiones WHERE ocr_estado = 'PROPUESTO') AS ocr_pendientes,
          (SELECT COUNT(*)::int FROM documento_expediente_versiones v
           WHERE NOT EXISTS (SELECT 1 FROM firmas_documentales f WHERE f.id_version = v.id_version AND f.revocada_en IS NULL)) AS sin_firma
        FROM documentos_expediente
      `);
      res.json(result.rows[0]);
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible cargar el resumen documental.');
    }
  });

  router.get('/estudiantes/buscar', verifyPermission('documents.view'), async (req, res) => {
    const search = cleanText(req.query.q, 100);
    if (search.length < 2) return res.json([]);
    try {
      const result = await pool.query(`
        ${studentDetailsQuery}
        WHERE a.activo = true AND (
          trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) ILIKE '%' || $1 || '%'
          OR EXISTS (
            SELECT 1 FROM alumno_identificador ai
            WHERE ai.id_alumno = a.id_alumno AND ai.estado <> 'REVOCADO'
              AND (ai.valor_original ILIKE '%' || $1 || '%' OR ai.valor_normalizado ILIKE '%' || $1 || '%')
          )
        )
        ORDER BY lower(trim(concat_ws(' ', a.nombres, a.paterno, a.materno)))
        LIMIT 20
      `, [search]);
      res.json(result.rows);
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible buscar estudiantes.');
    }
  });

  router.get('/documentos', verifyPermission('documents.view'), async (req, res) => {
    const search = cleanText(req.query.q, 120);
    const category = CATEGORIES.has(String(req.query.categoria || '').toUpperCase()) ? String(req.query.categoria).toUpperCase() : null;
    const state = STATES.has(String(req.query.estado || '').toUpperCase()) ? String(req.query.estado).toUpperCase() : null;
    const expiring = booleanValue(req.query.vencimiento);
    const page = Math.max(1, positiveInteger(req.query.pagina) || 1);
    const limit = Math.min(50, Math.max(10, positiveInteger(req.query.limite) || 20));
    try {
      const result = await pool.query(`
        WITH items AS (
          SELECT d.*,
                 e.id_alumno,
                 trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) AS estudiante_nombre,
                 COALESCE(c.nombre_curso, 'Sin curso') AS curso,
                 COALESCE(NULLIF(trim(u.nombre), ''), u.correo, 'Sin responsable') AS responsable_nombre,
                 CASE WHEN d.estado NOT IN ('ARCHIVADO', 'VENCIDO') AND d.vence_en < CURRENT_DATE THEN 'VENCIDO' ELSE d.estado END AS estado_efectivo,
                 (SELECT COUNT(*)::int FROM documento_expediente_versiones v WHERE v.id_documento_expediente = d.id_documento_expediente) AS versiones,
                 (SELECT v.ocr_estado FROM documento_expediente_versiones v WHERE v.id_documento_expediente = d.id_documento_expediente ORDER BY v.numero_version DESC LIMIT 1) AS ocr_estado
          FROM documentos_expediente d
          JOIN expedientes_documentales e ON e.id_expediente = d.id_expediente
          JOIN alumno a ON a.id_alumno = e.id_alumno
          LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
          LEFT JOIN curso c ON c.id_curso = m.id_curso
          LEFT JOIN usuarios u ON u.id = d.responsable_usuario_id
          WHERE ($1 = '' OR d.titulo ILIKE '%' || $1 || '%' OR trim(concat_ws(' ', a.nombres, a.paterno, a.materno)) ILIKE '%' || $1 || '%')
            AND ($2::varchar IS NULL OR d.categoria = $2)
            AND ($3::varchar IS NULL OR CASE WHEN d.estado NOT IN ('ARCHIVADO', 'VENCIDO') AND d.vence_en < CURRENT_DATE THEN 'VENCIDO' ELSE d.estado END = $3)
            AND ($4::boolean = false OR d.vence_en <= CURRENT_DATE + 30)
        )
        SELECT items.*, COUNT(*) OVER()::int AS total
        FROM items
        ORDER BY CASE WHEN vence_en < CURRENT_DATE THEN 0 WHEN vence_en <= CURRENT_DATE + 30 THEN 1 ELSE 2 END,
                 actualizado_en DESC
        LIMIT $5 OFFSET $6
      `, [search, category, state, expiring, limit, (page - 1) * limit]);
      res.json({
        items: result.rows.map(({ total, ...row }) => row),
        total: result.rows[0]?.total || 0,
        pagina: page,
        limite: limit
      });
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible cargar los documentos.');
    }
  });

  router.get('/estudiantes/:studentId/expediente', verifyPermission('documents.view'), async (req, res) => {
    const studentId = positiveInteger(req.params.studentId);
    if (!studentId) return res.status(400).json({ message: 'Selecciona un estudiante válido para abrir su expediente.' });
    try {
      const student = await requireStudent(pool, studentId);
      const file = await pool.query('SELECT * FROM expedientes_documentales WHERE id_alumno = $1', [studentId]);
      if (!file.rowCount) return res.json({ student, file: null, documents: [] });
      const documents = await pool.query(`
        SELECT d.*,
               COALESCE(NULLIF(trim(u.nombre), ''), u.correo, 'Sin responsable') AS responsable_nombre,
               CASE WHEN d.estado NOT IN ('ARCHIVADO', 'VENCIDO') AND d.vence_en < CURRENT_DATE THEN 'VENCIDO' ELSE d.estado END AS estado_efectivo,
               (SELECT COUNT(*)::int FROM documento_expediente_versiones v WHERE v.id_documento_expediente = d.id_documento_expediente) AS versiones,
               (SELECT v.id_version FROM documento_expediente_versiones v WHERE v.id_documento_expediente = d.id_documento_expediente ORDER BY v.numero_version DESC LIMIT 1) AS ultima_version_id,
               (SELECT v.ocr_estado FROM documento_expediente_versiones v WHERE v.id_documento_expediente = d.id_documento_expediente ORDER BY v.numero_version DESC LIMIT 1) AS ocr_estado,
               (SELECT COUNT(*)::int FROM firmas_documentales f JOIN documento_expediente_versiones v ON v.id_version = f.id_version WHERE v.id_documento_expediente = d.id_documento_expediente AND f.revocada_en IS NULL) AS firmas
        FROM documentos_expediente d
        LEFT JOIN usuarios u ON u.id = d.responsable_usuario_id
        WHERE d.id_expediente = $1
        ORDER BY d.estado = 'ARCHIVADO', d.actualizado_en DESC
      `, [file.rows[0].id_expediente]);
      res.json({ student, file: file.rows[0], documents: documents.rows });
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible cargar el expediente.');
    }
  });

  router.get('/documentos/:documentId', verifyPermission('documents.view'), async (req, res) => {
    const documentId = positiveInteger(req.params.documentId);
    if (!documentId) return res.status(400).json({ message: 'El documento seleccionado no es válido. Vuelve al expediente y ábrelo nuevamente.' });
    try {
      const document = await requireDocument(pool, documentId);
      const [student, versions] = await Promise.all([
        requireStudent(pool, document.id_alumno),
        pool.query(`
          SELECT v.*, jd.nombre_original, jd.mime_type, jd.tamano_bytes, jd.sha256,
                 COALESCE(NULLIF(trim(u.nombre), ''), u.correo, 'Cuenta histórica') AS creado_por_nombre,
                 COALESCE(json_agg(json_build_object(
                   'id_firma', f.id_firma, 'tipo', f.tipo, 'firmante_nombre', f.firmante_nombre,
                   'firmante_cargo', f.firmante_cargo, 'declaracion', f.declaracion,
                   'firmada_en', f.firmada_en, 'revocada_en', f.revocada_en
                 ) ORDER BY f.firmada_en) FILTER (WHERE f.id_firma IS NOT NULL), '[]'::json) AS firmas
          FROM documento_expediente_versiones v
          JOIN justification_documents jd ON jd.id_documento = v.id_documento
          LEFT JOIN usuarios u ON u.id = v.creado_por
          LEFT JOIN firmas_documentales f ON f.id_version = v.id_version
          WHERE v.id_documento_expediente = $1
          GROUP BY v.id_version, jd.id_documento, u.id
          ORDER BY v.numero_version DESC
        `, [documentId])
      ]);
      res.json({ document, student, versions: versions.rows });
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible cargar la ficha documental.');
    }
  });

  router.post('/estudiantes/:studentId/documentos', verifyPermission('documents.upload'), async (req, res) => {
    const studentId = positiveInteger(req.params.studentId);
    const category = String(req.body.categoria || '').toUpperCase();
    const state = String(req.body.estado || 'VIGENTE').toUpperCase();
    const accessLevel = String(req.body.nivel_acceso || 'RESERVADO').toUpperCase();
    const title = cleanText(req.body.titulo, 180);
    if (!studentId || !CATEGORIES.has(category) || !STATES.has(state) || !ACCESS_LEVELS.has(accessLevel) || title.length < 3) {
      return res.status(400).json({ message: 'Revisa estudiante, categoría, estado, acceso y título.' });
    }
    if (!isoDate(req.body.vigente_desde) || !isoDate(req.body.vence_en)) return res.status(400).json({ message: 'Las fechas de vigencia no son válidas.' });
    if (req.body.vigente_desde && req.body.vence_en && req.body.vence_en < req.body.vigente_desde) {
      return res.status(400).json({ message: 'La fecha de vencimiento no puede ser anterior al inicio de vigencia.' });
    }
    const client = await pool.connect();
    let storedName = null;
    try {
      await client.query('BEGIN');
      await requireStudent(client, studentId);
      const fileId = await getOrCreateFile(client, studentId, req.user.id);
      const created = await client.query(`
        INSERT INTO documentos_expediente (
          id_expediente, categoria, titulo, descripcion, estado, nivel_acceso,
          vigente_desde, vence_en, responsable_usuario_id, creado_por, actualizado_por
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
        RETURNING *
      `, [fileId, category, title, cleanText(req.body.descripcion, 600) || null, state, accessLevel,
        req.body.vigente_desde || null, req.body.vence_en || null,
        positiveInteger(req.body.responsable_usuario_id) || req.user.id, req.user.id]);
      const binary = await createDocument(client, {
        fileData: req.body.fileData,
        fileName: req.body.fileName,
        userId: req.user.id
      });
      storedName = binary.nombre_almacenado;
      const version = await client.query(`
        INSERT INTO documento_expediente_versiones (
          id_documento_expediente, numero_version, id_documento, origen, notas_version, creado_por
        ) VALUES ($1, 1, $2, 'CARGA', $3, $4)
        RETURNING id_version, numero_version
      `, [created.rows[0].id_documento_expediente, binary.id_documento, cleanText(req.body.notas_version, 600) || null, req.user.id]);
      await audit(insertarAudit, client, req, 'DOCUMENTO_ESTUDIANTE_CREADO', 'documento_expediente', created.rows[0].id_documento_expediente, {
        alumno_id: studentId, categoria: category, estado: state, nivel_acceso: accessLevel, version: 1
      });
      await client.query('COMMIT');
      storedName = null;
      res.status(201).json({ document: created.rows[0], version: version.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (storedName) await removeStoredFile(storedName).catch(() => {});
      safeErrorResponse(res, error, 'No fue posible incorporar el documento.');
    } finally {
      client.release();
    }
  });

  router.post('/documentos/:documentId/versiones', verifyPermission('documents.upload'), async (req, res) => {
    const documentId = positiveInteger(req.params.documentId);
    if (!documentId) return res.status(400).json({ message: 'El documento seleccionado no es válido. Vuelve al expediente y ábrelo nuevamente.' });
    const client = await pool.connect();
    let storedName = null;
    try {
      await client.query('BEGIN');
      await requireDocument(client, documentId, { lock: true });
      const next = await client.query('SELECT COALESCE(MAX(numero_version), 0) + 1 AS numero FROM documento_expediente_versiones WHERE id_documento_expediente = $1', [documentId]);
      const binary = await createDocument(client, { fileData: req.body.fileData, fileName: req.body.fileName, userId: req.user.id });
      storedName = binary.nombre_almacenado;
      const version = await client.query(`
        INSERT INTO documento_expediente_versiones (
          id_documento_expediente, numero_version, id_documento, origen, notas_version, creado_por
        ) VALUES ($1, $2, $3, 'CARGA', $4, $5)
        RETURNING id_version, numero_version
      `, [documentId, next.rows[0].numero, binary.id_documento, cleanText(req.body.notas_version, 600) || null, req.user.id]);
      await client.query('UPDATE documentos_expediente SET actualizado_en = CURRENT_TIMESTAMP, actualizado_por = $2, version_registro = version_registro + 1 WHERE id_documento_expediente = $1', [documentId, req.user.id]);
      await audit(insertarAudit, client, req, 'VERSION_DOCUMENTAL_CREADA', 'documento_expediente', documentId, { version: version.rows[0].numero_version });
      await client.query('COMMIT');
      storedName = null;
      res.status(201).json(version.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (storedName) await removeStoredFile(storedName).catch(() => {});
      safeErrorResponse(res, error, 'No fue posible agregar la versión.');
    } finally {
      client.release();
    }
  });

  router.patch('/documentos/:documentId', verifyPermission('documents.manage'), async (req, res) => {
    const documentId = positiveInteger(req.params.documentId);
    const expectedVersion = positiveInteger(req.body.version_registro);
    if (!documentId || !expectedVersion) return res.status(400).json({ message: 'El documento cambió o la versión abierta ya no es válida. Recarga la ficha antes de editar.' });
    const category = String(req.body.categoria || '').toUpperCase();
    const state = String(req.body.estado || '').toUpperCase();
    const accessLevel = String(req.body.nivel_acceso || '').toUpperCase();
    const title = cleanText(req.body.titulo, 180);
    if (!CATEGORIES.has(category) || !STATES.has(state) || !ACCESS_LEVELS.has(accessLevel) || title.length < 3) {
      return res.status(400).json({ message: 'Revisa categoría, estado, acceso y título.' });
    }
    if (!isoDate(req.body.vigente_desde) || !isoDate(req.body.vence_en) || (req.body.vigente_desde && req.body.vence_en && req.body.vence_en < req.body.vigente_desde)) {
      return res.status(400).json({ message: 'El período de vigencia no es válido.' });
    }
    try {
      const result = await pool.query(`
        UPDATE documentos_expediente
        SET categoria = $2, titulo = $3, descripcion = $4, estado = $5, nivel_acceso = $6,
            vigente_desde = $7, vence_en = $8, responsable_usuario_id = $9,
            actualizado_por = $10, actualizado_en = CURRENT_TIMESTAMP, version_registro = version_registro + 1
        WHERE id_documento_expediente = $1 AND version_registro = $11
        RETURNING *
      `, [documentId, category, title, cleanText(req.body.descripcion, 600) || null, state, accessLevel,
        req.body.vigente_desde || null, req.body.vence_en || null,
        positiveInteger(req.body.responsable_usuario_id) || req.user.id, req.user.id, expectedVersion]);
      if (!result.rowCount) return res.status(409).json({ message: 'La ficha cambió en otra sesión. Recarga antes de guardar.' });
      await audit(insertarAudit, pool, req, 'DOCUMENTO_ESTUDIANTE_EDITADO', 'documento_expediente', documentId, {
        categoria: category, estado: state, nivel_acceso: accessLevel, version_registro: result.rows[0].version_registro
      });
      res.json(result.rows[0]);
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible actualizar el documento.');
    }
  });

  router.get('/versiones/:versionId/descargar', verifyPermission('documents.view'), async (req, res) => {
    const versionId = positiveInteger(req.params.versionId);
    if (!versionId) return res.status(400).json({ message: 'La versión seleccionada no es válida. Recarga la ficha e inténtalo nuevamente.' });
    try {
      const result = await pool.query(`
        SELECT v.id_version, v.id_documento_expediente, jd.nombre_original, jd.nombre_almacenado
        FROM documento_expediente_versiones v
        JOIN justification_documents jd ON jd.id_documento = v.id_documento
        WHERE v.id_version = $1
      `, [versionId]);
      if (!result.rowCount) return res.status(404).json({ message: 'La versión no existe.' });
      const filePath = resolveDocumentPath(result.rows[0].nombre_almacenado);
      if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ message: 'El archivo protegido no está disponible.' });
      await audit(insertarAudit, pool, req, 'DOCUMENTO_ESTUDIANTE_DESCARGADO', 'documento_expediente', result.rows[0].id_documento_expediente, { version_id: versionId });
      res.download(filePath, result.rows[0].nombre_original, (error) => {
        if (error && !res.headersSent) res.status(500).json({ message: 'La descarga se interrumpió.' });
      });
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible descargar el documento.');
    }
  });

  router.get('/plantillas', verifyAnyPermission(['documents.view', 'documents.templates']), async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT p.*,
               COALESCE(NULLIF(trim(u.nombre), ''), u.correo, 'Sistema') AS actualizado_por_nombre
        FROM plantillas_documentales p
        LEFT JOIN usuarios u ON u.id = p.actualizado_por
        WHERE ($1::boolean = true OR p.activa = true)
        ORDER BY p.activa DESC, p.sistema DESC, lower(p.nombre)
      `, [booleanValue(req.query.incluir_inactivas)]);
      res.json(result.rows);
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible cargar las plantillas.');
    }
  });

  router.post('/plantillas', verifyPermission('documents.templates'), async (req, res) => {
    const name = cleanText(req.body.nombre, 180);
    const category = String(req.body.categoria || '').toUpperCase();
    const content = cleanMultiline(req.body.contenido, 12000);
    const allowedFields = Array.isArray(req.body.campos_permitidos)
      ? [...new Set(req.body.campos_permitidos.map((field) => cleanText(field, 48).toLowerCase()).filter((field) => /^[a-z0-9_]+$/.test(field)))].slice(0, 30)
      : [];
    if (name.length < 3 || !TEMPLATE_CATEGORIES.has(category) || content.length < 20) {
      return res.status(400).json({ message: 'La plantilla necesita nombre, categoría y contenido suficiente.' });
    }
    try {
      const result = await pool.query(`
        INSERT INTO plantillas_documentales (
          codigo, nombre, categoria, descripcion, contenido, campos_permitidos, activa, sistema, creado_por, actualizado_por
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, true, false, $7, $7)
        RETURNING *
      `, [`PERSONAL_${Date.now()}`, name, category, cleanText(req.body.descripcion, 600) || null,
        content, JSON.stringify(allowedFields), req.user.id]);
      await audit(insertarAudit, pool, req, 'PLANTILLA_DOCUMENTAL_CREADA', 'plantilla_documental', result.rows[0].id_plantilla, { categoria: category, campos: allowedFields.length });
      res.status(201).json(result.rows[0]);
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible crear la plantilla.');
    }
  });

  router.post('/estudiantes/:studentId/generar', verifyPermission('documents.templates'), async (req, res) => {
    const studentId = positiveInteger(req.params.studentId);
    const templateId = positiveInteger(req.body.id_plantilla);
    if (!isoDate(req.body.vence_en)) return res.status(400).json({ message: 'Ingresa una fecha de vencimiento válida.' });
    if (!studentId || !templateId) return res.status(400).json({ message: 'Selecciona un estudiante y una plantilla válidos antes de generar el documento.' });
    const client = await pool.connect();
    let storedName = null;
    try {
      await client.query('BEGIN');
      const student = await requireStudent(client, studentId);
      const templateResult = await client.query('SELECT * FROM plantillas_documentales WHERE id_plantilla = $1 AND activa = true', [templateId]);
      if (!templateResult.rowCount) {
        const error = new Error('La plantilla no existe o está desactivada.');
        error.statusCode = 404;
        throw error;
      }
      const template = templateResult.rows[0];
      const automaticValues = {
        estudiante_nombre: student.nombre,
        estudiante_documento: student.documento,
        curso: student.curso,
        fecha_emision: new Intl.DateTimeFormat('es-CL', { dateStyle: 'long', timeZone: 'America/Santiago' }).format(new Date())
      };
      const values = { ...req.body.valores, ...automaticValues };
      const generatedBy = req.user.nombre || req.user.correo;
      const pdf = await createInstitutionalPdf({ template, values, student, generatedBy });
      const fileId = await getOrCreateFile(client, studentId, req.user.id);
      const created = await client.query(`
        INSERT INTO documentos_expediente (
          id_expediente, categoria, titulo, descripcion, estado, nivel_acceso,
          vigente_desde, vence_en, responsable_usuario_id, creado_por, actualizado_por
        ) VALUES ($1, $2, $3, $4, 'PENDIENTE', 'RESERVADO', CURRENT_DATE, $5, $6, $6, $6)
        RETURNING *
      `, [fileId, template.categoria, cleanText(req.body.titulo, 180) || template.nombre,
        `Generado desde la plantilla ${template.nombre}. Requiere revisión antes de marcarlo vigente.`,
        req.body.vence_en || null, req.user.id]);
      const binary = await createDocumentFromBuffer(client, {
        buffer: pdf,
        fileName: `${template.codigo.toLowerCase()}-${studentId}.pdf`,
        mimeType: 'application/pdf',
        extension: '.pdf',
        userId: req.user.id
      });
      storedName = binary.nombre_almacenado;
      const version = await client.query(`
        INSERT INTO documento_expediente_versiones (
          id_documento_expediente, numero_version, id_documento, origen, notas_version, ocr_estado, creado_por
        ) VALUES ($1, 1, $2, 'PLANTILLA', $3, 'NO_COMPATIBLE', $4)
        RETURNING id_version, numero_version
      `, [created.rows[0].id_documento_expediente, binary.id_documento, `Plantilla ${template.codigo}`, req.user.id]);
      await audit(insertarAudit, client, req, 'PDF_INSTITUCIONAL_GENERADO', 'documento_expediente', created.rows[0].id_documento_expediente, {
        alumno_id: studentId, plantilla_codigo: template.codigo, version_id: version.rows[0].id_version
      });
      await client.query('COMMIT');
      storedName = null;
      res.status(201).json({ document: created.rows[0], version: version.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (storedName) await removeStoredFile(storedName).catch(() => {});
      safeErrorResponse(res, error, 'No fue posible generar el PDF institucional.');
    } finally {
      client.release();
    }
  });

  router.post('/versiones/:versionId/ocr', verifyPermission('documents.ocr'), async (req, res) => {
    const versionId = positiveInteger(req.params.versionId);
    if (!versionId) return res.status(400).json({ message: 'La versión seleccionada no es válida. Recarga la ficha e inténtalo nuevamente.' });
    try {
      const result = await pool.query(`
        SELECT v.id_version, v.id_documento_expediente, jd.mime_type, jd.nombre_almacenado
        FROM documento_expediente_versiones v
        JOIN justification_documents jd ON jd.id_documento = v.id_documento
        WHERE v.id_version = $1
      `, [versionId]);
      if (!result.rowCount) return res.status(404).json({ message: 'La versión no existe.' });
      const version = result.rows[0];
      const filePath = resolveDocumentPath(version.nombre_almacenado);
      if (!filePath || !fs.existsSync(filePath)) return res.status(404).json({ message: 'El archivo protegido no está disponible.' });
      await pool.query("UPDATE documento_expediente_versiones SET ocr_estado = 'PENDIENTE' WHERE id_version = $1", [versionId]);
      let proposal;
      try {
        proposal = await recognizeImage({ filePath, mimeType: version.mime_type });
      } catch (ocrError) {
        await pool.query("UPDATE documento_expediente_versiones SET ocr_estado = 'ERROR', ocr_motor = $2 WHERE id_version = $1", [versionId, cleanText(ocrError.message, 80)]);
        throw Object.assign(new Error('El OCR local no pudo procesar esta imagen. El archivo permanece intacto.'), { statusCode: 422 });
      }
      await pool.query(`
        UPDATE documento_expediente_versiones
        SET ocr_estado = $2, ocr_texto_propuesto = $3, ocr_datos_propuestos = $4::jsonb,
            ocr_confianza = $5, ocr_motor = $6, ocr_revisado_por = NULL, ocr_revisado_en = NULL
        WHERE id_version = $1
      `, [versionId, proposal.estado, proposal.texto || null, JSON.stringify(proposal.datos || {}), proposal.confianza, proposal.motor]);
      await audit(insertarAudit, pool, req, 'OCR_DOCUMENTAL_PROPUESTO', 'documento_expediente', version.id_documento_expediente, {
        version_id: versionId, estado: proposal.estado, confianza: proposal.confianza,
        caracteres: proposal.texto?.length || 0
      });
      res.json(proposal);
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible ejecutar el OCR local.');
    }
  });

  router.post('/versiones/:versionId/ocr/revisar', verifyPermission('documents.ocr'), async (req, res) => {
    const versionId = positiveInteger(req.params.versionId);
    const action = String(req.body.accion || '').toUpperCase();
    if (!versionId || !['APROBAR', 'RECHAZAR'].includes(action)) return res.status(400).json({ message: 'Selecciona una versión disponible e indica si aprobarás o rechazarás la propuesta OCR.' });
    const reviewedText = normalizeOcrText(req.body.texto_revisado);
    if (action === 'APROBAR' && reviewedText.length < 2) return res.status(400).json({ message: 'La revisión aprobada necesita texto verificado.' });
    try {
      const result = await pool.query(`
        UPDATE documento_expediente_versiones
        SET ocr_estado = $2::varchar,
            ocr_texto_propuesto = CASE WHEN $2::varchar = 'REVISADO' THEN $3::text ELSE ocr_texto_propuesto END,
            ocr_revisado_por = $4, ocr_revisado_en = CURRENT_TIMESTAMP
        WHERE id_version = $1 AND ocr_estado = 'PROPUESTO'
        RETURNING id_documento_expediente, ocr_estado
      `, [versionId, action === 'APROBAR' ? 'REVISADO' : 'RECHAZADO', reviewedText || null, req.user.id]);
      if (!result.rowCount) return res.status(409).json({ message: 'La propuesta ya fue revisada o no está disponible.' });
      await audit(insertarAudit, pool, req, 'OCR_DOCUMENTAL_REVISADO', 'documento_expediente', result.rows[0].id_documento_expediente, {
        version_id: versionId, decision: action, caracteres_revisados: action === 'APROBAR' ? reviewedText.length : 0
      });
      res.json({ estado: result.rows[0].ocr_estado });
    } catch (error) {
      safeErrorResponse(res, error, 'No fue posible guardar la revisión OCR.');
    }
  });

  router.post('/versiones/:versionId/firmar', verifyPermission('documents.sign'), async (req, res) => {
    const versionId = positiveInteger(req.params.versionId);
    const type = String(req.body.tipo || '').toUpperCase();
    const declaration = cleanText(req.body.declaracion, 600);
    if (!versionId || !SIGNATURE_TYPES.has(type) || declaration.length < 12) {
      return res.status(400).json({ message: 'Indica el tipo de firma y una declaración explícita.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const version = await client.query(`
        SELECT v.id_documento_expediente, jd.sha256
        FROM documento_expediente_versiones v
        JOIN justification_documents jd ON jd.id_documento = v.id_documento
        WHERE v.id_version = $1
        FOR UPDATE OF v
      `, [versionId]);
      if (!version.rowCount) {
        const error = new Error('La versión no existe.');
        error.statusCode = 404;
        throw error;
      }
      const user = await client.query(`
        SELECT COALESCE(NULLIF(trim(nombre), ''), correo) AS nombre, COALESCE(NULLIF(trim(cargo), ''), rol) AS cargo
        FROM usuarios WHERE id = $1
      `, [req.user.id]);
      const signature = await client.query(`
        INSERT INTO firmas_documentales (
          id_version, tipo, firmante_usuario_id, firmante_nombre, firmante_cargo,
          declaracion, sha256_version
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `, [versionId, type, req.user.id, user.rows[0].nombre, user.rows[0].cargo, declaration, version.rows[0].sha256]);
      await audit(insertarAudit, client, req, 'DOCUMENTO_FIRMADO_INTERNAMENTE', 'documento_expediente', version.rows[0].id_documento_expediente, {
        version_id: versionId, tipo: type, firma_id: signature.rows[0].id_firma,
        alcance: 'FIRMA_ELECTRONICA_INTERNA_NO_AVANZADA'
      });
      await client.query('COMMIT');
      res.status(201).json(signature.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      safeErrorResponse(res, error, 'No fue posible registrar la firma interna.');
    } finally {
      client.release();
    }
  });

  return router;
};

module.exports = {
  ACCESS_LEVELS,
  CATEGORIES,
  SIGNATURE_TYPES,
  STATES,
  createStudentDocumentsRouter
};
