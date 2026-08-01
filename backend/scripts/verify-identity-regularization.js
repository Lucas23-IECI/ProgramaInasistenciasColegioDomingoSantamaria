const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../db');
const { calculateRutDv } = require('../utils/students');
const {
  getStudentIdentifiers,
  regularizeIpeToRun,
  syncStudentIdentifiers
} = require('../services/studentIdentifierService');

const run = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      `SELECT id
       FROM usuarios
       WHERE activo = true AND eliminado_en IS NULL
       ORDER BY CASE WHEN rol = 'admin' THEN 0 ELSE 1 END, id
       LIMIT 1`
    );
    assert.ok(userResult.rows[0]?.id, 'Se necesita una cuenta activa para la trazabilidad');
    const userId = userResult.rows[0].id;

    const suffix = crypto.randomInt(100000, 999999);
    const ipe = `100${suffix}`;
    const runBody = String(25000000 + crypto.randomInt(1000000, 9000000));
    const runDv = calculateRutDv(runBody);
    const uniqueToken = crypto.randomUUID();

    const studentResult = await client.query(
      `INSERT INTO alumno (
         uuid_erp, documento_erp, tipo_identificador, nombres, paterno,
         rol, codigo_barra, origen_alta, erp_vinculado_en
       ) VALUES ($1, $2, 'IPE_MINEDUC', 'Prueba', 'Regularizacion',
                 'Estudiante', $2, 'ERP', CURRENT_TIMESTAMP)
       RETURNING id_alumno`,
      [uniqueToken, ipe]
    );
    const studentId = studentResult.rows[0].id_alumno;

    await syncStudentIdentifiers(client, {
      studentId,
      identity: {
        identityType: 'IPE_MINEDUC',
        documentoErp: ipe,
        uuidErp: uniqueToken,
        validationLevel: 'FUENTE_MINEDUC_ERP'
      },
      barcode: ipe,
      source: 'ERP',
      userId
    });

    const courseResult = await client.query('SELECT id_curso FROM curso ORDER BY id_curso LIMIT 1');
    let enrollmentId = null;
    if (courseResult.rows[0]) {
      const enrollmentResult = await client.query(
        `INSERT INTO matricula (
           id_alumno, id_curso, vigente_desde, motivo_cambio, creado_por, actualizado_por
         ) VALUES ($1, $2, CURRENT_DATE, 'Prueba transaccional', $3, $3)
         RETURNING id_matricula`,
        [studentId, courseResult.rows[0].id_curso, userId]
      );
      enrollmentId = enrollmentResult.rows[0].id_matricula;
    }

    const configResult = await client.query(
      `SELECT nombre_jornada, hora_entrada, hora_limite_atraso,
              minutos_atraso_grave, version_regla
       FROM configuracion_asistencia
       LIMIT 1`
    );
    const config = configResult.rows[0];
    assert.ok(config, 'Se necesita una configuración de puntualidad');
    const controlResult = await client.query(
      `SELECT id, codigo, nombre, tipo, hora_apertura, hora_cierre, version, cuenta_alertas
       FROM controles_puntualidad
       WHERE activo = true
       ORDER BY orden, id
       LIMIT 1`
    );
    const control = controlResult.rows[0];
    assert.ok(control, 'Se necesita un control de puntualidad activo');

    const attendanceResult = await client.query(
      `INSERT INTO attendance_registrations (
         id_alumno, fecha, hora, estado, tipo_registro,
         id_matricula_registro, id_curso_registro, curso_registro,
         jornada_registro, hora_entrada_aplicada, hora_limite_aplicada,
         minutos_atraso_grave_aplicado, minutos_atraso, version_regla,
         control_puntualidad_id, control_codigo, control_nombre, control_tipo,
         hora_apertura_aplicada, hora_cierre_aplicada, control_version,
         cuenta_alertas_aplicado
       ) VALUES (
         $1, CURRENT_DATE - INTERVAL '370 days', '08:20', 'Atrasado', 'Entrada',
         $2, $3, 'Curso de prueba',
         $4, $5, $6, $7, 5, $8,
         $9, $10, $11, $12, $13, $14, $15, $16
       )
       RETURNING id_registro`,
      [
        studentId,
        enrollmentId,
        courseResult.rows[0]?.id_curso || null,
        config.nombre_jornada,
        config.hora_entrada,
        config.hora_limite_atraso,
        config.minutos_atraso_grave,
        config.version_regla,
        control.id,
        control.codigo,
        control.nombre,
        control.tipo,
        control.hora_apertura,
        control.hora_cierre,
        control.version,
        control.cuenta_alertas
      ]
    );
    const attendanceId = attendanceResult.rows[0].id_registro;

    const documentResult = await client.query(
      `INSERT INTO justification_documents (
         nombre_original, nombre_almacenado, mime_type, tamano_bytes, sha256, creado_por
       ) VALUES (
         'respaldo-prueba.pdf', $1, 'application/pdf', 5, $2, $3
       )
       RETURNING id_documento`,
      [`${uniqueToken}.pdf`, crypto.createHash('sha256').update('prueba').digest('hex'), userId]
    );

    const result = await regularizeIpeToRun(client, {
      studentId,
      rut: runBody,
      dv: runDv,
      reason: 'Regularizacion transaccional automatizada',
      supportType: 'DOCUMENTO_MINEDUC',
      supportDetail: 'Respaldo generado unicamente para la prueba',
      documentId: documentResult.rows[0].id_documento,
      userId
    });

    assert.equal(Number(result.student.id_alumno), Number(studentId));
    const updatedStudent = await client.query(
      `SELECT id_alumno, rut, dv, documento_erp, tipo_identificador
       FROM alumno WHERE id_alumno = $1`,
      [studentId]
    );
    assert.deepEqual(updatedStudent.rows[0], {
      id_alumno: studentId,
      rut: runBody,
      dv: runDv,
      documento_erp: ipe,
      tipo_identificador: 'RUN_CHILE'
    });

    const identifiers = await getStudentIdentifiers(client, studentId);
    const runIdentifier = identifiers.find((identifier) => identifier.tipo === 'RUN_CHILE');
    const ipeIdentifier = identifiers.find((identifier) => identifier.tipo === 'IPE_MINEDUC');
    assert.equal(runIdentifier?.es_principal, true);
    assert.equal(runIdentifier?.estado, 'PRINCIPAL');
    assert.equal(ipeIdentifier?.es_principal, false);
    assert.equal(ipeIdentifier?.estado, 'ANTERIOR');

    const preservedRelations = await client.query(
      `SELECT
         EXISTS (SELECT 1 FROM attendance_registrations WHERE id_registro = $1 AND id_alumno = $3) AS atraso,
         CASE WHEN $2::int IS NULL THEN true ELSE
           EXISTS (SELECT 1 FROM matricula WHERE id_matricula = $2 AND id_alumno = $3)
         END AS matricula,
         EXISTS (
           SELECT 1 FROM regularizaciones_identidad_estudiante
           WHERE id_regularizacion = $4 AND id_alumno = $3
         ) AS regularizacion`,
      [attendanceId, enrollmentId, studentId, result.regularization.id_regularizacion]
    );
    assert.deepEqual(preservedRelations.rows[0], {
      atraso: true,
      matricula: true,
      regularizacion: true
    });

    await client.query('ROLLBACK');
    console.log(JSON.stringify({
      status: 'OK',
      same_student: true,
      ipe_preserved_as_previous: true,
      run_is_primary: true,
      enrollment_preserved: true,
      attendance_preserved: true,
      transaction_rolled_back: true
    }));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
