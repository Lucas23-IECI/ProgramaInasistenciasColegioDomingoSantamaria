const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MANUAL_IDENTITY_TYPES,
  calculateRutDv,
  normalizeManualStudentIdentity,
  normalizeStudentPayload,
  normalizeStudentRut,
  validateManualStudentIdentity,
  validateStudentPayload,
  validateStudentRut
} = require('../utils/students');

test('normaliza RUT escrito con o sin formato', () => {
  assert.deepEqual(normalizeStudentRut('12.345.678-5'), { rut: '12345678', dv: '5' });
  assert.deepEqual(normalizeStudentRut('12345678', '5'), { rut: '12345678', dv: '5' });
});

test('calcula y valida el dígito verificador chileno', () => {
  assert.equal(calculateRutDv('12345678'), '5');
  assert.equal(validateStudentRut('12.345.678-5'), true);
  assert.equal(validateStudentRut('12.345.678-9'), false);
});

test('normaliza datos manuales sin aceptar espacios o largos arbitrarios', () => {
  const student = normalizeStudentPayload({
    rut: '12.345.678-5',
    nombres: '  Ana   María ',
    paterno: ' Pérez ',
    email: ' ANA@EJEMPLO.CL ',
    grade: ' 1° Básico '
  });
  assert.equal(student.nombres, 'Ana María');
  assert.equal(student.email, 'ana@ejemplo.cl');
  assert.equal(student.grade, '1° Básico');
});

test('exige identidad, curso y contacto válidos', () => {
  const invalid = normalizeStudentPayload({
    rut: '12.345.678-9',
    nombres: '',
    paterno: '',
    email: 'correo-mal',
    telefono: '123',
    grade: ''
  });
  assert.deepEqual(validateStudentPayload(invalid), [
    'El RUT chileno no es válido.',
    'Los nombres son obligatorios.',
    'El apellido paterno es obligatorio.',
    'Debe seleccionar un curso existente.',
    'El correo electrónico no es válido.',
    'El teléfono no es válido.'
  ]);
});

test('normaliza altas manuales con RUN, IPE y documento extranjero', () => {
  const run = normalizeManualStudentIdentity({
    tipo_identificador: 'RUN_CHILE',
    documento: '12.345.678-5'
  });
  const ipe = normalizeManualStudentIdentity({
    tipo_identificador: 'IPE_MINEDUC',
    documento: '100.721.891-1'
  });
  const passport = normalizeManualStudentIdentity({
    tipo_identificador: 'PASAPORTE',
    documento: ' pa-123 456 ',
    pais_emisor: 'ven'
  });

  assert.equal(run.documentNormalized, '123456785');
  assert.equal(ipe.documentNormalized, '1007218911');
  assert.equal(ipe.countryCode, 'CHL');
  assert.equal(passport.documentOriginal, 'PA-123456');
  assert.equal(passport.documentNormalized, 'PA123456');
  assert.equal(passport.countryCode, 'VEN');
});

test('valida cada identidad manual sin aplicar módulo 11 a extranjeros', () => {
  const foreign = normalizeManualStudentIdentity({
    tipo_identificador: 'DNI',
    documento: '12345678',
    pais_emisor: 'PER'
  });
  const missingCountry = normalizeManualStudentIdentity({
    tipo_identificador: 'PASAPORTE',
    documento: 'AB123456'
  });
  const undocumented = normalizeManualStudentIdentity({
    tipo_identificador: MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO
  });

  assert.deepEqual(validateManualStudentIdentity(foreign), []);
  assert.deepEqual(validateManualStudentIdentity(missingCountry), [
    'Seleccione el país emisor del documento extranjero.'
  ]);
  assert.deepEqual(validateManualStudentIdentity(undocumented, { manualDetail: 'sin respaldo' }), []);
  assert.deepEqual(validateManualStudentIdentity(undocumented, { manualDetail: 'breve' }), [
    'Explique en al menos 10 caracteres por qué el estudiante no dispone de documento.'
  ]);
});
