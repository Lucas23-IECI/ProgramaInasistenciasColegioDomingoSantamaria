const { normalizeIdentifierValue } = require('../../services/studentIdentifierService');
const { protectStudentRecord } = require('../../utils/studentPrivacy');

const registerStudentRegistryRoutes = (context) => {
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

// COURSES
app.get('/api/courses', verifyToken, async (req, res) => {
  try {
    const resC = await pool.query('SELECT * FROM curso ORDER BY nombre_curso ASC');
    res.json(resC.rows);
  } catch (err) {
    res.status(500).json({ message: 'No fue posible cargar la lista de cursos.' });
  }
});

// SUPERFICIE HEREDADA DE ASISTENCIA
//
// El producto vigente controla ingresos y atrasos. Estos endpoints se
// permanecen bloqueados para que instalaciones antiguas reciban una respuesta
// inequívoca. La implementación heredada ya no forma parte del servidor activo.
const legacyAttendanceGone = (req, res) => res.status(410).json({
  code: 'MODULO_ASISTENCIA_DESCONTINUADO',
  message: 'Esta función fue retirada. Utiliza el módulo institucional de puntualidad y atrasos.',
  replacement: '/api/puntualidad'
});

app.all([
  '/api/attendance/config',
  '/api/asistencia/today',
  '/api/asistencia/today-stats',
  '/api/asistencia/range-stats',
  '/api/asistencia/inasistencias',
  '/api/asistencia/history',
  '/api/admin/reportes/asistencia',
  '/api/asistencia/justificar-nueva',
  '/api/asistencia/registrar-ausencia',
  '/api/asistencia/justificaciones',
  '/api/asistencia/alertas-tempranas'
], verifyToken, legacyAttendanceGone);

app.all('/api/asistencia/:id/justificar', verifyToken, legacyAttendanceGone);
app.all('/api/asistencia/justificacion/:id', verifyToken, legacyAttendanceGone);
app.all('/api/asistencia/download/:id', verifyToken, legacyAttendanceGone);
app.put('/api/asistencia/:id', verifyToken, legacyAttendanceGone);
app.delete('/api/asistencia/:id', verifyToken, legacyAttendanceGone);

// STUDENTS CRUD
app.get('/api/students', verifyToken, verifyAnyPermission(['students.view', 'students.manage', 'students.import', 'students.identity.regularize']), async (req, res) => {
  try {
    const query = `
      SELECT ${STUDENT_PUBLIC_FIELDS}, c.nombre_curso as grade
      FROM alumno a
      LEFT JOIN matricula_actual m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE a.fusionado_en_id IS NULL
      ORDER BY a.paterno ASC, a.nombres ASC
    `;
    const resStudents = await pool.query(query);
    res.json(resStudents.rows.map((student) => protectStudentRecord(student)));
  } catch (err) {
    res.status(500).json({ message: 'No fue posible cargar el padrón de estudiantes.' });
  }
});

app.get('/api/students/search', verifyToken, verifyAnyPermission([
  'punctuality.register',
  'punctuality.exceptions.manage',
  'punctuality.contingencies.manage',
  'punctuality.commitments.manage',
  'reports.generate',
  'students.view',
  'students.manage'
]), async (req, res) => {
  const { q } = req.query;
  const searchTerm = `%${(q || '').toString().trim().toLowerCase()}%`;
  const identifierTerm = `%${normalizeIdentifierValue(q).toLowerCase()}%`;

  try {
    const query = `
      SELECT a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv,
             a.documento_erp, a.rol, c.nombre_curso
      FROM alumno a
      LEFT JOIN matricula_actual m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE a.activo = true
        AND a.fusionado_en_id IS NULL
        AND (
          LOWER(a.nombres || ' ' || a.paterno || ' ' || COALESCE(a.materno, '')) LIKE $1
          OR LOWER(a.rut || '-' || COALESCE(a.dv, '')) LIKE $1
          OR LOWER(a.rut || COALESCE(a.dv, '')) LIKE $1
          OR LOWER(COALESCE(a.codigo_barra, '')) LIKE $1
          OR LOWER(COALESCE(a.rut, '')) LIKE $1
          OR LOWER(COALESCE(a.documento_erp, '')) LIKE $1
          OR LOWER(COALESCE(a.nombre_usuario, '')) LIKE $1
          OR EXISTS (
            SELECT 1
            FROM alumno_identificador ai
            WHERE ai.id_alumno = a.id_alumno
              AND ai.estado <> 'REVOCADO'
              AND LOWER(ai.valor_normalizado) LIKE $2
          )
        )
      LIMIT 15
    `;
    const result = await pool.query(query, [searchTerm, identifierTerm]);
    res.json(result.rows.map((student) => protectStudentRecord(student)));
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'No fue posible buscar estudiantes en este momento.' });
  }
});

