const test = require('node:test');
const assert = require('node:assert/strict');

const {
  maskIdentifierValue,
  protectIdentityRegularization,
  protectStudentIdentifier,
  protectStudentRecord
} = require('../utils/studentPrivacy');

test('muestra completos RUN, IPE, pasaporte e identificadores internos', () => {
  assert.equal(maskIdentifierValue('RUN_CHILE', '123456785'), '12.345.678-5');
  assert.equal(maskIdentifierValue('IPE_MINEDUC', '100123456'), '100123456');
  assert.equal(maskIdentifierValue('PASAPORTE', 'AB123456'), 'AB123456');
  assert.equal(maskIdentifierValue('ID_ERP', '650F-5648'), '650F-5648');
  assert.equal(maskIdentifierValue('CODIGO_BARRAS', 'ABC570K'), 'ABC570K');
});

test('conserva los identificadores originales de la ficha estudiantil', () => {
  const student = protectStudentRecord({
    id_alumno: 9,
    nombres: 'Josefa',
    rut: '12345678',
    dv: '5',
    uuid_erp: 'UUID-COMPLETO',
    codigo_barra: '123456785'
  });

  assert.equal(student.documento_mostrado, '12.345.678-5');
  assert.equal(student.identificadores_protegidos, false);
  assert.equal(student.rut, '12345678');
  assert.equal(student.uuid_erp, 'UUID-COMPLETO');
  assert.equal(student.codigo_barra, '123456785');
});

test('mantiene completos identificadores adicionales e historial de regularización', () => {
  const identifier = protectStudentIdentifier({
    tipo: 'PASAPORTE',
    valor_original: 'AB123456',
    valor_normalizado: 'AB123456'
  });
  assert.equal(identifier.valor_mostrado, 'AB123456');
  assert.equal(identifier.valor_original, 'AB123456');
  assert.equal(identifier.protegido, false);

  const history = protectIdentityRegularization({
    identificador_anterior: '100123456',
    identificador_nuevo: '123456785'
  });
  assert.equal(history.identificador_anterior_mostrado, '100123456');
  assert.equal(history.identificador_nuevo_mostrado, '12.345.678-5');
  assert.equal(history.identificador_anterior, '100123456');
});
