const {
  IDENTIFIER_TYPES,
  getStudentIdentifiers,
  regularizeIpeToRun,
  syncStudentIdentifiers
} = require('../../services/studentIdentifierService');
const {
  createDocument,
  DocumentValidationError,
  removeStoredFile,
  resolveDocumentPath
} = require('../../services/documentService');

const IDENTITY_SUPPORT_TYPES = new Set([
  'CEDULA_IDENTIDAD',
  'CERTIFICADO_NACIMIENTO',
  'COMPROBANTE_REGULARIZACION',
  'DOCUMENTO_MINEDUC',
  'OTRO'
]);

const registerStudentManagementRoutes = (context) => {
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
    MANUAL_IDENTITY_TYPES,
    normalizeManualStudentIdentity,
    normalizeStudentPayload,
    sanitizeStudentText,
    validateManualStudentIdentity,
    validateStudentPayload,
    validateStudentRut,
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

// GET SINGLE STUDENT DETAILS
app.get('/api/students/:id/details', verifyToken, verifyAnyPermission(['students.view', 'students.manage', 'students.identity.regularize']), async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT ${STUDENT_PUBLIC_FIELDS}, c.nombre_curso as grade
      FROM alumno a
      LEFT JOIN matricula_actual m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE a.id_alumno = $1
    `;
    const [resA, enrollmentHistory, identifiers, identityRegularizations] = await Promise.all([
      pool.query(query, [id]),
      pool.query(`
        SELECT m.id_matricula, c.nombre_curso, m.vigente_desde, m.vigente_hasta,
               m.motivo_cambio, m.fecha_registro
        FROM matricula m
        JOIN curso c ON c.id_curso = m.id_curso
        WHERE m.id_alumno = $1
        ORDER BY m.vigente_desde DESC, m.id_matricula DESC
      `, [id]),
      getStudentIdentifiers(pool, id),
      pool.query(`
        SELECT r.id_regularizacion, r.tipo_operacion, r.motivo,
               r.tipo_respaldo, r.detalle_respaldo, r.realizado_en,
               previous_identifier.valor_original AS identificador_anterior,
               current_identifier.valor_original AS identificador_nuevo,
               d.id_documento, d.nombre_original AS documento_nombre,
               d.mime_type AS documento_mime_type,
               u.nombre AS realizado_por_nombre, u.correo AS realizado_por_correo
        FROM regularizaciones_identidad_estudiante r
        JOIN alumno_identificador previous_identifier
          ON previous_identifier.id_identificador = r.identificador_anterior_id
        JOIN alumno_identificador current_identifier
          ON current_identifier.id_identificador = r.identificador_nuevo_id
        JOIN justification_documents d ON d.id_documento = r.documento_id
        LEFT JOIN usuarios u ON u.id = r.realizado_por
        WHERE r.id_alumno = $1
        ORDER BY r.realizado_en DESC, r.id_regularizacion DESC
      `, [id])
    ]);
    if (resA.rows.length === 0) return res.status(404).json({ message: 'Miembro no encontrado.' });

    res.json({
      alumno: resA.rows[0],
      historial_matricula: enrollmentHistory.rows,
      identificadores: identifiers,
      regularizaciones_identidad: identityRegularizations.rows
    });
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener detalles.' });
  }
});

app.post(
  '/api/students/:id/identifiers/ipe-to-run',
  verifyToken,
  verifyPermission('students.identity.regularize'),
  async (req, res) => {
    const studentId = Number.parseInt(req.params.id, 10);
    const normalizedRun = normalizeRutAndDv(req.body?.run, req.body?.dv);
    const reason = sanitizeStudentText(req.body?.motivo, 500);
    const supportType = String(req.body?.tipo_respaldo || '').trim().toUpperCase();
    const supportDetail = sanitizeStudentText(req.body?.detalle_respaldo, 500);
    const fileName = req.body?.fileName;
    const fileData = req.body?.fileData;

    if (!Number.isInteger(studentId) || studentId <= 0) {
      return res.status(400).json({ message: 'La ficha estudiantil no es válida.' });
    }
    if (!validateStudentRut(normalizedRun.rut, normalizedRun.dv)) {
      return res.status(400).json({ message: 'El nuevo RUN chileno no es válido.' });
    }
    if (reason.length < 10) {
      return res.status(400).json({ message: 'Explique la regularización en al menos 10 caracteres.' });
    }
    if (!IDENTITY_SUPPORT_TYPES.has(supportType)) {
      return res.status(400).json({ message: 'Seleccione el tipo de respaldo institucional.' });
    }
    if (supportType === 'OTRO' && supportDetail.length < 5) {
      return res.status(400).json({ message: 'Describa el respaldo utilizado en al menos 5 caracteres.' });
    }
    if (!fileName || !fileData) {
      return res.status(400).json({ message: 'La regularización requiere un respaldo adjunto en PDF, PNG o JPG.' });
    }

    const client = await pool.connect();
    let createdDocument = null;
    try {
      await client.query('BEGIN');
      createdDocument = await createDocument(client, {
        fileData,
        fileName,
        userId: req.user.id
      });

      const result = await regularizeIpeToRun(client, {
        studentId,
        rut: normalizedRun.rut,
        dv: normalizedRun.dv,
        reason,
        supportType,
        supportDetail: supportDetail || null,
        documentId: createdDocument.id_documento,
        userId: req.user.id
      });

      await insertarAudit(client, {
        usuario_id: req.user.id,
        usuario_correo: req.user.correo,
        accion: 'REGULARIZAR_IPE_A_RUN',
        entidad: 'alumno',
        entidad_id: studentId,
        detalle: {
          regularizacion_id: result.regularization.id_regularizacion,
          identificador_anterior: result.previousIdentifier.valor_original,
          identificador_nuevo: result.newIdentifier.valor_original,
          motivo: reason,
          tipo_respaldo: supportType,
          detalle_respaldo: supportDetail || null,
          documento_id: createdDocument.id_documento
        },
        ip: getClientIp(req)
      });
      await client.query('COMMIT');

      res.json({
        message: 'El RUN quedó vinculado a la misma ficha y el IPE se conservó como identificador anterior.',
        regularizacion: {
          id_regularizacion: result.regularization.id_regularizacion,
          identificador_anterior: result.previousIdentifier.valor_original,
          identificador_nuevo: result.newIdentifier.valor_original,
          documento_nombre: createdDocument.nombre_original,
          realizado_en: result.regularization.realizado_en
        }
      });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (createdDocument?.nombre_almacenado) {
        await removeStoredFile(createdDocument.nombre_almacenado).catch(() => {});
      }
      const statusByCode = {
        STUDENT_NOT_FOUND: 404,
        IPE_NOT_PRIMARY: 409,
        RUN_COLLISION: 409
      };
      const status = error instanceof DocumentValidationError
        ? error.statusCode
        : statusByCode[error.code] || 500;
      if (status === 500) console.error('[students:regularize-ipe-run]', error.message);
      res.status(status).json({
        code: error.code || undefined,
        message: status === 500 ? 'No fue posible regularizar la identidad del estudiante.' : error.message
      });
    } finally {
      client.release();
    }
  }
);

app.get(
  '/api/students/:studentId/identity-regularizations/:regularizationId/document',
  verifyToken,
  verifyPermission('students.identity.regularize'),
  async (req, res) => {
    const studentId = Number.parseInt(req.params.studentId, 10);
    const regularizationId = Number.parseInt(req.params.regularizationId, 10);
    if (!Number.isInteger(studentId) || !Number.isInteger(regularizationId)) {
      return res.status(400).json({ message: 'La referencia del respaldo no es válida.' });
    }

    try {
      const result = await pool.query(
        `SELECT d.nombre_original, d.nombre_almacenado, d.mime_type
         FROM regularizaciones_identidad_estudiante r
         JOIN justification_documents d ON d.id_documento = r.documento_id
         WHERE r.id_alumno = $1 AND r.id_regularizacion = $2
         LIMIT 1`,
        [studentId, regularizationId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'El respaldo no está disponible.' });
      }

      const document = result.rows[0];
      const documentPath = resolveDocumentPath(document.nombre_almacenado);
      if (!documentPath || !fs.existsSync(documentPath)) {
        return res.status(404).json({ message: 'El archivo de respaldo no está disponible.' });
      }
      res.type(document.mime_type);
      return res.download(documentPath, document.nombre_original);
    } catch (error) {
      console.error('[students:identity-document]', error.message);
      return res.status(500).json({ message: 'No fue posible descargar el respaldo.' });
    }
  }
);

// CREATE STUDENT
app.post('/api/students', verifyToken, verifyPermission('students.manage'), async (req, res) => {
  const student = normalizeStudentPayload(req.body);
  const identity = normalizeManualStudentIdentity(req.body);
  const manualReason = String(req.body?.motivo_alta_manual || '').toUpperCase();
  const manualDetail = sanitizeStudentText(req.body?.detalle_alta_manual || '', 500);
  const allowedManualReasons = [
    'MATRICULA_RECIENTE',
    'TRASLADO_ESTABLECIMIENTO',
    'PENDIENTE_ERP',
    'ERROR_TEMPORAL_ERP',
    'REGULARIZACION_INSTITUCIONAL',
    'OTRO'
  ];
  const validationErrors = [
    ...validateStudentPayload(student, { requireRut: false }),
    ...validateManualStudentIdentity(identity, { manualDetail })
  ];
  if (!allowedManualReasons.includes(manualReason)) {
    validationErrors.push('Seleccione el motivo institucional del alta manual.');
  }
  if (manualReason === 'OTRO' && manualDetail.length < 5) {
    validationErrors.push('Explique el motivo del alta manual en al menos 5 caracteres.');
  }
  if (validationErrors.length) {
    return res.status(400).json({ message: validationErrors[0], errors: validationErrors });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const identifierType = identity.identityType === MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO
      ? null
      : identity.identityType;
    let duplicate = { rows: [] };
    if (identifierType) {
      duplicate = await client.query(
        `SELECT a.id_alumno, a.activo
         FROM alumno_identificador ai
         JOIN alumno a ON a.id_alumno = ai.id_alumno
         WHERE ai.tipo = $1
           AND ai.valor_normalizado = $2
           AND COALESCE(ai.pais_emisor, '') = COALESCE($3, '')
           AND ai.estado <> 'REVOCADO'
           AND a.fusionado_en_id IS NULL
         LIMIT 1
         FOR UPDATE OF a, ai`,
        [identifierType, identity.documentNormalized, identity.countryCode]
      );
    }
    if (duplicate.rows.length === 0 && identity.identityType === MANUAL_IDENTITY_TYPES.RUN_CHILE) {
      duplicate = await client.query(
        'SELECT id_alumno, activo FROM alumno WHERE rut = $1 AND fusionado_en_id IS NULL FOR UPDATE',
        [identity.rut]
      );
    }
    if (duplicate.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: duplicate.rows[0].activo ? 'STUDENT_ALREADY_EXISTS' : 'STUDENT_INACTIVE_EXISTS',
        id_alumno: duplicate.rows[0].id_alumno,
        message: duplicate.rows[0].activo
          ? 'El identificador ya pertenece a una persona vigente en el padrón.'
          : 'El identificador pertenece a una persona retirada. Puede reactivar su matrícula desde la ficha.'
      });
    }

    const courseLookup = await client.query(
      'SELECT id_curso, nombre_curso FROM curso WHERE LOWER(nombre_curso) = LOWER($1) LIMIT 1',
      [student.grade]
    );
    if (courseLookup.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El curso seleccionado no existe en el padrón institucional.' });
    }

    const legacyIdentityType = identity.identityType === MANUAL_IDENTITY_TYPES.RUN_CHILE
      ? 'RUN_CHILE'
      : identity.identityType === MANUAL_IDENTITY_TYPES.IPE_MINEDUC
        ? 'IPE_MINEDUC'
        : identity.identityType === MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO
          ? 'SIN_IDENTIFICADOR_MANUAL'
          : 'DOCUMENTO_EXTRANJERO';
    const legacyDocument = [
      MANUAL_IDENTITY_TYPES.IPE_MINEDUC,
      MANUAL_IDENTITY_TYPES.PASAPORTE,
      MANUAL_IDENTITY_TYPES.DNI,
      MANUAL_IDENTITY_TYPES.CEDULA
    ].includes(identity.identityType)
      ? identity.documentOriginal
      : null;
    const initialBarcode = identity.identityType === MANUAL_IDENTITY_TYPES.RUN_CHILE
      ? identity.documentNormalized
      : identity.identityType === MANUAL_IDENTITY_TYPES.IPE_MINEDUC
        ? identity.documentNormalized
        : null;

    const ins = await client.query(
      `INSERT INTO alumno (
         rut, dv, documento_erp, tipo_identificador, tipo_documento_extranjero,
         pais_emisor_documento, nombres, paterno, materno, email, telefono, rol, codigo_barra,
         origen_alta, creado_manualmente_por, motivo_alta_manual,
         detalle_alta_manual, creado_manualmente_en
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
         'MANUAL', $14, $15, $16, CURRENT_TIMESTAMP
       )
       RETURNING id_alumno`,
      [
        identity.rut,
        identity.dv,
        legacyDocument,
        legacyIdentityType,
        identity.foreignDocumentType,
        identity.countryCode,
        student.nombres,
        student.paterno,
        student.materno || null,
        student.email || null,
        student.telefono || null,
        'Estudiante',
        initialBarcode,
        req.user.id,
        manualReason,
        manualDetail || null
      ]
    );
    const idAlumno = ins.rows[0].id_alumno;
    const operationalCode = initialBarcode || `LDSM-${String(idAlumno).padStart(8, '0')}`;
    if (!initialBarcode) {
      await client.query(
        'UPDATE alumno SET codigo_barra = $1 WHERE id_alumno = $2',
        [operationalCode, idAlumno]
      );
    }

    const identifierIdentity = identity.identityType === MANUAL_IDENTITY_TYPES.RUN_CHILE
      ? {
          identityType: IDENTIFIER_TYPES.RUN_CHILE,
          rut: identity.rut,
          dv: identity.dv,
          validationLevel: identity.validationLevel
        }
      : identity.identityType === MANUAL_IDENTITY_TYPES.IPE_MINEDUC
        ? {
            identityType: IDENTIFIER_TYPES.IPE_MINEDUC,
            documentoErp: identity.documentOriginal,
            validationLevel: identity.validationLevel
          }
        : identity.identityType === MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO
          ? {
              identityType: IDENTIFIER_TYPES.CODIGO_INTERNO,
              internalCode: operationalCode,
              validationLevel: identity.validationLevel
            }
          : {
              identityType: IDENTIFIER_TYPES.DOCUMENTO_EXTRANJERO,
              documentoErp: identity.documentOriginal,
              foreignDocumentType: identity.foreignDocumentType,
              countryCode: identity.countryCode,
              validationLevel: identity.validationLevel
            };

    await syncStudentIdentifiers(client, {
      studentId: idAlumno,
      identity: identifierIdentity,
      barcode: operationalCode,
      source: 'MANUAL',
      userId: req.user.id
    });

    await client.query(
      `INSERT INTO matricula (
         id_alumno, id_curso, vigente_desde, motivo_cambio, creado_por, actualizado_por
       ) VALUES ($1, $2, CURRENT_DATE, 'Creación manual de estudiante', $3, $3)`,
      [idAlumno, courseLookup.rows[0].id_curso, req.user.id]
    );

    await client.query('COMMIT');

    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'CREAR_ALUMNO',
      entidad: 'alumno',
      entidad_id: idAlumno,
      detalle: {
        origen: 'MANUAL',
        tipo_identificador: identity.identityType,
        pais_emisor: identity.countryCode,
        identificador_interno: identity.identityType === MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO
          ? operationalCode
          : null,
        nombre: `${student.nombres} ${student.paterno} ${student.materno}`.trim(),
        curso: courseLookup.rows[0].nombre_curso,
        motivo_alta_manual: manualReason,
        detalle_alta_manual: manualDetail || null
      },
      ip: getClientIp(req)
    });

    res.status(201).json({
      id_alumno: idAlumno,
      tipo_identificador: identity.identityType,
      message: 'Estudiante y matrícula creados correctamente.'
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err.message);
    if (err.code === '23505' || err.code === 'IDENTIFIER_COLLISION') {
      return res.status(409).json({ message: 'El identificador o código operativo ya se encuentra registrado.' });
    }
    res.status(500).json({ message: 'No fue posible crear al estudiante.' });
  } finally {
    client.release();
  }
});

// UPDATE STUDENT
app.put('/api/students/:id', verifyToken, verifyPermission('students.manage'), async (req, res) => {
  const { id } = req.params;
  const student = normalizeStudentPayload(req.body);
  const validationErrors = validateStudentPayload(student, { requireRut: false });
  if (validationErrors.length) {
    return res.status(400).json({ message: validationErrors[0], errors: validationErrors });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT a.id_alumno, a.nombres, a.paterno, a.materno, a.email, a.telefono, a.activo,
              c.id_curso, c.nombre_curso AS grade
       FROM alumno a
       LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
       LEFT JOIN curso c ON c.id_curso = m.id_curso
       WHERE a.id_alumno = $1
       FOR UPDATE OF a`,
      [id]
    );
    if (before.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Estudiante no encontrado.' });
    }

    const courseLookup = await client.query(
      'SELECT id_curso, nombre_curso FROM curso WHERE LOWER(nombre_curso) = LOWER($1) LIMIT 1',
      [student.grade]
    );
    if (courseLookup.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El curso seleccionado no existe en el padrón institucional.' });
    }

    const updated = await client.query(
      `UPDATE alumno
       SET nombres = $1, paterno = $2, materno = $3, email = $4, telefono = $5,
           rol = 'Estudiante', fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id_alumno = $6 RETURNING id_alumno`,
      [
        student.nombres,
        student.paterno,
        student.materno || null,
        student.email || null,
        student.telefono || null,
        id
      ]
    );
    await assignEnrollment(client, {
      studentId: id,
      courseId: courseLookup.rows[0].id_curso,
      userId: req.user.id,
      reason: req.body?.motivo_cambio || 'Edición manual de ficha y curso'
    });
    await client.query('COMMIT');

    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'EDITAR_ALUMNO',
      entidad: 'alumno',
      entidad_id: id,
      detalle: {
        origen: 'MANUAL',
        anterior: {
          nombre: `${before.rows[0].nombres} ${before.rows[0].paterno} ${before.rows[0].materno || ''}`.trim(),
          curso: before.rows[0].grade
        },
        nuevo: {
          nombre: `${student.nombres} ${student.paterno} ${student.materno}`.trim(),
          curso: courseLookup.rows[0].nombre_curso
        }
      },
      ip: getClientIp(req)
    });

    res.json({ id_alumno: updated.rows[0].id_alumno, message: 'Ficha y matrícula actualizadas correctamente.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err.message);
    res.status(500).json({ message: 'No fue posible actualizar al estudiante.' });
  } finally {
    client.release();
  }
});

