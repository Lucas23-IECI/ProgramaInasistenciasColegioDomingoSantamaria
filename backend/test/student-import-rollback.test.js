const test = require('node:test');
const assert = require('node:assert/strict');

const {
  previewStudentImportRollback
} = require('../services/studentImportRollbackService');
const {
  buildGuardianImportTemplate,
  buildStudentImportTemplate
} = require('../services/studentExportService');

const rollbackFixture = ({
  version = 1,
  state = 'COMPLETADA',
  action = 'CREADO',
  later = [],
  downstream = [],
  currentSnapshot = { curso: '1A', datos: { a: 1, b: 2 } },
  expectedSnapshot = { datos: { b: 2, a: 1 }, curso: '1A' }
} = {}) => {
  const afterStudent = {
    uuid_erp: 'erp-100',
    rut: '11111111',
    dv: '1',
    nombres: 'Estudiante',
    paterno: 'Prueba',
    rol: 'Estudiante',
    origen_alta: 'ERP',
    activo: true
  };
  const responses = {
    record: { rows: [{ id: 9, version_reversion: version, estado: state, importado_en: '2026-08-30T10:00:00.000Z' }], rowCount: 1 },
    changes: { rows: [{
      id: 91,
      importacion_id: 9,
      id_alumno: 101,
      accion: action,
      anterior: { reversion: { student: null, enrollment: null, excel_snapshot: null, identifiers: [] } },
      posterior: { reversion: { student: afterStudent, enrollment: { id_curso: 3 }, excel_snapshot: expectedSnapshot, identifiers: [] } }
    }] },
    students: { rows: [{ id_alumno: 101, ...afterStudent, id_curso: 3, excel_snapshot: currentSnapshot }] },
    identifiers: { rows: [] },
    later: { rows: later.map((id_alumno) => ({ id_alumno })) },
    downstream: { rows: downstream.map((id_alumno) => ({ id_alumno })) }
  };
  return {
    async query(sql, params = []) {
      if (sql.includes('FROM importaciones_estudiantes i') && sql.includes('WHERE i.id')) return responses.record;
      if (sql.includes('FROM importacion_estudiante_cambios c') && !sql.includes('JOIN importaciones_estudiantes')) return responses.changes;
      if (sql.includes('FROM alumno a')) return responses.students;
      if (sql.includes('FROM alumno_identificador')) return responses.identifiers;
      if (sql.includes('JOIN importaciones_estudiantes i')) {
        assert.equal(params[2], 9, 'la consulta debe excluir la propia importación');
        return responses.later;
      }
      if (sql.includes('FROM (')) return responses.downstream;
      throw new Error(`Consulta no contemplada: ${sql}`);
    }
  };
};

test('la reversión reconoce un punto seguro aunque el JSON tenga distinto orden de claves', async () => {
  const preview = await previewStudentImportRollback(rollbackFixture(), 9);
  assert.equal(preview.found, true);
  assert.equal(preview.can_revert, true);
  assert.deepEqual(preview.summary, { reversible: 1, bloqueado: 0, omitido: 0 });
});

test('una importación anterior al formato seguro nunca se revierte automáticamente', async () => {
  const preview = await previewStudentImportRollback(rollbackFixture({ version: 0 }), 9);
  assert.equal(preview.can_revert, false);
  assert.match(preview.global_reasons.join(' '), /punto de restauración verificable/i);
});

test('la actividad institucional posterior bloquea desactivar una ficha creada', async () => {
  const preview = await previewStudentImportRollback(rollbackFixture({ downstream: [101] }), 9);
  assert.equal(preview.can_revert, false);
  assert.equal(preview.summary.bloqueado, 1);
  assert.match(preview.rows[0].reasons.join(' '), /actividad institucional asociada/i);
});

test('una importación posterior sobre la misma ficha bloquea la compensación', async () => {
  const preview = await previewStudentImportRollback(rollbackFixture({ later: [101] }), 9);
  assert.equal(preview.can_revert, false);
  assert.match(preview.rows[0].reasons.join(' '), /importación posterior/i);
});

test('las plantillas vacías se generan como libros Excel sin datos personales', async () => {
  const [students, guardians] = await Promise.all([
    buildStudentImportTemplate(),
    buildGuardianImportTemplate()
  ]);
  for (const workbook of [students, guardians]) {
    assert.ok(Buffer.isBuffer(workbook));
    assert.ok(workbook.length > 3000);
    assert.equal(workbook.subarray(0, 2).toString(), 'PK');
  }
});
