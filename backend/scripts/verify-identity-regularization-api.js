const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const pool = require('../db');
const { removeStoredFile } = require('../services/documentService');
const { syncStudentIdentifiers } = require('../services/studentIdentifierService');
const { calculateRutDv } = require('../utils/students');

const API_BASE_URL = process.env.IDENTITY_TEST_API_URL || 'http://127.0.0.1:5000';

const run = async () => {
  let studentId = null;
  let storedDocumentName = null;

  try {
    const userResult = await pool.query(
      `SELECT u.id, u.correo, u.rol, u.nombre, u.token_version
       FROM usuarios u
       WHERE u.activo = true
         AND u.eliminado_en IS NULL
         AND EXISTS (
           SELECT 1
           FROM permisos_rol pr
           WHERE pr.rol = u.rol
             AND pr.permiso_codigo = 'students.identity.regularize'
         )
       ORDER BY CASE WHEN u.rol = 'admin' THEN 0 ELSE 1 END, u.id
       LIMIT 1`
    );
    const user = userResult.rows[0];
    assert.ok(user, 'Se necesita una cuenta activa con permiso de regularización');

    const fixtureClient = await pool.connect();
    try {
      await fixtureClient.query('BEGIN');
      const uniqueToken = crypto.randomUUID();
      const ipe = `100${crypto.randomInt(100000, 999999)}`;
      const studentResult = await fixtureClient.query(
        `INSERT INTO alumno (
           uuid_erp, documento_erp, tipo_identificador, nombres, paterno,
           rol, codigo_barra, origen_alta, erp_vinculado_en
         ) VALUES (
           $1, $2, 'IPE_MINEDUC', 'Prueba API', 'Regularizacion',
           'Estudiante', $2, 'ERP', CURRENT_TIMESTAMP
         )
         RETURNING id_alumno`,
        [uniqueToken, ipe]
      );
      studentId = studentResult.rows[0].id_alumno;

      await syncStudentIdentifiers(fixtureClient, {
        studentId,
        identity: {
          identityType: 'IPE_MINEDUC',
          documentoErp: ipe,
          uuidErp: uniqueToken,
          validationLevel: 'FUENTE_MINEDUC_ERP'
        },
        barcode: ipe,
        source: 'ERP',
        userId: user.id
      });
      await fixtureClient.query('COMMIT');
    } catch (error) {
      await fixtureClient.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      fixtureClient.release();
    }

    let runBody;
    do {
      runBody = String(25000000 + crypto.randomInt(1000000, 9000000));
    } while ((await pool.query(
      `SELECT 1
       FROM alumno_identificador
       WHERE tipo = 'RUN_CHILE'
         AND valor_normalizado = $1
         AND estado <> 'REVOCADO'
       LIMIT 1`,
      [`${runBody}${calculateRutDv(runBody)}`]
    )).rowCount > 0);
    const runDv = calculateRutDv(runBody);

    const token = jwt.sign(
      {
        id: user.id,
        correo: user.correo,
        rol: user.rol,
        nombre: user.nombre,
        token_version: user.token_version
      },
      process.env.JWT_SECRET,
      { expiresIn: '5m' }
    );

    const pdf = Buffer.from('%PDF-1.4\n% prueba transitoria\n%%EOF\n').toString('base64');
    const response = await fetch(`${API_BASE_URL}/api/students/${studentId}/identifiers/ipe-to-run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `token=${token}`
      },
      body: JSON.stringify({
        run: runBody,
        dv: runDv,
        motivo: 'Regularización automatizada del contrato HTTP',
        tipo_respaldo: 'DOCUMENTO_MINEDUC',
        detalle_respaldo: 'Respaldo efímero para una prueba de integración',
        fileName: 'respaldo-prueba-api.pdf',
        fileData: `data:application/pdf;base64,${pdf}`
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 200, JSON.stringify(payload));

    const verification = await pool.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM alumno_identificador
           WHERE id_alumno = $1 AND tipo = 'IPE_MINEDUC'
             AND estado = 'ANTERIOR' AND es_principal = false
         ) AS ipe_anterior,
         EXISTS (
           SELECT 1 FROM alumno_identificador
           WHERE id_alumno = $1 AND tipo = 'RUN_CHILE'
             AND estado = 'PRINCIPAL' AND es_principal = true
         ) AS run_principal,
         EXISTS (
           SELECT 1 FROM regularizaciones_identidad_estudiante
           WHERE id_alumno = $1
         ) AS regularizacion,
         EXISTS (
           SELECT 1 FROM audit_log
           WHERE entidad = 'alumno' AND entidad_id = $1
             AND accion = 'REGULARIZAR_IPE_A_RUN'
         ) AS auditoria`,
      [studentId]
    );
    assert.deepEqual(verification.rows[0], {
      ipe_anterior: true,
      run_principal: true,
      regularizacion: true,
      auditoria: true
    });

    console.log(JSON.stringify({
      status: 'OK',
      http_status: response.status,
      permission_enforced: true,
      support_required: true,
      audit_recorded: true,
      temporary_fixture: true
    }));
  } finally {
    if (studentId) {
      const cleanupClient = await pool.connect();
      try {
        await cleanupClient.query('BEGIN');
        const documentResult = await cleanupClient.query(
          `SELECT d.id_documento, d.nombre_almacenado
           FROM regularizaciones_identidad_estudiante r
           JOIN justification_documents d ON d.id_documento = r.documento_id
           WHERE r.id_alumno = $1`,
          [studentId]
        );
        storedDocumentName = documentResult.rows[0]?.nombre_almacenado || null;
        const documentId = documentResult.rows[0]?.id_documento || null;

        await cleanupClient.query(
          `DELETE FROM audit_log
           WHERE entidad = 'alumno' AND entidad_id = $1`,
          [studentId]
        );
        await cleanupClient.query(
          'DELETE FROM regularizaciones_identidad_estudiante WHERE id_alumno = $1',
          [studentId]
        );
        await cleanupClient.query('DELETE FROM alumno WHERE id_alumno = $1', [studentId]);
        if (documentId) {
          await cleanupClient.query(
            'DELETE FROM justification_documents WHERE id_documento = $1',
            [documentId]
          );
        }
        await cleanupClient.query('COMMIT');
      } catch (error) {
        await cleanupClient.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        cleanupClient.release();
      }
    }
    if (storedDocumentName) await removeStoredFile(storedDocumentName);
    await pool.end();
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
