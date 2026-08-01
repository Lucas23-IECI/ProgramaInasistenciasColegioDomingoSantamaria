import test from 'node:test';
import assert from 'node:assert/strict';

import { getStudentIdentifier, getStudentMaskedRut } from '../src/utils/studentFormat.js';

test('la interfaz prioriza el identificador protegido entregado por el backend', () => {
  const student = {
    documento_mostrado: '12.345.***-*',
    rut: '12345678',
    dv: '5'
  };
  assert.equal(getStudentIdentifier(student), '12.345.***-*');
  assert.equal(getStudentMaskedRut(student), '12.345.***-*');
});
