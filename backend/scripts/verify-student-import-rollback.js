const { randomUUID } = require('node:crypto');
const pool = require('../db');
const {
  previewStudentImportRollback,
  rollbackStudentImport
} = require('../services/studentImportRollbackService');

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const run = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const user = await client.query(
      'SELECT id, correo FROM usuarios WHERE eliminado_en IS NULL ORDER BY id LIMIT 1'
    );
    assert(user.rowCount === 1, 'No existe una cuenta habilitada para ejecutar la prueba.');

    const token = randomUUID();
    const student = await client.query(
      `INSERT INTO alumno (uuid_erp, nombres, paterno, rol, origen_alta, erp_vinculado_en)
       VALUES ($1, 'Verificación', 'Reversión aislada', 'Estudiante', 'ERP', CURRENT_TIMESTAMP)
       RETURNING id_alumno, nombres, paterno, rol, origen_alta, activo`,
      [`qa-rollback-${token}`]
    );
    const studentRow = student.rows[0];
    const imported = await client.query(
      `INSERT INTO importaciones_estudiantes
       (nombre_archivo, hash_archivo, modo, estado, total_filas, filas_creadas,
        importado_por, version_reversion)
       VALUES ('qa-reversion-aislada.xlsx', $1, 'PARCIAL', 'COMPLETADA', 1, 1, $2, 1)
       RETURNING id`,
      [token.replaceAll('-', '').padEnd(64, '0').slice(0, 64), user.rows[0].id]
    );
    const importId = imported.rows[0].id;
    const before = {
      reversion: { student: null, enrollment: null, identifiers: [], excel_snapshot: null }
    };
    const after = {
      reversion: {
        student: {
          nombres: studentRow.nombres,
          paterno: studentRow.paterno,
          rol: studentRow.rol,
          origen_alta: studentRow.origen_alta,
          activo: studentRow.activo
        },
        enrollment: null,
        identifiers: [],
        excel_snapshot: null
      }
    };
    await client.query(
      `INSERT INTO importacion_estudiante_cambios
       (importacion_id, numero_fila, id_alumno, accion, anterior, posterior, mensaje)
       VALUES ($1, 2, $2, 'CREADO', $3::jsonb, $4::jsonb, 'Prueba transaccional aislada')`,
      [importId, studentRow.id_alumno, JSON.stringify(before), JSON.stringify(after)]
    );

    const preview = await previewStudentImportRollback(client, importId);
    assert(
      preview.can_revert,
      `La previsualización no autorizó una reversión nueva y aislada: ${JSON.stringify({
        summary: preview.summary,
        global_reasons: preview.global_reasons,
        rows: preview.rows
      })}`
    );
    assert(preview.summary.reversible === 1, 'La previsualización no informó la única fila reversible.');

    const result = await rollbackStudentImport(client, importId, {
      userId: user.rows[0].id,
      userEmail: user.rows[0].correo,
      reason: 'Prueba automatizada dentro de una transacción descartable',
      ip: '127.0.0.1',
      insertarAudit: async () => {}
    });
    assert(result.summary?.revertidos === 1, 'La reversión no compensó la fila creada.');

    const verification = await client.query(
      `SELECT i.estado, a.activo,
              (SELECT COUNT(*)::int FROM importacion_estudiante_reversiones r
               WHERE r.importacion_id = i.id AND r.resultado = 'REVERTIDO') AS trazas
       FROM importaciones_estudiantes i
       JOIN importacion_estudiante_cambios c ON c.importacion_id = i.id
       JOIN alumno a ON a.id_alumno = c.id_alumno
       WHERE i.id = $1`,
      [importId]
    );
    const checked = verification.rows[0];
    assert(checked?.estado === 'REVERTIDA', 'La importación no quedó marcada como revertida.');
    assert(checked?.activo === false, 'La ficha creada no quedó desactivada de forma compensatoria.');
    assert(checked?.trazas === 1, 'La reversión no dejó su traza interna.');

    console.log(JSON.stringify({
      preview: preview.summary,
      rollback: result.summary,
      state: checked.estado,
      student_active: checked.activo,
      trace_rows: checked.trazas,
      transaction: 'ROLLBACK'
    }));
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
};

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
