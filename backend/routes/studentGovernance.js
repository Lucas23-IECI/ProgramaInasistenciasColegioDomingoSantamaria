const express = require('express');
const { validateStudentRut } = require('../utils/students');
const { protectStudentRecord } = require('../utils/studentPrivacy');
const {
  buildStudentWorkbook,
  fetchStudentExportDataset
} = require('../services/studentExportService');

const parsePositiveId = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getStudentMergePreview = async (queryable, primaryId, duplicateId) => {
  const students = await queryable.query(
    `SELECT a.id_alumno, a.rut, a.dv, a.documento_erp, a.uuid_erp,
            CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS nombre,
            a.activo, a.origen_alta, a.erp_vinculado_en, a.fusionado_en_id,
            c.nombre_curso AS curso
     FROM alumno a
     LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
     LEFT JOIN curso c ON c.id_curso = m.id_curso
     WHERE a.id_alumno = ANY($1::int[])
     ORDER BY array_position($1::int[], a.id_alumno)`,
    [[primaryId, duplicateId]]
  );
  const byId = new Map(students.rows.map((student) => [Number(student.id_alumno), student]));
  const primary = byId.get(primaryId);
  const duplicate = byId.get(duplicateId);
  if (!primary || !duplicate) return { found: false };

  // Estas consultas se ejecutan de forma secuencial porque este método también
  // opera dentro de una transacción con un único cliente de PostgreSQL.
  const attendance = await queryable.query(
      `SELECT id_alumno, count(*)::int AS total
       FROM attendance_registrations
       WHERE id_alumno = ANY($1::int[])
       GROUP BY id_alumno`,
      [[primaryId, duplicateId]]
    );
  const attendanceConflicts = await queryable.query(
      `SELECT count(*)::int AS total
       FROM attendance_registrations d
       JOIN attendance_registrations p
         ON p.id_alumno = $1
        AND d.id_alumno = $2
        AND p.fecha = d.fecha
        AND (
          (p.control_puntualidad_id IS NOT NULL AND p.control_puntualidad_id = d.control_puntualidad_id)
          OR p.tipo_registro = d.tipo_registro
        )`,
      [primaryId, duplicateId]
    );
  const enrollments = await queryable.query(
      `SELECT id_alumno, count(*)::int AS total,
              count(*) FILTER (WHERE vigente_hasta IS NULL)::int AS vigentes
       FROM matricula
       WHERE id_alumno = ANY($1::int[])
       GROUP BY id_alumno`,
      [[primaryId, duplicateId]]
    );
  const guardians = await queryable.query(
      `SELECT id_alumno, count(*)::int AS total
       FROM personas_autorizadas_retiro
       WHERE id_alumno = ANY($1::int[])
       GROUP BY id_alumno`,
      [[primaryId, duplicateId]]
    );
  const withdrawals = await queryable.query(
      `SELECT id_alumno, count(*)::int AS total
       FROM retiros_alumno
       WHERE id_alumno = ANY($1::int[])
       GROUP BY id_alumno`,
      [[primaryId, duplicateId]]
    );
  const activeWithdrawalConflicts = await queryable.query(
      `SELECT count(*)::int AS total
       FROM retiros_alumno
       WHERE id_alumno = ANY($1::int[])
         AND estado IN ('SOLICITADO', 'AUTORIZADO')`,
      [[primaryId, duplicateId]]
    );
  const snapshots = await queryable.query(
      `SELECT id_alumno, raw_payload
       FROM alumno_excel_snapshot
       WHERE id_alumno = ANY($1::int[])`,
      [[primaryId, duplicateId]]
    );

  const countFor = (result, id, field = 'total') => (
    Number(result.rows.find((row) => Number(row.id_alumno) === id)?.[field] || 0)
  );
  const blockers = [];
  if (primary.fusionado_en_id || duplicate.fusionado_en_id) {
    blockers.push('Una de las fichas ya fue fusionada anteriormente.');
  }
  if (Number(attendanceConflicts.rows[0]?.total || 0) > 0) {
    blockers.push('Existen ingresos de puntualidad incompatibles en la misma fecha o bloque.');
  }
  if (Number(activeWithdrawalConflicts.rows[0]?.total || 0) > 1) {
    blockers.push('Ambas fichas tienen retiros activos que deben resolverse antes de unirlas.');
  }
  if (primary.uuid_erp && duplicate.uuid_erp && primary.uuid_erp !== duplicate.uuid_erp) {
    blockers.push('Las fichas poseen identificadores ERP diferentes.');
  }

  return {
    found: true,
    primary: protectStudentRecord(primary),
    duplicate: protectStudentRecord(duplicate),
    counts: {
      primary: {
        attendance: countFor(attendance, primaryId),
        enrollments: countFor(enrollments, primaryId),
        guardians: countFor(guardians, primaryId),
        withdrawals: countFor(withdrawals, primaryId)
      },
      duplicate: {
        attendance: countFor(attendance, duplicateId),
        enrollments: countFor(enrollments, duplicateId),
        guardians: countFor(guardians, duplicateId),
        withdrawals: countFor(withdrawals, duplicateId)
      }
    },
    snapshot_students: snapshots.rows.map((row) => row.id_alumno),
    blockers,
    can_merge: blockers.length === 0
  };
};

