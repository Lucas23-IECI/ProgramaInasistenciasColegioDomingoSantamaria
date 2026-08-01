const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compareStudentFields,
  detectIdentifierCollision,
  validateImportMode
} = require('../utils/studentImportGovernance');

test('la comparación conserva vacíos del ERP y muestra actualizaciones compatibles', () => {
  const result = compareStudentFields(
    { nombres: 'Ana', email: 'nuevo@correo.cl', telefono: '', grade: '2° Medio' },
    { nombres: 'Ana', email: 'anterior@correo.cl', telefono: '+56911112222', grade: '1° Medio' }
  );
  assert.equal(result.find((field) => field.field === 'nombres').decision, 'SIN_CAMBIOS');
  assert.equal(result.find((field) => field.field === 'email').decision, 'ACTUALIZAR_DESDE_ERP');
  assert.equal(result.find((field) => field.field === 'telefono').decision, 'CONSERVAR_ACTUAL');
  assert.equal(result.find((field) => field.field === 'grade').decision, 'ACTUALIZAR_DESDE_ERP');
});

test('la comparación exige revisar cambios de identidad', () => {
  const result = compareStudentFields(
    { nombres: 'María José', paterno: 'Pérez', fecha_nacimiento: '2012-03-05' },
    { nombres: 'María', paterno: 'Pérez', fecha_nacimiento: '2012-03-05' }
  );
  const name = result.find((field) => field.field === 'nombres');
  assert.equal(name.decision, 'REVISAR_CONFLICTO');
  assert.equal(name.blocking, true);
});

test('una colisión entre identificadores de fichas diferentes es bloqueante', () => {
  const collision = detectIdentifierCollision({
    rutMatch: { id_alumno: 11 },
    uuidMatch: { id_alumno: 22 },
    documentMatch: { id_alumno: 11 }
  });
  assert.equal(collision.code, 'COLISION_IDENTIFICADORES');
  assert.equal(collision.blocking, true);
  assert.equal(detectIdentifierCollision({
    rutMatch: { id_alumno: 11 },
    uuidMatch: { id_alumno: 11 },
    documentMatch: { id_alumno: 11 }
  }), null);
});

test('los identificadores históricos también participan en el bloqueo de colisiones', () => {
  const collision = detectIdentifierCollision({
    rutMatch: { id_alumno: 11 },
    uuidMatch: null,
    documentMatch: null,
    identifierMatches: [
      { id_alumno: 11 },
      { id_alumno: 22 }
    ]
  });
  assert.equal(collision.code, 'COLISION_IDENTIFICADORES');
  assert.equal(collision.blocking, true);
  assert.equal(detectIdentifierCollision({
    rutMatch: { id_alumno: 11 },
    identifierMatches: [
      { id_alumno: 11 },
      { id_alumno: 11 }
    ]
  }), null);
});

test('el modo de importación usa parcial como opción segura por defecto', () => {
  assert.equal(validateImportMode('COMPLETA'), 'COMPLETA');
  assert.equal(validateImportMode('completa'), 'COMPLETA');
  assert.equal(validateImportMode('cualquier-cosa'), 'PARCIAL');
  assert.equal(validateImportMode(undefined), 'PARCIAL');
});
