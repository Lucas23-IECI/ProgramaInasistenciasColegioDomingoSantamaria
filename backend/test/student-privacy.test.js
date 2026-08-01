const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SENSITIVE_IDENTIFIER_PERMISSION,
  canRevealStudentIdentifiers,
  maskIdentifierValue,
  protectIdentityRegularization,
  protectStudentIdentifier,
  protectStudentRecord
} = require('../utils/studentPrivacy');

test('oculta RUN, IPE y pasaporte sin conservar el valor original', () => {
  assert.equal(maskIdentifierValue('RUN_CHILE', '123456785'), '12.345.***-*');
  assert.equal(maskIdentifierValue('IPE_MINEDUC', '100123456'), '100****56');
  assert.equal(maskIdentifierValue('PASAPORTE', 'AB123456'), 'AB****56');
});

test('protege los campos sensibles de una ficha por defecto', () => {
  const protectedStudent = protectStudentRecord({
    id_alumno: 9,
    nombres: 'Josefa',
    rut: '12345678',
    dv: '5',
    uuid_erp: 'UUID-PRIVADO',
    codigo_barra: '123456785'
  });

  assert.equal(protectedStudent.id_alumno, 9);
  assert.equal(protectedStudent.documento_mostrado, '12.345.***-*');
  assert.equal(protectedStudent.identificadores_protegidos, true);
  assert.equal('rut' in protectedStudent, false);
  assert.equal('uuid_erp' in protectedStudent, false);
  assert.equal('codigo_barra' in protectedStudent, false);
});

test('revela datos solo cuando la ruta ya comprobó el permiso específico', () => {
  const revealed = protectStudentRecord({ rut: '12345678', dv: '5' }, { reveal: true });
  assert.equal(revealed.rut, '12345678');
  assert.equal(revealed.documento_mostrado, '123456785');
  assert.equal(revealed.identificadores_protegidos, false);
  assert.equal(canRevealStudentIdentifiers({ permissions: [SENSITIVE_IDENTIFIER_PERMISSION] }), true);
  assert.equal(canRevealStudentIdentifiers({ permissions: ['students.view'] }), false);
});

test('protege identificadores adicionales e historial de regularización', () => {
  const identifier = protectStudentIdentifier({ tipo: 'PASAPORTE', valor_original: 'AB123456', valor_normalizado: 'AB123456' });
  assert.equal(identifier.valor_mostrado, 'AB****56');
  assert.equal('valor_original' in identifier, false);
  assert.equal('valor_normalizado' in identifier, false);

  const history = protectIdentityRegularization({ identificador_anterior: '100123456', identificador_nuevo: '123456785' });
  assert.equal('identificador_anterior' in history, false);
  assert.equal('identificador_nuevo' in history, false);
});