const createStudentGovernanceRouter = ({
  pool,
  verifyToken,
  verifyPermission,
  verifyAnyPermission,
  insertarAudit,
  getClientIp
}) => {
  const router = express.Router();
  router.use(verifyToken);

  router.get('/export', async (req, res, next) => {
    const scope = String(req.query.scope || 'operational').toLowerCase();
    if (!['operational', 'administrative', 'quality'].includes(scope)) {
      return res.status(400).json({ message: 'El tipo de exportación no es válido.' });
    }
    return verifyPermission('students.export')(req, res, next);
  }, async (req, res) => {
    const scope = String(req.query.scope || 'operational').toLowerCase();
    const action = {
      operational: 'EXPORTAR_PADRON_OPERATIVO',
      administrative: 'EXPORTAR_PADRON_ADMINISTRATIVO',
      quality: 'EXPORTAR_CALIDAD_PADRON'
    }[scope];
    try {
      const students = await fetchStudentExportDataset(pool);
      const buffer = await buildStudentWorkbook({ scope, students });
      const date = new Date().toISOString().slice(0, 10);
      const suffix = {
        operational: 'operativo',
        administrative: 'administrativo',
        quality: 'calidad'
      }[scope];

      await insertarAudit(pool, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: action,
        entidad: 'padron_estudiantil',
        entidad_id: null,
        detalle: {
          alcance: scope,
          formato: 'xlsx',
          estudiantes: students.length,
          contiene_identificadores_completos: scope !== 'quality'
        },
        ip: getClientIp(req)
      });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="padron-${suffix}-${date}.xlsx"`);
      res.setHeader('Cache-Control', 'no-store, private');
      res.send(buffer);
    } catch (error) {
      console.error('[padron:export]', error.message);
      res.status(500).json({ message: 'No fue posible generar la exportación del padrón.' });
    }
  });

  router.get('/imports', verifyAnyPermission(['students.view', 'students.manage', 'students.import']), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT i.*, u.nombre AS importado_por_nombre
         FROM importaciones_estudiantes i
         LEFT JOIN usuarios u ON u.id = i.importado_por
         ORDER BY i.importado_en DESC
         LIMIT 100`
      );
      res.json({ imports: result.rows });
    } catch (error) {
      console.error('[padron:imports]', error.message);
      res.status(500).json({ message: 'No fue posible consultar el historial de importaciones.' });
    }
  });

  router.get('/imports/:id', verifyAnyPermission(['students.view', 'students.manage', 'students.import']), async (req, res) => {
    const id = parsePositiveId(req.params.id);
    if (!id) return res.status(400).json({ message: 'La importación seleccionada no es válida. Vuelve al historial y ábrela nuevamente.' });
    try {
      const [record, changes] = await Promise.all([
        pool.query(
          `SELECT i.*, u.nombre AS importado_por_nombre, u.correo AS importado_por_correo
           FROM importaciones_estudiantes i
           LEFT JOIN usuarios u ON u.id = i.importado_por
           WHERE i.id = $1`,
          [id]
        ),
        pool.query(
          `SELECT c.*, CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS estudiante
           FROM importacion_estudiante_cambios c
           LEFT JOIN alumno a ON a.id_alumno = c.id_alumno
           WHERE c.importacion_id = $1
           ORDER BY c.numero_fila NULLS LAST, c.id`,
          [id]
        )
      ]);
      if (!record.rowCount) return res.status(404).json({ message: 'Importación no encontrada.' });
      res.json({ import: record.rows[0], changes: changes.rows });
    } catch (error) {
      console.error('[padron:import-detail]', error.message);
      res.status(500).json({ message: 'No fue posible consultar el detalle de la importación.' });
    }
  });

  router.get('/manual-pending', verifyAnyPermission(['students.view', 'students.manage', 'students.import']), async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT a.id_alumno, a.rut, a.dv, a.documento_erp, a.uuid_erp,
                CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS nombre,
                a.motivo_alta_manual, a.detalle_alta_manual,
                a.creado_manualmente_en,
                GREATEST(0, CURRENT_DATE - a.creado_manualmente_en::date)::int AS dias_pendiente,
                c.nombre_curso AS curso,
                u.nombre AS creado_por_nombre
         FROM alumno a
         LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
         LEFT JOIN curso c ON c.id_curso = m.id_curso
         LEFT JOIN usuarios u ON u.id = a.creado_manualmente_por
         WHERE a.origen_alta = 'MANUAL'
           AND a.erp_vinculado_en IS NULL
           AND a.fusionado_en_id IS NULL
         ORDER BY a.creado_manualmente_en ASC, a.id_alumno`
      );
      res.json({
        students: result.rows.map((student) => protectStudentRecord(student)),
        total: result.rowCount
      });
    } catch (error) {
      console.error('[padron:manual-pending]', error.message);
      res.status(500).json({ message: 'No fue posible consultar las altas manuales pendientes.' });
    }
  });

  router.get('/quality', verifyAnyPermission(['students.view', 'students.manage', 'students.import']), async (req, res) => {
    try {
      const [students, duplicateEnrollments, conflicts, reappeared, pendingValidation] = await Promise.all([
        pool.query(
          `SELECT a.id_alumno, a.rut, a.dv, a.documento_erp, a.uuid_erp, a.telefono,
                  a.origen_alta, a.erp_vinculado_en,
                  CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS nombre,
                  c.nombre_curso AS curso,
                  pa.id AS apoderado_id
           FROM alumno a
           LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
           LEFT JOIN curso c ON c.id_curso = m.id_curso
           LEFT JOIN LATERAL (
             SELECT id FROM personas_autorizadas_retiro
             WHERE id_alumno = a.id_alumno AND activo = true LIMIT 1
           ) pa ON true
           WHERE a.activo = true AND a.rol = 'Estudiante' AND a.fusionado_en_id IS NULL`
        ),
        pool.query(
          `SELECT a.id_alumno,
                  CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS nombre,
                  c.nombre_curso AS curso,
                  count(*)::int AS total
           FROM matricula m
           JOIN alumno a ON a.id_alumno = m.id_alumno
           LEFT JOIN matricula_actual ma ON ma.id_alumno = a.id_alumno
           LEFT JOIN curso c ON c.id_curso = ma.id_curso
           WHERE m.vigente_hasta IS NULL
             AND a.activo = true
             AND a.rol = 'Estudiante'
             AND a.fusionado_en_id IS NULL
           GROUP BY a.id_alumno, a.nombres, a.paterno, a.materno, c.nombre_curso
           HAVING count(*) > 1
           ORDER BY count(*) DESC, nombre`
        ),
        pool.query(
          `SELECT c.id_alumno,
                  CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS nombre,
                  course.nombre_curso AS curso,
                  COALESCE(c.mensaje, 'Conflicto detectado durante una importación ERP') AS detalle,
                  c.creado_en
           FROM importacion_estudiante_cambios c
           LEFT JOIN alumno a ON a.id_alumno = c.id_alumno
           LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
           LEFT JOIN curso course ON course.id_curso = m.id_curso
           WHERE c.accion = 'CONFLICTO'
             AND c.creado_en >= CURRENT_TIMESTAMP - INTERVAL '90 days'
           UNION ALL
           SELECT NULL::int AS id_alumno,
                  'Fila rechazada en importación ERP' AS nombre,
                  NULL::varchar AS curso,
                  COALESCE(e.detalle->>'message', e.detalle->>'mensaje', 'Requiere revisar la importación de origen') AS detalle,
                  e.ocurrido_en AS creado_en
           FROM eventos_operacionales e
           WHERE e.tipo = 'IMPORTACION_RECHAZADA'
             AND e.ocurrido_en >= CURRENT_TIMESTAMP - INTERVAL '90 days'
           ORDER BY creado_en DESC`
        ),
        pool.query(
          `SELECT DISTINCT ON (c.id_alumno)
                  c.id_alumno,
                  CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS nombre,
                  course.nombre_curso AS curso,
                  c.creado_en
           FROM importacion_estudiante_cambios c
           JOIN alumno a ON a.id_alumno = c.id_alumno
           LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
           LEFT JOIN curso course ON course.id_curso = m.id_curso
           WHERE c.accion = 'REACTIVADO_DESDE_ERP'
             AND COALESCE(c.anterior->>'activo', 'true') = 'false'
             AND COALESCE(c.posterior->>'activo', 'false') = 'true'
           ORDER BY c.id_alumno, c.creado_en DESC`
        ),
        pool.query(
          `SELECT DISTINCT ON (a.id_alumno)
                  a.id_alumno,
                  CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS nombre,
                  course.nombre_curso AS curso,
                  CONCAT(
                    CASE WHEN ai.resultado_validacion IS NULL
                      THEN 'Sin evidencia de validación versionada'
                      ELSE CONCAT('Validación ', LOWER(ai.resultado_validacion))
                    END,
                    ' · ', ai.tipo,
                    CASE WHEN ai.pais_emisor IS NULL THEN ' · país pendiente' ELSE '' END
                  ) AS detalle
           FROM alumno_identificador ai
           JOIN alumno a ON a.id_alumno = ai.id_alumno
           LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
           LEFT JOIN curso course ON course.id_curso = m.id_curso
           WHERE a.activo = true
             AND a.rol = 'Estudiante'
             AND a.fusionado_en_id IS NULL
             AND ai.estado <> 'REVOCADO'
             AND ai.tipo IN ('RUN_CHILE', 'IPE_MINEDUC', 'PASAPORTE', 'DNI', 'CEDULA', 'DOCUMENTO_EXTRANJERO')
             AND (
               ai.validador_id IS NULL
               OR ai.validador_version IS NULL
               OR ai.resultado_validacion IS NULL
               OR ai.resultado_validacion IN ('PENDIENTE', 'RECHAZADO')
             )
           ORDER BY a.id_alumno, ai.es_principal DESC, ai.actualizado_en DESC`
        )
      ]);
      const manualPending = students.rows.filter(
        (student) => student.origen_alta === 'MANUAL' && !student.erp_vinculado_en
      );
      const withoutCourse = students.rows.filter((student) => !student.curso);
      const withoutGuardian = students.rows.filter((student) => !student.apoderado_id);
      const incompletePhone = students.rows.filter(
        (student) => !student.telefono || String(student.telefono).replace(/\D/g, '').length < 9
      );
      const invalidRut = students.rows.filter(
        (student) => student.rut && !validateStudentRut(student.rut, student.dv)
      );
      const toCase = (student, detail) => ({
        id_alumno: student.id_alumno || null,
        nombre: student.nombre || 'Registro sin estudiante vinculado',
        curso: student.curso || null,
        detalle: detail
      });
      res.json({
        generated_at: new Date().toISOString(),
        indicators: {
          manuales_pendientes: manualPending.length,
          rut_invalidos: invalidRut.length,
          sin_curso: withoutCourse.length,
          sin_apoderado: withoutGuardian.length,
          telefono_incompleto: incompletePhone.length,
          matriculas_duplicadas: duplicateEnrollments.rowCount,
          conflictos_erp: conflicts.rowCount,
          inactivos_reaparecidos: reappeared.rowCount,
          validacion_documental_pendiente: pendingValidation.rowCount
        },
        cases: {
          manuales_pendientes: manualPending.slice(0, 100).map(
            (student) => toCase(student, 'Ficha manual pendiente de vinculación con el ERP')
          ),
          rut_invalidos: invalidRut.slice(0, 100).map(
            (student) => toCase(student, 'RUN almacenado con dígito verificador inválido')
          ),
          sin_curso: withoutCourse.slice(0, 100).map(
            (student) => toCase(student, 'No posee una matrícula vigente asociada')
          ),
          sin_apoderado: withoutGuardian.slice(0, 100).map(
            (student) => toCase(student, 'No posee una persona autorizada o apoderado vigente')
          ),
          telefono_incompleto: incompletePhone.slice(0, 100).map(
            (student) => toCase(student, 'El teléfono está vacío o no contiene al menos nueve dígitos')
          ),
          matriculas_duplicadas: duplicateEnrollments.rows.slice(0, 100).map(
            (student) => toCase(student, `${student.total} matrículas aparecen vigentes simultáneamente`)
          ),
          conflictos_erp: conflicts.rows.slice(0, 100).map(
            (student) => toCase(student, student.detalle)
          ),
          inactivos_reaparecidos: reappeared.rows.slice(0, 100).map(
            (student) => toCase(student, 'La ficha inactiva reapareció en una nómina oficial')
          ),
          validacion_documental_pendiente: pendingValidation.rows.slice(0, 100).map(
            (student) => toCase(student, student.detalle)
          )
        }
      });
    } catch (error) {
      console.error('[padron:quality]', error.message);
      res.status(500).json({ message: 'No fue posible calcular la calidad del padrón.' });
    }
  });

  router.post('/merge-preview', verifyPermission('students.manage'), async (req, res) => {
    const primaryId = parsePositiveId(req.body?.primary_id);
    const duplicateId = parsePositiveId(req.body?.duplicate_id);
    if (!primaryId || !duplicateId || primaryId === duplicateId) {
      return res.status(400).json({ message: 'Seleccione dos fichas distintas.' });
    }
    try {
      const preview = await getStudentMergePreview(pool, primaryId, duplicateId);
      if (!preview.found) return res.status(404).json({ message: 'Una de las fichas no existe.' });
      res.json(preview);
    } catch (error) {
      console.error('[padron:merge-preview]', error.message);
      res.status(500).json({ message: 'No fue posible evaluar la fusión.' });
    }
  });

  router.post('/merge', verifyPermission('students.manage'), async (req, res) => {
    const primaryId = parsePositiveId(req.body?.primary_id);
    const duplicateId = parsePositiveId(req.body?.duplicate_id);
    const reason = String(req.body?.motivo || '').trim().slice(0, 500);
    if (!primaryId || !duplicateId || primaryId === duplicateId || reason.length < 10) {
      return res.status(400).json({ message: 'Seleccione fichas distintas e indique un motivo de al menos 10 caracteres.' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT id_alumno FROM alumno WHERE id_alumno = ANY($1::int[]) FOR UPDATE',
        [[primaryId, duplicateId]]
      );
      const preview = await getStudentMergePreview(client, primaryId, duplicateId);
      if (!preview.found) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Una de las fichas no existe.' });
      }
      if (!preview.can_merge) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          code: 'STUDENT_MERGE_BLOCKED',
          message: 'La fusión no es segura mientras existan incompatibilidades.',
          blockers: preview.blockers,
          preview
        });
      }

      await client.query(
        `UPDATE attendance_registrations SET id_alumno = $1 WHERE id_alumno = $2`,
        [primaryId, duplicateId]
      );
      await client.query(
        `UPDATE matricula
         SET vigente_hasta = COALESCE(vigente_hasta, CURRENT_DATE),
             motivo_cambio = CONCAT_WS(' · ', motivo_cambio, $1::text),
             actualizado_por = $2,
             actualizado_en = CURRENT_TIMESTAMP
         WHERE id_alumno = $3 AND vigente_hasta IS NULL`,
        [`Ficha fusionada con estudiante #${primaryId}`, req.user.id, duplicateId]
      );
      await client.query(
        `UPDATE matricula SET id_alumno = $1 WHERE id_alumno = $2`,
        [primaryId, duplicateId]
      );
      await client.query(
        `UPDATE retiros_alumno SET id_alumno = $1 WHERE id_alumno = $2`,
        [primaryId, duplicateId]
      );
      await client.query(
        `UPDATE personas_autorizadas_retiro d
         SET activo = false, actualizado_en = CURRENT_TIMESTAMP
         WHERE d.id_alumno = $2
           AND EXISTS (
             SELECT 1 FROM personas_autorizadas_retiro p
             WHERE p.id_alumno = $1
               AND p.visitante_id = d.visitante_id
               AND p.activo = true
           )`,
        [primaryId, duplicateId]
      );
      await client.query(
        `UPDATE personas_autorizadas_retiro
         SET id_alumno = $1, actualizado_en = CURRENT_TIMESTAMP
         WHERE id_alumno = $2`,
        [primaryId, duplicateId]
      );
      await client.query(
        `DELETE FROM alumno_excel_snapshot
         WHERE id_alumno = $2
           AND EXISTS (SELECT 1 FROM alumno_excel_snapshot WHERE id_alumno = $1)`,
        [primaryId, duplicateId]
      );
      await client.query(
        `UPDATE alumno_excel_snapshot SET id_alumno = $1 WHERE id_alumno = $2`,
        [primaryId, duplicateId]
      );
      const mergeRecord = await client.query(
        `INSERT INTO fusiones_alumnos (
           alumno_principal_id, alumno_duplicado_id, motivo, resumen, fusionado_por
         ) VALUES ($1, $2, $3, $4::jsonb, $5)
         RETURNING id, fusionado_en`,
        [primaryId, duplicateId, reason, JSON.stringify(preview.counts), req.user.id]
      );
      await client.query(
        `UPDATE alumno
         SET activo = false,
             fusionado_en_id = $1,
             fusionado_en = CURRENT_TIMESTAMP,
             fusionado_por = $2,
             motivo_fusion = $3,
             fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id_alumno = $4`,
        [primaryId, req.user.id, reason, duplicateId]
      );
      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'FUSIONAR_ALUMNOS',
        entidad: 'alumno',
        entidad_id: primaryId,
        detalle: {
          alumno_principal_id: primaryId,
          alumno_duplicado_id: duplicateId,
          motivo: reason,
          dependencias: preview.counts
        },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');
      res.json({
        message: 'Las fichas fueron unidas y la ficha duplicada quedó desactivada con trazabilidad.',
        merge: mergeRecord.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[padron:merge]', error.message);
      res.status(500).json({ message: 'No fue posible fusionar las fichas sin riesgo.' });
    } finally {
      client.release();
    }
  });

  return router;
};

module.exports = { createStudentGovernanceRouter, getStudentMergePreview };