app.get('/api/students/scan/:barcode', verifyToken, verifyPermission('punctuality.register'), async (req, res) => {
  const { barcode } = req.params;
  const { tipo_registro } = req.query; // Entrada / Salida
  const cleanBarcode = sanitizeText(barcode).toUpperCase().replace(/\./g, '');
  const normalizedIdentifier = normalizeIdentifierValue(cleanBarcode);

  try {
    // 1. Resolve barcode (RUT, QR, or ERP UUID)
    const query = `
      SELECT a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv,
             a.documento_erp, a.rol,
             a.activo as alumno_activo, m.id_curso, c.nombre_curso
      FROM alumno a
      LEFT JOIN matricula_actual m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE a.rut = $1
         OR a.codigo_barra = $1
         OR UPPER(REPLACE(REPLACE(COALESCE(a.documento_erp, ''), '.', ''), '-', '')) = UPPER(REPLACE($1, '-', ''))
         OR LOWER(a.uuid_erp) = LOWER($1)
         OR LOWER(a.nombre_usuario) = LOWER($1)
         OR EXISTS (
           SELECT 1
           FROM alumno_identificador ai
           WHERE ai.id_alumno = a.id_alumno
             AND ai.estado <> 'REVOCADO'
             AND ai.valor_normalizado = $2
         )
    `;

    // Try finding by RUT directly or raw barcode
    let result = await pool.query(query, [cleanBarcode, normalizedIdentifier]);
    if (result.rows.length === 0) {
      // Try resolving barcode from RUT split (e.g. if barcode is 23704570K, check if rut=23704570 and dv=K)
      const parsed = normalizeRutAndDv(cleanBarcode);
      if (parsed.rut) {
        result = await pool.query(query, [
          parsed.rut,
          normalizeIdentifierValue(`${parsed.rut}${parsed.dv || ''}`)
        ]);
      }
    }

    if (result.rows.length === 0) {
      await recordOperationalEvent(pool, {
        type: 'CODIGO_NO_ENCONTRADO',
        entity: 'scanner',
        detail: { codigo_parcial: cleanBarcode.slice(-4), largo: cleanBarcode.length },
        userId: req.user.id
      });
      return res.status(404).json({ message: 'No se encontró una persona con ese código o identificador.' });
    }

    const alumno = result.rows[0];

    if (!alumno.alumno_activo) {
      return res.status(403).json({ message: 'La persona está inactiva y no puede registrar un ingreso. Revisa su ficha antes de continuar.' });
    }

    // 2. Check check-in limit
    const currentTimeStr = await getInstitutionalClock();
    const controlRes = await pool.query(`
      SELECT id, nombre, hora_referencia, hora_inicio_atraso, minutos_atraso_grave
      FROM controles_puntualidad
      WHERE activo = true
        AND EXTRACT(ISODOW FROM CURRENT_DATE)::int = ANY(dias_semana)
        AND LOCALTIME BETWEEN hora_apertura AND hora_cierre
        AND (cardinality(cursos_ids) = 0 OR $1::int = ANY(cursos_ids))
      ORDER BY CASE WHEN cardinality(cursos_ids) > 0 THEN 0 ELSE 1 END, hora_referencia DESC, orden
      LIMIT 1
    `, [alumno.id_curso || null]);
    const control = controlRes.rows[0] || null;
    const { status: calculatedStatus, severidad } = control
      ? calculateStatusAndSeverity(tipo_registro || 'Entrada', currentTimeStr, {
          hora_entrada: control.hora_referencia,
          hora_limite_atraso: control.hora_inicio_atraso,
          minutos_atraso_grave: control.minutos_atraso_grave
        })
      : { status: 'Presente', severidad: null };

    // 3. Check if already registered today
    const checkQuery = `
      SELECT id_registro, hora, estado FROM attendance_registrations
      WHERE id_alumno = $1 AND fecha = CURRENT_DATE AND tipo_registro = $2
        AND control_puntualidad_id = $3 AND anulado = false
    `;
    const checkRes = control
      ? await pool.query(checkQuery, [alumno.id_alumno, tipo_registro || 'Entrada', control.id])
      : { rows: [] };
    const alreadyRegistered = checkRes.rows.length > 0;
    const registroPrevio = checkRes.rows[0] || null;

    res.json({
      alumno: protectStudentRecord(alumno),
      alreadyRegistered,
      registroPrevio,
      restricciones: !control
        ? ['No hay un control horario activo']
        : calculatedStatus === 'Atrasado' ? [`Ingreso Atrasado (${severidad})`] : [],
      statusPropuesto: calculatedStatus,
      severidad,
      control
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'No fue posible consultar el código escaneado. No se registró ningún ingreso.' });
  }
});

