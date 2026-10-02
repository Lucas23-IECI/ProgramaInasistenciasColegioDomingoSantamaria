const { assignEnrollment, closeEnrollment } = require('./enrollmentService');

const STUDENT_FIELDS = Object.freeze([
  'uuid_erp', 'rut', 'dv', 'documento_erp', 'tipo_identificador',
  'tipo_documento_extranjero', 'pais_emisor_documento', 'nombres', 'paterno',
  'materno', 'email', 'telefono', 'rol', 'seccion', 'genero',
  'fecha_nacimiento', 'nombre_usuario', 'rut_apoderado', 'codigo_barra',
  'origen_alta', 'erp_vinculado_en', 'activo'
]);

const IDENTIFIER_FIELDS = Object.freeze([
  'tipo', 'valor_original', 'valor_normalizado', 'pais_emisor', 'fuente', 'estado',
  'es_principal', 'nivel_validacion', 'validador_id', 'validador_version',
  'resultado_validacion', 'validado_en', 'vigente_desde', 'vigente_hasta', 'metadatos'
]);

const stableObject = (value) => {
  if (Array.isArray(value)) return value.map(stableObject);
  if (!value || typeof value !== 'object' || value instanceof Date) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableObject(value[key])])
  );
};

const normalizeComparable = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(stableObject(value));
  return String(value);
};

const differentFields = (current, expected, fields) => fields.filter(
  (field) => normalizeComparable(current?.[field]) !== normalizeComparable(expected?.[field])
);

const getRollbackData = (change, side) => change?.[side]?.reversion || null;

const loadImportRollbackContext = async (queryable, importId, { lock = false } = {}) => {
  const record = await queryable.query(
    `SELECT i.*, u.nombre AS importado_por_nombre,
            r.nombre AS revertido_por_nombre
     FROM importaciones_estudiantes i
     LEFT JOIN usuarios u ON u.id = i.importado_por
     LEFT JOIN usuarios r ON r.id = i.revertida_por
     WHERE i.id = $1
     ${lock ? 'FOR UPDATE OF i' : ''}`,
    [importId]
  );
  if (!record.rowCount) return { found: false };

  const changesResult = await queryable.query(
    `SELECT c.*
     FROM importacion_estudiante_cambios c
     WHERE c.importacion_id = $1
     ORDER BY c.numero_fila NULLS LAST, c.id`,
    [importId]
  );
  const changes = changesResult.rows;
  const studentIds = [...new Set(changes.map((change) => Number(change.id_alumno)).filter(Boolean))];
  const identifierIds = [...new Set(changes.flatMap((change) => (
    getRollbackData(change, 'posterior')?.identifiers || []
  )).map((identifier) => Number(identifier?.id_identificador)).filter(Boolean))];

  const students = studentIds.length ? await queryable.query(
    `SELECT a.id_alumno, a.uuid_erp, a.rut, a.dv, a.documento_erp,
            a.tipo_identificador, a.tipo_documento_extranjero, a.pais_emisor_documento,
            a.nombres, a.paterno, a.materno, a.email, a.telefono, a.rol,
            a.seccion, a.genero, a.fecha_nacimiento::text AS fecha_nacimiento,
            a.nombre_usuario, a.rut_apoderado, a.codigo_barra, a.origen_alta,
            a.erp_vinculado_en, a.activo, m.id_curso,
            s.raw_payload AS excel_snapshot
     FROM alumno a
     LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
     LEFT JOIN alumno_excel_snapshot s ON s.id_alumno = a.id_alumno
     WHERE a.id_alumno = ANY($1::int[])
     ${lock ? 'FOR UPDATE OF a' : ''}`,
    [studentIds]
  ) : { rows: [] };
  const identifiers = identifierIds.length ? await queryable.query(
    `SELECT id_identificador, id_alumno, tipo, valor_original, valor_normalizado,
            pais_emisor, fuente, estado, es_principal, nivel_validacion,
            validador_id, validador_version, resultado_validacion, validado_en,
            vigente_desde, vigente_hasta, metadatos
     FROM alumno_identificador
     WHERE id_identificador = ANY($1::bigint[])
     ${lock ? 'FOR UPDATE' : ''}`,
    [identifierIds]
  ) : { rows: [] };
  const laterChanges = studentIds.length ? await queryable.query(
    `SELECT DISTINCT c.id_alumno
     FROM importacion_estudiante_cambios c
     JOIN importaciones_estudiantes i ON i.id = c.importacion_id
     WHERE c.id_alumno = ANY($1::int[])
       AND i.id <> $3
       AND i.importado_en > $2
       AND i.estado <> 'REVERTIDA'
       AND c.accion NOT IN ('SIN_CAMBIOS', 'RECHAZADO', 'CONFLICTO')`,
    [studentIds, record.rows[0].importado_en, importId]
  ) : { rows: [] };
  const downstream = studentIds.length ? await queryable.query(
    `SELECT DISTINCT id_alumno FROM (
       SELECT id_alumno FROM attendance_registrations WHERE id_alumno = ANY($1::int[])
       UNION ALL SELECT id_alumno FROM retiros_alumno WHERE id_alumno = ANY($1::int[])
       UNION ALL SELECT id_alumno FROM personas_autorizadas_retiro WHERE id_alumno = ANY($1::int[])
       UNION ALL SELECT id_alumno FROM expedientes_documentales WHERE id_alumno = ANY($1::int[])
       UNION ALL SELECT id_alumno FROM seguimiento_caso_estudiantes WHERE id_alumno = ANY($1::int[])
       UNION ALL SELECT estudiante_id AS id_alumno FROM convivencia_participantes WHERE estudiante_id = ANY($1::int[])
     ) dependencias`,
    [studentIds]
  ) : { rows: [] };

  return {
    found: true,
    importRecord: record.rows[0],
    changes,
    students: new Map(students.rows.map((student) => [Number(student.id_alumno), student])),
    identifiers: new Map(identifiers.rows.map((identifier) => [Number(identifier.id_identificador), identifier])),
    laterStudentIds: new Set(laterChanges.rows.map((row) => Number(row.id_alumno))),
    downstreamStudentIds: new Set(downstream.rows.map((row) => Number(row.id_alumno)))
  };
};

