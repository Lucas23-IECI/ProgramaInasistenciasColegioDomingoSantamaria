const test = require('node:test');
const assert = require('node:assert/strict');
const { studentImportErrorMessage } = require('../utils/studentImportErrors');

test('la importación explica restricciones sin devolver SQL ni detalles internos', () => {
  assert.match(studentImportErrorMessage({ code: '23505', constraint: 'alumno_nombre_usuario_key' }), /Nombre Usuario/);
  assert.match(studentImportErrorMessage({ code: '23505' }), /identificador/);
  assert.match(studentImportErrorMessage({ code: '22001' }), /largo permitido/);
  assert.match(studentImportErrorMessage({ code: '23503' }), /referencia/);
  assert.doesNotMatch(studentImportErrorMessage(new Error('secret SQL SELECT')), /secret|SQL|SELECT/);
});
