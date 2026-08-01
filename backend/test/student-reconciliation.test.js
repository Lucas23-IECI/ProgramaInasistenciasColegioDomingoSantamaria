const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateStudentReconciliation,
  normalizeIdentityToken
} = require('../utils/studentReconciliation');

test('normaliza tildes, mayúsculas y puntuación para comparar identidades', () => {
  assert.equal(normalizeIdentityToken('  María-José Pérez '), 'maria jose perez');
});

test('identifica un alta manual pendiente de vincular con ERP', () => {
  const result = evaluateStudentReconciliation(
    { nombres: 'María José', apellidos: 'Pérez Soto' },
    {
      nombres: 'Maria Jose',
      paterno: 'Perez',
      origen_alta: 'MANUAL',
      erp_vinculado_en: null
    }
  );
  assert.equal(result.code, 'VINCULAR_MANUAL');
  assert.equal(result.blocking, false);
});

test('bloquea una coincidencia de RUT con nombre y apellido incompatibles', () => {
  const result = evaluateStudentReconciliation(
    { nombres: 'Carlos', apellidos: 'González' },
    {
      nombres: 'Josefa',
      paterno: 'Alarcón',
      origen_alta: 'MANUAL',
      erp_vinculado_en: null
    }
  );
  assert.equal(result.code, 'CONFLICTO_IDENTIDAD');
  assert.equal(result.blocking, true);
  assert.deepEqual(result.differences, ['primer nombre', 'apellido paterno']);
});

test('no bloquea una diferencia aislada y conserva la trazabilidad manual', () => {
  const result = evaluateStudentReconciliation(
    { nombres: 'Josefa Isidora', apellidos: 'Alarcón Coronado' },
    {
      nombres: 'Josefa',
      paterno: 'Alarcon',
      origen_alta: 'MANUAL',
      erp_vinculado_en: '2026-07-28T12:00:00.000Z'
    }
  );
  assert.equal(result.code, 'ACTUALIZAR_VINCULADO');
  assert.equal(result.blocking, false);
});