// DELETE STUDENT
app.delete('/api/students/:id', verifyToken, verifyPermission('students.manage'), async (req, res) => {
  const { id } = req.params;
  const motivo = sanitizeStudentText(req.body?.motivo, 240);
  if (motivo.length < 5) {
    return res.status(400).json({ message: 'Indique un motivo de retiro de al menos 5 caracteres.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE alumno
       SET activo = false, fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id_alumno = $1 AND activo = true
       RETURNING id_alumno, rut, dv, nombres, paterno, materno`,
      [id]
    );
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'El estudiante no existe o ya se encuentra retirado.' });
    }
    const student = result.rows[0];
    await closeEnrollment(client, {
      studentId: id,
      userId: req.user.id,
      reason: motivo
    });
    await client.query('COMMIT');

    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'DESACTIVAR_ALUMNO',
      entidad: 'alumno',
      entidad_id: id,
      detalle: {
        origen: 'MANUAL',
        motivo,
        rut: `${student.rut}-${student.dv}`,
        nombre: `${student.nombres} ${student.paterno} ${student.materno || ''}`.trim()
      },
      ip: getClientIp(req)
    });

    res.json({ message: 'Matrícula retirada sin eliminar el historial del estudiante.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[students:retire]', err.message);
    res.status(500).json({ message: 'No fue posible retirar la matrícula.' });
  } finally {
    client.release();
  }
});

app.post('/api/students/:id/reactivate', verifyToken, verifyPermission('students.manage'), async (req, res) => {
  const { id } = req.params;
  const grade = sanitizeStudentText(req.body?.grade, 80);
  if (!grade) return res.status(400).json({ message: 'Seleccione el curso vigente del estudiante.' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT id_alumno, rut, dv, nombres, paterno, materno, activo
       FROM alumno WHERE id_alumno = $1 FOR UPDATE`,
      [id]
    );
    if (current.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Estudiante no encontrado.' });
    }
    if (current.rows[0].activo) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'El estudiante ya tiene una matrícula activa.' });
    }

    const courseLookup = await client.query(
      'SELECT id_curso, nombre_curso FROM curso WHERE LOWER(nombre_curso) = LOWER($1) LIMIT 1',
      [grade]
    );
    if (courseLookup.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'El curso seleccionado no existe en el padrón institucional.' });
    }

    await client.query(
      `UPDATE alumno SET activo = true, rol = 'Estudiante', fecha_actualizacion = CURRENT_TIMESTAMP
       WHERE id_alumno = $1`,
      [id]
    );
    await assignEnrollment(client, {
      studentId: id,
      courseId: courseLookup.rows[0].id_curso,
      userId: req.user.id,
      reason: req.body?.motivo || 'Reactivación manual de matrícula'
    });
    await client.query('COMMIT');

    const student = current.rows[0];
    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'REACTIVAR_ALUMNO',
      entidad: 'alumno',
      entidad_id: id,
      detalle: {
        origen: 'MANUAL',
        rut: `${student.rut}-${student.dv}`,
        nombre: `${student.nombres} ${student.paterno} ${student.materno || ''}`.trim(),
        curso: courseLookup.rows[0].nombre_curso
      },
      ip: getClientIp(req)
    });

    res.json({ message: 'Matrícula reactivada correctamente.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[students:reactivate]', err.message);
    res.status(500).json({ message: 'No fue posible reactivar la matrícula.' });
  } finally {
    client.release();
  }
});
};

module.exports = { registerStudentManagementRoutes };
