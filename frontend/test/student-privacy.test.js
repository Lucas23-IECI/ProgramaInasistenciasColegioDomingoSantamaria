import test from 'node:test';
import assert from 'node:assert/strict';

import { getStudentIdentifier, getStudentMaskedRut } from '../src/utils/studentFormat.js';
import { matchesStudentSearch } from '../src/features/students/studentSearch.js';

test('la interfaz muestra el identificador completo entregado por el backend', () => {
  const student = {
    documento_mostrado: '12.345.678-5',
    rut: '12345678',
    dv: '5'
  };
  assert.equal(getStudentIdentifier(student), '12.345.678-5');
  assert.equal(getStudentMaskedRut(student), '12.345.678-5');
});

test('la interfaz conserva completos identificadores alternativos', () => {
  assert.equal(getStudentMaskedRut({ documento_erp: '650F-5648' }), '650F-5648');
  assert.equal(getStudentMaskedRut({ codigo_barra: 'ABC570K' }), 'ABC570K');
});

test('la búsqueda de estudiantes considera el nombre completo y formatos de identificador', () => {
  const student = {
    nombres: 'Fernanda María',
    paterno: 'QA',
    materno: 'Histórica',
    documento_mostrado: '12.345.678-5',
    nombre_usuario: 'fernanda.qa'
  };

  assert.equal(matchesStudentSearch(student, 'Fernanda QA Historica'), true);
  assert.equal(matchesStudentSearch(student, 'histórica fernanda'), true);
  assert.equal(matchesStudentSearch(student, '123456785'), true);
  assert.equal(matchesStudentSearch(student, 'fernanda.qa'), true);
  assert.equal(matchesStudentSearch(student, 'otra persona'), false);
});