app.get('/api/students/:id/status', verifyToken, verifyAnyPermission(['punctuality.register', 'punctuality.view']), async (req, res) => {
  const { id } = req.params;
  const { tipo_registro } = req.query; // Entrada / Salida

  try {
    const query = `
      SELECT a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv,
             a.documento_erp, a.uuid_erp, a.rol,
             a.activo as alumno_activo, m.id_curso, c.nombre_curso
      FROM alumno a
      LEFT JOIN matricula_actual m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE a.id_alumno = $1
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'La persona seleccionada no existe o ya no está disponible.' });
    }

    const alumno = result.rows[0];

    // Check check-in limit
    const currentTimeStr = await getInstitutionalClock();
    const controlRes = await pool.query(`
      SELECT id, nombre, hora_referencia, hora_inicio_atraso, minutos_atraso_grave
      FROM controles_puntualidad
      WHERE activo = true
        AND EXTRACT(ISODOW FROM CURRENT_DATE)::int = ANY(dias_semana)
        AND LOCALTIME BETWEEN hora_apertura AND hora_cierre
        AND (cardinality(cursos_ids) = 0 OR $1::int = ANY(cursos_ids))
      ORDER BY CASE WHEN cardinality(cursos_ids) > 0 THEN 0 ELSE 1 END, hora_referencia DESC, orden
      LIMIT 1
    `, [alumno.id_curso || null]);
    const control = controlRes.rows[0] || null;
    const { status: calculatedStatus, severidad } = control
      ? calculateStatusAndSeverity(tipo_registro || 'Entrada', currentTimeStr, {
          hora_entrada: control.hora_referencia,
          hora_limite_atraso: control.hora_inicio_atraso,
          minutos_atraso_grave: control.minutos_atraso_grave
        })
      : { status: 'Presente', severidad: null };

    // Check if already registered today
    const checkQuery = `
      SELECT id_registro, hora, estado FROM attendance_registrations
      WHERE id_alumno = $1 AND fecha = CURRENT_DATE AND tipo_registro = $2
        AND control_puntualidad_id = $3 AND anulado = false
    `;
    const checkRes = control
      ? await pool.query(checkQuery, [alumno.id_alumno, tipo_registro || 'Entrada', control.id])
      : { rows: [] };
    const alreadyRegistered = checkRes.rows.length > 0;

    res.json({
      alumno: protectStudentRecord(alumno),
      alreadyRegistered,
      restricciones: !control
        ? ['No hay un control horario activo']
        : calculatedStatus === 'Atrasado' ? [`Ingreso Atrasado (${severidad})`] : [],
      statusPropuesto: calculatedStatus,
      severidad,
      control
    });
  } catch (err) {
    res.status(500).json({ message: 'No fue posible consultar el estado de registro de la persona.' });
  }
});

// ATTENDANCE REGISTRATIONS
// Alias transitorio de ingreso: conserva lectores instalados mientras se migra
// su destino a POST /api/puntualidad/registros. Aplica las mismas reglas.
app.post('/api/asistencia', verifyToken, verifyPermission('punctuality.register'), verifyPermission('punctuality.register.barcode'), async (req, res) => {
  const { id_alumno } = req.body;
  if (!id_alumno) {
    return res.status(400).json({ message: 'Selecciona un estudiante válido para registrar el ingreso.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const studentRes = await client.query(`
      SELECT a.id_alumno, a.activo, m.id_matricula, m.id_curso, c.nombre_curso
      FROM alumno a
      LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
      LEFT JOIN curso c ON c.id_curso = m.id_curso
      WHERE a.id_alumno = $1
      FOR SHARE OF a
    `, [id_alumno]);
    if (studentRes.rows.length === 0 || !studentRes.rows[0].activo) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'El estudiante no existe o está inactivo. Revisa su ficha antes de registrar el ingreso.' });
    }
    const configRes = await client.query('SELECT * FROM configuracion_asistencia LIMIT 1');
    const config = configRes.rows[0] || { hora_entrada: '08:00:00', hora_limite_atraso: '08:15:00' };
    const currentTimeStr = await getInstitutionalClock(client);
    const origen = 'lector';
    const student = studentRes.rows[0];
    const controlRes = await client.query(`
      SELECT *
      FROM controles_puntualidad
      WHERE activo = true
        AND EXTRACT(ISODOW FROM CURRENT_DATE)::int = ANY(dias_semana)
        AND LOCALTIME BETWEEN hora_apertura AND hora_cierre
        AND (cardinality(cursos_ids) = 0 OR $1::int = ANY(cursos_ids))
      ORDER BY CASE WHEN cardinality(cursos_ids) > 0 THEN 0 ELSE 1 END, hora_referencia DESC, orden
      LIMIT 1
    `, [student.id_curso || null]);
    const control = controlRes.rows[0];
    if (!control) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        code: 'SIN_CONTROL_HORARIO',
        message: 'No hay un control de puntualidad activo para este curso y horario.'
      });
    }
    const appliedConfig = {
      hora_entrada: control.hora_referencia,
      hora_limite_atraso: control.hora_inicio_atraso,
      minutos_atraso_grave: control.minutos_atraso_grave
    };
    const { status, severidad } = calculateStatusAndSeverity('Entrada', currentTimeStr, appliedConfig);
    const delayMinutes = calculateDelayMinutes(currentTimeStr, control.hora_inicio_atraso);
    const insertQuery = `
      INSERT INTO attendance_registrations
        (id_alumno, fecha, hora, estado, tipo_registro, severidad, origen, registrado_por, creado_en,
         id_matricula_registro, id_curso_registro, curso_registro, jornada_registro,
         hora_entrada_aplicada, hora_limite_aplicada, minutos_atraso_grave_aplicado,
         minutos_atraso, version_regla, snapshot_migrado,
         control_puntualidad_id, control_codigo, control_nombre, control_tipo,
         hora_apertura_aplicada, hora_cierre_aplicada, control_version, cuenta_alertas_aplicado)
      VALUES ($1, CURRENT_DATE, LOCALTIME, $2, 'Entrada', $3, $4, $5, CURRENT_TIMESTAMP,
              $6, $7, $8, $9, $10, $11, $12, $13, $14, false,
              $15, $16, $17, $18, $19, $20, $21, $22)
      ON CONFLICT (id_alumno, fecha, control_puntualidad_id)
        WHERE anulado = false AND tipo_registro = 'Entrada'
      DO NOTHING
      RETURNING *
    `;
    const result = await client.query(insertQuery, [
      id_alumno,
      status,
      severidad,
      origen,
      req.user.id,
      student.id_matricula || null,
      student.id_curso || null,
      student.nombre_curso || 'Sin curso informado',
      config.nombre_jornada || 'Jornada principal',
      control.hora_referencia,
      control.hora_inicio_atraso,
      control.minutos_atraso_grave,
      delayMinutes,
      config.version_regla || 1,
      control.id,
      control.codigo,
      control.nombre,
      control.tipo,
      control.hora_apertura,
      control.hora_cierre,
      control.version,
      control.cuenta_alertas
    ]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      await recordOperationalEvent(pool, {
        type: 'INGRESO_DUPLICADO',
        entity: 'alumno',
        entityId: id_alumno,
        detail: { endpoint_legacy: true },
        userId: req.user.id
      });
      return res.status(409).json({
        code: 'REGISTRO_DUPLICADO',
        message: `Esta persona ya fue registrada en “${control.nombre}”.`
      });
    }
    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'REGISTRAR_INGRESO',
      entidad: 'registro_puntualidad',
      entidad_id: result.rows[0].id_registro,
      detalle: {
        id_alumno,
        estado: status,
        severidad,
        origen,
        endpoint_legacy: true,
        curso: student.nombre_curso || null,
        minutos_atraso: delayMinutes,
        version_regla: config.version_regla || 1
      },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err.message);
    if (err.code === '23505') {
      return res.status(409).json({
        code: 'REGISTRO_DUPLICADO',
        message: 'La persona ya fue registrada en este control horario.'
      });
    }
    res.status(500).json({ message: 'No fue posible registrar el ingreso. Inténtalo nuevamente.' });
  } finally {
    client.release();
  }
});
};

module.exports = { registerStudentRegistryRoutes };
