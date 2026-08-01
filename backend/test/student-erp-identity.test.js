const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeStudentRut } = require('../utils/students');
const { normalizeErpStudentIdentity } = require('../utils/studentErpIdentity');

const normalize = (overrides = {}) => normalizeErpStudentIdentity({
  uuidErp: '3df76bdf-05a9-4bd1-bf47-0b074318a08b',
  rutInput: '',
  dvInput: '',
  normalizeRutAndDv: normalizeStudentRut,
  ...overrides
});

test('conserva un RUT chileno válido como identidad y código de barras', () => {
  const identity = normalize({ rutInput: '12.345.678-5' });
  assert.equal(identity.rut, '12345678');
  assert.equal(identity.dv, '5');
  assert.equal(identity.barcode, '123456785');
  assert.equal(identity.identityType, 'RUN_CHILE');
  assert.equal(identity.validationLevel, 'DV_VERIFICADO');
});

test('acepta el documento no chileno de la planilla oficial mediante UUID ERP', () => {
  const identity = normalize({ rutInput: '123456789-0' });
  assert.equal(identity.documentoErp, '123456789-0');
  assert.equal(identity.rut, null);
  assert.equal(identity.barcode, '1234567890');
  assert.equal(identity.canIdentify, true);
  assert.equal(identity.identityType, 'IPE_MINEDUC');
  assert.equal(identity.identityLabel, 'IPE Mineduc');
  assert.equal(identity.validationLevel, 'FUENTE_MINEDUC_ERP');
});

test('no trunca un documento ERP de nueve dígitos aunque coincida por casualidad', () => {
  const identity = normalize({ rutInput: '100721891-1' });
  assert.equal(identity.rut, null);
  assert.equal(identity.dv, null);
  assert.equal(identity.documentoErp, '100721891-1');
  assert.equal(identity.barcode, '1007218911');
  assert.equal(identity.acceptedByErpId, true);
  assert.equal(identity.identityType, 'IPE_MINEDUC');
});

test('acepta RUT vacío cuando existe el identificador obligatorio del ERP', () => {
  const identity = normalize({ rutInput: '' });
  assert.equal(identity.rut, null);
  assert.equal(identity.documentoErp, null);
  assert.equal(identity.barcode, identity.uuidErp);
  assert.equal(identity.canIdentify, true);
  assert.equal(identity.acceptedByErpId, true);
  assert.equal(identity.identityType, 'ID_ERP');
});

test('rechaza solamente una fila sin RUT válido y sin identificador ERP', () => {
  const identity = normalize({ uuidErp: '', rutInput: 'documento-inválido' });
  assert.equal(identity.canIdentify, false);
  assert.equal(identity.acceptedByErpId, false);
});

test('acepta un IPE de MINEDUC aun cuando no exista UUID ERP', () => {
  const identity = normalize({ uuidErp: '', rutInput: '100.721.891-1' });
  assert.equal(identity.canIdentify, true);
  assert.equal(identity.identityType, 'IPE_MINEDUC');
  assert.equal(identity.rut, null);
});

test('clasifica pasaporte y país emisor sin afirmar una validación universal', () => {
  const identity = normalize({
    uuidErp: '',
    rutInput: 'PA-1234567',
    documentTypeInput: 'Pasaporte',
    countryCodeInput: 'VEN'
  });
  assert.equal(identity.canIdentify, true);
  assert.equal(identity.identityType, 'DOCUMENTO_EXTRANJERO');
  assert.equal(identity.foreignDocumentType, 'PASAPORTE');
  assert.equal(identity.countryCode, 'VEN');
  assert.equal(identity.validationLevel, 'FORMATO_Y_ORIGEN_ERP');
});

test('no acepta un documento extranjero aislado sin tipo, país ni procedencia ERP', () => {
  const identity = normalize({
    uuidErp: '',
    rutInput: 'AB123456',
    documentTypeInput: '',
    countryCodeInput: ''
  });
  assert.equal(identity.identityType, 'DOCUMENTO_EXTRANJERO');
  assert.equal(identity.hasForeignDocument, true);
  assert.equal(identity.hasTrustedForeignDocumentContext, false);
  assert.equal(identity.canIdentify, false);
});