const previewStudentImportRollback = async (queryable, importId, options = {}) => {
  const context = await loadImportRollbackContext(queryable, importId, options);
  if (!context.found) return { found: false };
  const { importRecord, students, identifiers, laterStudentIds, downstreamStudentIds } = context;
  const rows = context.changes.map((change) => {
    const studentId = Number(change.id_alumno) || null;
    if (['SIN_CAMBIOS', 'RECHAZADO', 'CONFLICTO'].includes(change.accion) || !studentId) {
      return { change_id: change.id, student_id: studentId, action: change.accion, status: 'OMITIDO', reasons: ['La fila no produjo cambios persistentes.'] };
    }
    const before = getRollbackData(change, 'anterior');
    const after = getRollbackData(change, 'posterior');
    const reasons = [];
    if (!before || !after || Number(importRecord.version_reversion || 0) < 1) {
      reasons.push('La importación es anterior al formato de reversión segura.');
    }
    if (laterStudentIds.has(studentId)) reasons.push('La ficha participa en una importación posterior.');
    if (change.accion === 'CREADO' && downstreamStudentIds.has(studentId)) {
      reasons.push('La ficha creada ya tiene actividad institucional asociada.');
    }
    const current = students.get(studentId);
    if (!current) reasons.push('La ficha estudiantil ya no está disponible.');
    if (current && after?.student) {
      const expectedFields = STUDENT_FIELDS.filter((field) => Object.hasOwn(after.student, field));
      const changed = differentFields(current, after.student, expectedFields);
      if (changed.length) reasons.push('La ficha recibió cambios posteriores a esta importación.');
      if (normalizeComparable(current.id_curso) !== normalizeComparable(after.enrollment?.id_curso)) {
        reasons.push('La matrícula o el curso cambiaron después de la importación.');
      }
      if (change.accion !== 'RETIRADO_POR_NOMINA'
        && normalizeComparable(current.excel_snapshot) !== normalizeComparable(after.excel_snapshot)) {
        reasons.push('La referencia de la planilla fue reemplazada por otra carga.');
      }
    }
    for (const expectedIdentifier of after?.identifiers || []) {
      const currentIdentifier = identifiers.get(Number(expectedIdentifier.id_identificador));
      if (!currentIdentifier || differentFields(currentIdentifier, expectedIdentifier, IDENTIFIER_FIELDS).length) {
        reasons.push('Un identificador de la ficha fue modificado después de la importación.');
        break;
      }
    }
    return {
      change_id: change.id,
      student_id: studentId,
      action: change.accion,
      status: reasons.length ? 'BLOQUEADO' : 'REVERSIBLE',
      reasons
    };
  });
  const summary = rows.reduce((accumulator, row) => {
    accumulator[row.status.toLowerCase()] = (accumulator[row.status.toLowerCase()] || 0) + 1;
    return accumulator;
  }, { reversible: 0, bloqueado: 0, omitido: 0 });
  const globalReasons = [];
  if (importRecord.estado === 'REVERTIDA') globalReasons.push('Esta importación ya fue revertida.');
  if (Number(importRecord.version_reversion || 0) < 1) globalReasons.push('El registro no contiene un punto de restauración verificable.');
  return {
    found: true,
    import: importRecord,
    rows,
    summary,
    can_revert: !globalReasons.length && summary.bloqueado === 0 && summary.reversible > 0,
    global_reasons: globalReasons,
    _context: context
  };
};

