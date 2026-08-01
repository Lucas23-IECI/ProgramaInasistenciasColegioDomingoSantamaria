const {
  shouldPreserveRegularizedRun,
  syncStudentIdentifiers
} = require('../../services/studentIdentifierService');

const registerStudentImportRoutes = (context) => {
  const {
    app,
    pool,
    bcrypt,
    jwt,
    fs,
    path,
    createHash,
    loginLimiter,
    verifyToken,
    verifyPermission,
    verifyAnyPermission,
    JWT_SECRET,
    normalizeEmail,
    sanitizeSnapshotRow,
    validateEmail,
    validatePassword,
    calculateDelayMinutes,
    calculateStatusAndSeverity,
    isIsoDate,
    validateDateRange,
    normalizeStudentPayload,
    sanitizeStudentText,
    validateStudentPayload,
    validateStudentRut,
    normalizeErpStudentIdentity,
    findCourseMatch,
    normalizeCourseKey,
    evaluateStudentReconciliation,
    compareStudentFields,
    detectIdentifierCollision,
    validateImportMode,
    assignEnrollment,
    closeEnrollment,
    recordOperationalEvent,
    attachPermissionProfile,
    countActivePermissionHolders,
    getAccessProfile,
    getAccessProfiles,
    getPermissionCatalog,
    getRecommendedPermissions,
    normalizeProfileCode,
    replaceProfilePermissions,
    replaceUserPermissionOverrides,
    validatePermissionSelection,
    cookieOptions,
    toPublicUser,
    setSessionCookie,
    sanitizeText,
    normalizeHeaderKey,
    pickRowValue,
    normalizeRutAndDv,
    normalizeDateInput,
    getImportedStudentFields,
    summarizeStudentImportRows,
    buildStudentImportPreview,
    enrichStudentImportPreview,
    STUDENT_PUBLIC_FIELDS,
    getInstitutionalClock,
    insertarAudit,
    registrarAudit,
    getClientIp
  } = context;

// BULK SYNC EXCEL IMPORT
app.post('/api/students/import-preview', verifyToken, verifyPermission('students.import'), async (req, res) => {
  const rows = Array.isArray(req.body?.students) ? req.body.students : [];
  const importMode = validateImportMode(req.body?.import_mode);
  if (!rows.length || rows.length > 5000) {
    return res.status(400).json({ message: 'La previsualización requiere entre 1 y 5.000 filas.' });
  }

  try {
    const courses = await pool.query(
      'SELECT id_curso, nombre_curso FROM curso ORDER BY nombre_curso'
    );
    const preview = await enrichStudentImportPreview(
      buildStudentImportPreview(rows, courses.rows)
    );
    const importedRuts = preview.rows.map((row) => row.rut_normalizado).filter(Boolean);
    const importedErpIds = preview.rows.map((row) => row.uuid_erp).filter(Boolean);
    const missingStudents = importMode === 'COMPLETA'
      ? (await pool.query(
        `SELECT a.id_alumno, a.rut, a.dv,
                CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS nombre,
                c.nombre_curso AS curso, a.origen_alta
         FROM alumno a
         JOIN matricula_actual m ON m.id_alumno = a.id_alumno
         JOIN curso c ON c.id_curso = m.id_curso
         WHERE a.activo = true
           AND a.rol = 'Estudiante'
           AND a.fusionado_en_id IS NULL
           AND a.erp_vinculado_en IS NOT NULL
           AND NOT (
             COALESCE(a.uuid_erp = ANY($1::text[]), false)
             OR COALESCE(a.rut = ANY($2::text[]), false)
           )
         ORDER BY c.nombre_curso, a.paterno, a.materno, a.nombres`,
        [importedErpIds, importedRuts]
      )).rows
      : [];
    res.json({
      ...preview,
      import_mode: importMode,
      missing_students: missingStudents,
      manual_students_preserved: importMode === 'COMPLETA',
      courses: courses.rows,
      requires_resolution: preview.summary.suggested
        + preview.summary.unknown
        + preview.summary.conflicts > 0,
      can_sync: preview.summary.rejected === 0
        && preview.summary.suggested === 0
        && preview.summary.unknown === 0
        && preview.summary.conflicts === 0
    });
  } catch (error) {
    console.error('[students:import-preview]', error.message);
    res.status(500).json({ message: 'No fue posible previsualizar la importación.' });
  }
});

app.post('/api/students/bulk-sync', verifyToken, verifyPermission('students.import'), async (req, res) => {
  const rows = Array.isArray(req.body?.students) ? req.body.students : [];
  if (!rows.length) {
    return res.status(400).json({ message: 'No se recibieron filas para procesar.' });
  }

  const resolutions = req.body?.course_resolutions && typeof req.body.course_resolutions === 'object'
    ? req.body.course_resolutions
    : {};
  const identityResolutions = req.body?.identity_resolutions && typeof req.body.identity_resolutions === 'object'
    ? req.body.identity_resolutions
    : {};
  const confirmNewCourses = req.body?.confirm_new_courses === true;
  const importMode = validateImportMode(req.body?.import_mode);
  const confirmMissingDeactivation = req.body?.confirm_missing_deactivation === true;
  const fileName = sanitizeStudentText(req.body?.file_name || 'Planilla ERP sin nombre', 255);
  const fileHash = sanitizeStudentText(
    req.body?.file_hash
      || createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    128
  );

  const coursesResult = await pool.query(
    'SELECT id_curso, nombre_curso FROM curso ORDER BY nombre_curso'
  );
  const courseById = new Map(coursesResult.rows.map((course) => [Number(course.id_curso), course]));
  const preview = await enrichStudentImportPreview(
    buildStudentImportPreview(rows, coursesResult.rows)
  );
  const unresolved = preview.rows.filter((row) => {
    if ([
      'RECHAZADA',
      'DUPLICADA_ARCHIVO',
      'COLISION_UUID_RUT',
      'COLISION_IDENTIFICADORES'
    ].includes(row.status)) return true;
    if (row.status === 'CONFLICTO_IDENTIDAD') {
      const requiredAction = row.inactive_reappearance
        ? 'CONFIRMAR_Y_REACTIVAR'
        : 'CONFIRMAR_MISMA_PERSONA';
      return identityResolutions[String(row.row)] !== requiredAction;
    }
    if (row.inactive_reappearance
      && !['REACTIVAR_FICHA', 'CONFIRMAR_Y_REACTIVAR'].includes(identityResolutions[String(row.row)])) {
      return true;
    }
    if (row.status === 'FICHA_INACTIVA_REAPARECE') {
      return false;
    }
    if (row.status === 'VALIDA') return false;
    const resolution = resolutions[row.curso_key];
    if (!resolution) return true;
    if (resolution.action === 'map') return !courseById.has(Number(resolution.course_id));
    if (resolution.action === 'create') return !confirmNewCourses || !sanitizeStudentText(resolution.name || row.curso_origen, 100);
    return true;
  });
  if (unresolved.length) {
    await recordOperationalEvent(pool, {
      type: 'IMPORTACION_RECHAZADA',
      entity: 'importacion_alumnos',
      detail: {
        total_filas: rows.length,
        filas_pendientes: unresolved.length,
        tipos: [...new Set(unresolved.map((row) => row.status))]
      },
      userId: req.user.id
    });
    return res.status(409).json({
      code: 'IMPORT_PREVIEW_REQUIRED',
      message: 'La planilla contiene filas o cursos que deben resolverse antes de sincronizar.',
      preview: { ...preview, courses: coursesResult.rows },
      unresolved_rows: unresolved.map((row) => row.row)
    });
  }

  const importedRuts = preview.rows.map((row) => row.rut_normalizado).filter(Boolean);
  const importedErpIds = preview.rows.map((row) => row.uuid_erp).filter(Boolean);
  const missingStudents = importMode === 'COMPLETA'
    ? (await pool.query(
      `SELECT a.id_alumno, a.rut, a.dv,
              CONCAT_WS(' ', a.nombres, a.paterno, a.materno) AS nombre,
              c.nombre_curso AS curso
       FROM alumno a
       JOIN matricula_actual m ON m.id_alumno = a.id_alumno
       JOIN curso c ON c.id_curso = m.id_curso
       WHERE a.activo = true
         AND a.rol = 'Estudiante'
         AND a.fusionado_en_id IS NULL
         AND a.erp_vinculado_en IS NOT NULL
         AND NOT (
           COALESCE(a.uuid_erp = ANY($1::text[]), false)
           OR COALESCE(a.rut = ANY($2::text[]), false)
         )
       ORDER BY c.nombre_curso, a.paterno, a.materno, a.nombres`,
      [importedErpIds, importedRuts]
    )).rows
    : [];

  if (importMode === 'COMPLETA' && missingStudents.length && !confirmMissingDeactivation) {
    return res.status(409).json({
      code: 'CONFIRM_COMPLETE_ROSTER',
      message: 'La nómina completa omite estudiantes vigentes. Revise y confirme los retiros propuestos.',
      missing_students: missingStudents
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const summary = {
      total: rows.length,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      linked_manual: 0,
      reactivated: 0,
      warnings: [],
      retired: 0,
      errors: []
    };
    const importRecord = await client.query(
      `INSERT INTO importaciones_estudiantes (
         nombre_archivo, hash_archivo, modo, estado, total_filas, importado_por
       ) VALUES ($1, $2, $3, 'COMPLETADA', $4, $5)
       RETURNING id`,
      [fileName, fileHash, importMode, rows.length, req.user.id]
    );
    const importId = importRecord.rows[0].id;
    const previewByRow = new Map(preview.rows.map((row) => [Number(row.row), row]));

    for (let index = 0; index < rows.length; index++) {
      const excelRowNumber = index + 2;
      const rowSavepoint = `students_sync_row_${index}`;
      await client.query(`SAVEPOINT ${rowSavepoint}`);

      try {
        const rawRow = rows[index];
        const previewRow = previewByRow.get(excelRowNumber);
        let rowAction = 'SIN_CAMBIOS';
        let beforeSnapshot = null;

        // 1. PICK VALUES FROM EXCEL COLUMNS
        const uuidErp = pickRowValue(rawRow, ['ID de Usuario (no modificar)', 'id usuario', 'id_usuario', 'uuid_erp']);
        const rutInput = pickRowValue(rawRow, ['RUT', 'run', 'id']);
        const dvInput = pickRowValue(rawRow, ['DV', 'dígito verificador', 'digito verificador']);
        const documentTypeInput = pickRowValue(rawRow, [
          'Tipo de documento',
          'tipo documento',
          'tipo_documento',
          'document type'
        ]);
        const countryCodeInput = pickRowValue(rawRow, [
          'País emisor',
          'Pais emisor',
          'país documento',
          'pais_documento',
          'country'
        ]);
        const nombresInput = pickRowValue(rawRow, ['Nombres', 'nombre', 'name']);
        const apellidosInput = pickRowValue(rawRow, ['Apellidos', 'apellido', 'lastname']);
        const emailInput = pickRowValue(rawRow, ['Email', 'correo', 'mail']);
        const telefonoInput = pickRowValue(rawRow, ['Teléfono', 'telefono', 'phone']);
        const rolInput = pickRowValue(rawRow, ['Rol', 'rol', 'role']);
        const cursoInput = pickRowValue(rawRow, ['Curso', 'grade']);
        const seccionInput = pickRowValue(rawRow, ['Sección', 'seccion']);
        const generoInput = pickRowValue(rawRow, ['Género', 'genero', 'gender']);
        const nacimientoInput = pickRowValue(rawRow, ['Fecha Nacimiento', 'fecha_nacimiento', 'nacimiento']);
        const userUsername = pickRowValue(rawRow, ['Nombre Usuario', 'nombre_usuario', 'username']);
        const rutApoderado = pickRowValue(rawRow, ['RUT Apoderados', 'apoderado_rut', 'rut_apoderado']);
        const snapshotRow = sanitizeSnapshotRow(rawRow);

        // 2. NORMALIZATIONS
        const identity = normalizeErpStudentIdentity({
          uuidErp,
          rutInput,
          dvInput,
          documentTypeInput,
          countryCodeInput,
          normalizeRutAndDv
        });
        const {
          rut,
          dv,
          documentoErp,
          barcode: codigoBarra
        } = identity;
        if (!identity.canIdentify) {
          summary.errors.push({
            row: excelRowNumber,
            message: 'Falta un RUT chileno válido o el identificador obligatorio del ERP.'
          });
          await client.query(`RELEASE SAVEPOINT ${rowSavepoint}`);
          continue;
        }

        if (!nombresInput) {
          summary.errors.push({ row: excelRowNumber, message: 'Falta nombre del usuario.' });
          await client.query(`RELEASE SAVEPOINT ${rowSavepoint}`);
          continue;
        }

        // Split apellidos into paterno / materno
        const surnameParts = (apellidosInput || '').split(/\s+/).filter(Boolean);
        const paterno = surnameParts.length > 0 ? surnameParts[0] : 'Sin Apellido';
        const materno = surnameParts.length > 1 ? surnameParts.slice(1).join(' ') : '';

        const rol = rolInput || 'Estudiante';
        const email = emailInput || null;
        const telefono = telefonoInput || null;
        const seccion = seccionInput || null;
        const genero = generoInput || null;
        const fechaNacimiento = normalizeDateInput(nacimientoInput);
        const username = userUsername || (nombresInput.charAt(0) + paterno).toLowerCase().replace(/\s+/g, '');
        // 3. RESOLVE COURSE
        let courseId = null;
        if (cursoInput) {
          const match = findCourseMatch(cursoInput, coursesResult.rows);
          if (match.kind === 'exact') {
            courseId = match.course.id_curso;
          } else {
            const resolution = resolutions[normalizeCourseKey(cursoInput)];
            if (resolution.action === 'map') {
              courseId = Number(resolution.course_id);
            } else {
              const requestedName = sanitizeStudentText(resolution.name || cursoInput, 100);
              const insertedCourse = await client.query(
                `INSERT INTO curso (nombre_curso)
                 SELECT $1
                 WHERE NOT EXISTS (
                   SELECT 1 FROM curso WHERE LOWER(nombre_curso) = LOWER($1)
                 )
                 RETURNING id_curso`,
                [requestedName]
              );
              if (insertedCourse.rows.length) {
                courseId = insertedCourse.rows[0].id_curso;
              } else {
                const existingCourse = await client.query(
                  'SELECT id_curso FROM curso WHERE LOWER(nombre_curso) = LOWER($1) LIMIT 1',
                  [requestedName]
                );
                courseId = existingCourse.rows[0].id_curso;
              }
            }
          }
        }

        // 4. La previsualización ya resolvió RUT y UUID. Se bloquea cualquier
        // divergencia en vez de escoger una ficha de forma ambigua.
        const matchedStudentId = previewRow?.existing_student?.id_alumno || null;
        const studentLookup = matchedStudentId
          ? await client.query(
            `SELECT a.*, c.nombre_curso AS grade,
                    primary_identifier.tipo AS primary_identifier_type,
                    COALESCE(s.raw_payload = $2::jsonb, false) AS sin_cambios
             FROM alumno a
             LEFT JOIN alumno_excel_snapshot s ON s.id_alumno = a.id_alumno
             LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
             LEFT JOIN curso c ON c.id_curso = m.id_curso
             LEFT JOIN LATERAL (
               SELECT ai.tipo
               FROM alumno_identificador ai
               WHERE ai.id_alumno = a.id_alumno
                 AND ai.es_principal = true
                 AND ai.estado <> 'REVOCADO'
               LIMIT 1
             ) primary_identifier ON true
             WHERE a.id_alumno = $1
             FOR UPDATE OF a`,
            [matchedStudentId, JSON.stringify(snapshotRow)]
          )
          : { rows: [] };
        const existing = studentLookup.rows[0] || null;
        const reactivatesInactive = previewRow?.inactive_reappearance === true
          && ['REACTIVAR_FICHA', 'CONFIRMAR_Y_REACTIVAR'].includes(
            identityResolutions[String(excelRowNumber)]
          );
        beforeSnapshot = existing ? {
          id_alumno: existing.id_alumno,
          uuid_erp: existing.uuid_erp,
          rut: existing.rut,
          dv: existing.dv,
          documento_erp: existing.documento_erp,
          tipo_identificador: existing.tipo_identificador,
          tipo_documento_extranjero: existing.tipo_documento_extranjero,
          pais_emisor_documento: existing.pais_emisor_documento,
          nombres: existing.nombres,
          paterno: existing.paterno,
          materno: existing.materno,
          email: existing.email,
          telefono: existing.telefono,
          grade: existing.grade,
          activo: existing.activo
        } : null;

        let idAlumno;
        if (!existing) {
          // INSERT
          const insRes = await client.query(
            `INSERT INTO alumno (
              uuid_erp, rut, dv, documento_erp, tipo_identificador,
              tipo_documento_extranjero, pais_emisor_documento,
              nombres, paterno, materno, email, telefono, rol,
              seccion, genero, fecha_nacimiento, nombre_usuario, rut_apoderado, codigo_barra,
              origen_alta, erp_vinculado_en
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7,
               $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
               'ERP', CURRENT_TIMESTAMP
             )
             RETURNING id_alumno`,
            [
              identity.uuidErp, rut, dv, documentoErp, identity.identityType,
              identity.foreignDocumentType, identity.countryCode,
              nombresInput, paterno, materno || null, email, telefono, rol, seccion, genero,
              fechaNacimiento, username, rutApoderado, codigoBarra
            ]
          );
          idAlumno = insRes.rows[0].id_alumno;
          summary.inserted++;
          rowAction = 'CREADO';
        } else if (!existing.sin_cambios || reactivatesInactive) {
          // UPDATE if different
          idAlumno = existing.id_alumno;
          const linksManualRecord = existing.origen_alta === 'MANUAL'
            && !existing.erp_vinculado_en;
          const preserveRegularizedRun = shouldPreserveRegularizedRun(
            existing.primary_identifier_type,
            identity.identityType
          );

          const updateQuery = `
            UPDATE alumno
            SET uuid_erp = COALESCE($1, uuid_erp),
                erp_vinculado_en = COALESCE(erp_vinculado_en, CURRENT_TIMESTAMP),
                rut = CASE WHEN $22 THEN rut ELSE COALESCE($2, rut) END,
                dv = CASE WHEN $22 THEN dv ELSE COALESCE($3, dv) END,
                documento_erp = COALESCE($4, documento_erp),
                tipo_identificador = CASE WHEN $22 THEN tipo_identificador ELSE $5 END,
                tipo_documento_extranjero = CASE WHEN $22 THEN tipo_documento_extranjero ELSE $6 END,
                pais_emisor_documento = CASE WHEN $22 THEN pais_emisor_documento ELSE $7 END,
                nombres = $8,
                paterno = $9,
                materno = $10,
                email = COALESCE($11, email),
                telefono = COALESCE($12, telefono),
                rol = $13,
                seccion = COALESCE($14, seccion),
                genero = COALESCE($15, genero),
                fecha_nacimiento = COALESCE($16, fecha_nacimiento),
                nombre_usuario = COALESCE($17, nombre_usuario),
                rut_apoderado = COALESCE($18, rut_apoderado),
                codigo_barra = CASE WHEN $22 THEN codigo_barra ELSE $19 END,
                activo = CASE WHEN $20 THEN true ELSE activo END,
                fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE id_alumno = $21
          `;
          await client.query(updateQuery, [
            identity.uuidErp, rut, dv, documentoErp, identity.identityType,
            identity.foreignDocumentType, identity.countryCode,
            nombresInput, paterno, materno || null, email, telefono, rol, seccion, genero,
            fechaNacimiento, username, rutApoderado, codigoBarra,
            reactivatesInactive,
            idAlumno,
            preserveRegularizedRun
          ]);
          summary.updated++;
          rowAction = 'ACTUALIZADO';
          if (reactivatesInactive) {
            summary.reactivated++;
            rowAction = 'REACTIVADO_DESDE_ERP';
          }
          if (linksManualRecord) {
            summary.linked_manual++;
            rowAction = 'VINCULADO_MANUAL';
          }
        } else {
          idAlumno = existing.id_alumno;
          summary.unchanged++;
          rowAction = 'SIN_CAMBIOS';
        }

        // La tabla de identificadores es aditiva: conserva las columnas
        // heredadas y permite buscar por RUN, IPE, documento, ERP o carnet.
        await syncStudentIdentifiers(client, {
          studentId: idAlumno,
          identity,
          barcode: codigoBarra,
          source: 'ERP',
          userId: req.user.id
        });

        // 5. UPDATE MATRICULA / CURSO LINK
        if (courseId) {
          await assignEnrollment(client, {
            studentId: idAlumno,
            courseId,
            userId: req.user.id,
            reason: 'Sincronización desde planilla ERP'
          });
        }

        // 6. Guardar snapshot saneado. La importación nunca crea ni modifica cuentas de acceso.
        await client.query(
          `INSERT INTO alumno_excel_snapshot (id_alumno, raw_payload, fecha_importacion)
           VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
           ON CONFLICT (id_alumno)
           DO UPDATE SET raw_payload = EXCLUDED.raw_payload, fecha_importacion = EXCLUDED.fecha_importacion`,
          [idAlumno, JSON.stringify(snapshotRow)]
        );

        const afterSnapshot = await client.query(
          `SELECT a.id_alumno, a.uuid_erp, a.rut, a.dv, a.documento_erp,
                  a.tipo_identificador, a.tipo_documento_extranjero, a.pais_emisor_documento,
                  a.nombres, a.paterno,
                  a.materno, a.email, a.telefono, a.activo,
                  c.nombre_curso AS grade
           FROM alumno a
           LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
           LEFT JOIN curso c ON c.id_curso = m.id_curso
           WHERE a.id_alumno = $1`,
          [idAlumno]
        );
        await client.query(
          `INSERT INTO importacion_estudiante_cambios (
             importacion_id, numero_fila, id_alumno, accion, rut_referencia,
             comparacion, anterior, posterior, mensaje
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9)`,
          [
            importId,
            excelRowNumber,
            idAlumno,
            rowAction,
            rut || documentoErp,
            JSON.stringify(previewRow?.field_comparison || []),
            beforeSnapshot ? JSON.stringify(beforeSnapshot) : null,
            JSON.stringify(afterSnapshot.rows[0] || {}),
            rowAction === 'VINCULADO_MANUAL'
              ? 'La ficha manual fue reconocida y vinculada al ERP sin duplicarla.'
              : rowAction === 'REACTIVADO_DESDE_ERP'
                ? 'La ficha inactiva reapareció y fue reactivada mediante confirmación expresa.'
                : null
          ]
        );

        await client.query(`RELEASE SAVEPOINT ${rowSavepoint}`);
      } catch (rowError) {
        await client.query(`ROLLBACK TO SAVEPOINT ${rowSavepoint}`);
        await client.query(`RELEASE SAVEPOINT ${rowSavepoint}`);
        console.error(`[bulk-sync] Row error at row ${excelRowNumber}:`, rowError.message);
        summary.errors.push({ row: excelRowNumber, message: rowError.message });
        await client.query(
          `INSERT INTO importacion_estudiante_cambios (
             importacion_id, numero_fila, accion, rut_referencia, mensaje
           ) VALUES ($1, $2, 'RECHAZADO', $3, $4)`,
          [
            importId,
            excelRowNumber,
            previewByRow.get(excelRowNumber)?.rut_normalizado || null,
            String(rowError.message || 'Error de procesamiento').slice(0, 1000)
          ]
        );
      }
    }

    for (const missing of missingStudents) {
      await closeEnrollment(client, {
        studentId: missing.id_alumno,
        userId: req.user.id,
        reason: `Retiro confirmado mediante nómina oficial completa: ${fileName}`
      });
      await client.query(
        `UPDATE alumno
         SET activo = false, fecha_actualizacion = CURRENT_TIMESTAMP
         WHERE id_alumno = $1`,
        [missing.id_alumno]
      );
      await client.query(
        `INSERT INTO importacion_estudiante_cambios (
           importacion_id, id_alumno, accion, rut_referencia, anterior, posterior, mensaje
         ) VALUES ($1, $2, 'RETIRADO_POR_NOMINA', $3, $4::jsonb, $5::jsonb, $6)`,
        [
          importId,
          missing.id_alumno,
          missing.rut,
          JSON.stringify({ activo: true, curso: missing.curso }),
          JSON.stringify({ activo: false, curso: null }),
          'Retiro confirmado porque el estudiante no figura en la nómina oficial completa.'
        ]
      );
      summary.retired++;
    }

    await client.query(
      `UPDATE importaciones_estudiantes
       SET estado = $1,
           filas_creadas = $2,
           filas_actualizadas = $3,
           filas_sin_cambios = $4,
           filas_vinculadas = $5,
           filas_retiradas = $6,
           filas_rechazadas = $7,
           resumen = $8::jsonb
       WHERE id = $9`,
      [
        summary.errors.length ? 'COMPLETADA_CON_ERRORES' : 'COMPLETADA',
        summary.inserted,
        summary.updated,
        summary.unchanged,
        summary.linked_manual,
        summary.retired,
        summary.errors.length,
        JSON.stringify(summary),
        importId
      ]
    );

    await client.query('COMMIT');
    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'IMPORTACION_ALUMNOS',
      detalle: {
        total: summary.total,
        insertados: summary.inserted,
        actualizados: summary.updated,
        vinculados_manuales: summary.linked_manual,
        reactivados: summary.reactivated,
        errores: summary.errors.length
      },
      ip: getClientIp(req)
    });
    res.json({ ...summary, import_id: importId, import_mode: importMode });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err.message);
    res.status(500).json({ message: 'Error al sincronizar datos del colegio.' });
  } finally {
    client.release();
  }
});
};

module.exports = { registerStudentImportRoutes };
