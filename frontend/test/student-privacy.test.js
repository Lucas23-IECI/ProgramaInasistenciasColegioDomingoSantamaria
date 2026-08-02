import test from 'node:test';
import assert from 'node:assert/strict';

import { getStudentIdentifier, getStudentMaskedRut } from '../src/utils/studentFormat.js';

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