const restoreIdentifiers = async (client, before = [], after = []) => {
  const beforeById = new Map(before.map((item) => [Number(item.id_identificador), item]));
  for (const current of after) {
    const original = beforeById.get(Number(current.id_identificador));
    if (!original) {
      await client.query(
        `UPDATE alumno_identificador
         SET estado = 'REVOCADO', es_principal = false,
             vigente_hasta = COALESCE(vigente_hasta, CURRENT_DATE),
             actualizado_en = CURRENT_TIMESTAMP
         WHERE id_identificador = $1`,
        [current.id_identificador]
      );
    }
  }
  for (const original of before) {
    await client.query(
      `UPDATE alumno_identificador
       SET tipo = $1, valor_original = $2, valor_normalizado = $3, pais_emisor = $4,
           fuente = $5, estado = $6, es_principal = $7, nivel_validacion = $8,
           validador_id = $9, validador_version = $10, resultado_validacion = $11,
           validado_en = $12, vigente_desde = $13, vigente_hasta = $14,
           metadatos = $15::jsonb, actualizado_en = CURRENT_TIMESTAMP
       WHERE id_identificador = $16`,
      [
        original.tipo, original.valor_original, original.valor_normalizado, original.pais_emisor,
        original.fuente, original.estado, original.es_principal, original.nivel_validacion,
        original.validador_id, original.validador_version, original.resultado_validacion,
        original.validado_en, original.vigente_desde, original.vigente_hasta,
        JSON.stringify(original.metadatos || {}), original.id_identificador
      ]
    );
  }
};

const restoreStudent = async (client, studentId, snapshot) => {
  const fields = STUDENT_FIELDS.filter((field) => Object.hasOwn(snapshot || {}, field));
  if (!fields.length) return;
  const assignments = fields.map((field, index) => `${field} = $${index + 1}`);
  await client.query(
    `UPDATE alumno SET ${assignments.join(', ')}, fecha_actualizacion = CURRENT_TIMESTAMP
     WHERE id_alumno = $${fields.length + 1}`,
    [...fields.map((field) => snapshot[field] ?? null), studentId]
  );
};

const restoreEnrollment = async (client, studentId, enrollment, userId, importId) => {
  await closeEnrollment(client, {
    studentId,
    userId,
    reason: `Reversión segura de importación #${importId}`
  });
  if (enrollment?.id_curso) {
    await assignEnrollment(client, {
      studentId,
      courseId: Number(enrollment.id_curso),
      userId,
      reason: `Restauración de curso anterior a importación #${importId}`
    });
  }
};

const restoreExcelSnapshot = async (client, studentId, snapshot) => {
  if (snapshot === null || snapshot === undefined) {
    await client.query('DELETE FROM alumno_excel_snapshot WHERE id_alumno = $1', [studentId]);
    return;
  }
  await client.query(
    `INSERT INTO alumno_excel_snapshot (id_alumno, raw_payload, fecha_importacion)
     VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
     ON CONFLICT (id_alumno) DO UPDATE
     SET raw_payload = EXCLUDED.raw_payload, fecha_importacion = EXCLUDED.fecha_importacion`,
    [studentId, JSON.stringify(snapshot)]
  );
};

const rollbackStudentImport = async (client, importId, { userId, userEmail, reason, ip, insertarAudit }) => {
  const preview = await previewStudentImportRollback(client, importId, { lock: true });
  if (!preview.found) return { found: false };
  if (!preview.can_revert) return { conflict: true, preview };

  const rowsById = new Map(preview.rows.map((row) => [Number(row.change_id), row]));
  let reverted = 0;
  let omitted = 0;
  for (const change of preview._context.changes) {
    const rowPlan = rowsById.get(Number(change.id));
    if (rowPlan?.status === 'OMITIDO') {
      omitted += 1;
      await client.query(
        `INSERT INTO importacion_estudiante_reversiones
         (importacion_id, cambio_id, id_alumno, resultado, detalle, revertido_por)
         VALUES ($1, $2, $3, 'OMITIDO', $4, $5)`,
        [importId, change.id, change.id_alumno, rowPlan.reasons[0], userId]
      );
      continue;
    }
    const studentId = Number(change.id_alumno);
    const before = getRollbackData(change, 'anterior');
    const after = getRollbackData(change, 'posterior');
    if (change.accion === 'CREADO') {
      await restoreEnrollment(client, studentId, null, userId, importId);
      await client.query(
        `UPDATE alumno SET activo = false, erp_vinculado_en = NULL,
            fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id_alumno = $1`,
        [studentId]
      );
    } else {
      await restoreStudent(client, studentId, before.student);
      await restoreEnrollment(client, studentId, before.enrollment, userId, importId);
    }
    await restoreIdentifiers(client, before.identifiers || [], after.identifiers || []);
    if (change.accion !== 'RETIRADO_POR_NOMINA') {
      await restoreExcelSnapshot(client, studentId, before.excel_snapshot);
    }
    reverted += 1;
    await client.query(
      `INSERT INTO importacion_estudiante_reversiones
       (importacion_id, cambio_id, id_alumno, resultado, detalle, revertido_por)
       VALUES ($1, $2, $3, 'REVERTIDO', $4, $5)`,
      [importId, change.id, studentId, `Compensación de ${change.accion.toLowerCase()}`, userId]
    );
  }
  const summary = { revertidos: reverted, omitidos: omitted };
  await client.query(
    `UPDATE importaciones_estudiantes
     SET estado = 'REVERTIDA', revertida_en = CURRENT_TIMESTAMP, revertida_por = $1,
         motivo_reversion = $2, resumen_reversion = $3::jsonb
     WHERE id = $4`,
    [userId, reason, JSON.stringify(summary), importId]
  );
  await insertarAudit(client, {
    usuario_id: userId,
    usuario_correo: userEmail,
    accion: 'REVERTIR_IMPORTACION_ALUMNOS',
    entidad: 'importacion_estudiantes',
    entidad_id: Number(importId),
    detalle: { ...summary, motivo_omitido: true },
    ip
  });
  return { found: true, summary };
};

module.exports = {
  STUDENT_FIELDS,
  previewStudentImportRollback,
  rollbackStudentImport
};
