const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IDENTIFIER_TYPES,
  buildStudentIdentifierCandidates,
  foreignTypeToIdentifierType,
  normalizeIdentifierValue,
  shouldPreserveRegularizedRun
} = require('../services/studentIdentifierService');

test('normaliza documentos sin perder letras ni dígitos', () => {
  assert.equal(normalizeIdentifierValue(' 12.345.678-k '), '12345678K');
  assert.equal(normalizeIdentifierValue('AB-123 456'), 'AB123456');
  assert.equal(normalizeIdentifierValue(null), '');
});

test('un RUN conserva simultáneamente el UUID ERP y el código operativo', () => {
  const candidates = buildStudentIdentifierCandidates({
    identity: {
      identityType: 'RUN_CHILE',
      rut: '12345678',
      dv: '5',
      uuidErp: 'erp-0001',
      validationLevel: 'DV_VERIFICADO'
    },
    barcode: '123456785',
    source: 'ERP'
  });

  assert.deepEqual(
    candidates.map((candidate) => [candidate.type, candidate.principal]),
    [
      [IDENTIFIER_TYPES.RUN_CHILE, true],
      [IDENTIFIER_TYPES.ID_ERP, false],
      [IDENTIFIER_TYPES.CODIGO_BARRAS, false]
    ]
  );
  assert.equal(candidates[0].countryCode, 'CHL');
  assert.equal(candidates[0].normalizedValue, '123456785');
});

test('un IPE se registra como identidad escolar y no como RUN chileno', () => {
  const candidates = buildStudentIdentifierCandidates({
    identity: {
      identityType: 'IPE_MINEDUC',
      documentoErp: '100.721.891-1',
      uuidErp: 'erp-0002'
    },
    source: 'ERP'
  });

  assert.equal(candidates[0].type, IDENTIFIER_TYPES.IPE_MINEDUC);
  assert.equal(candidates[0].principal, true);
  assert.equal(candidates[0].normalizedValue, '1007218911');
  assert.equal(candidates[1].type, IDENTIFIER_TYPES.ID_ERP);
});

test('un documento extranjero conserva tipo y país emisor sin validarlo como RUN', () => {
  const candidates = buildStudentIdentifierCandidates({
    identity: {
      identityType: 'DOCUMENTO_EXTRANJERO',
      documentoErp: 'PA-1234567',
      foreignDocumentType: 'PASAPORTE',
      countryCode: 'VEN'
    },
    source: 'ERP'
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].type, IDENTIFIER_TYPES.PASAPORTE);
  assert.equal(candidates[0].countryCode, 'VEN');
  assert.equal(candidates[0].validationLevel, 'FORMATO_Y_ORIGEN_ERP');
});

test('el UUID ERP pasa a ser principal solo cuando no existe documento', () => {
  const candidates = buildStudentIdentifierCandidates({
    identity: {
      identityType: 'ID_ERP',
      uuidErp: '3df76bdf-05a9-4bd1-bf47-0b074318a08b'
    },
    source: 'ERP'
  });

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].type, IDENTIFIER_TYPES.ID_ERP);
  assert.equal(candidates[0].principal, true);
});

test('una alta sin documento recibe identidad interna y código operativo separados', () => {
  const candidates = buildStudentIdentifierCandidates({
    identity: {
      identityType: IDENTIFIER_TYPES.CODIGO_INTERNO,
      internalCode: 'LDSM-00001234',
      validationLevel: 'SIN_DOCUMENTO_CIVIL'
    },
    barcode: 'LDSM-00001234',
    source: 'MANUAL'
  });

  assert.deepEqual(
    candidates.map((candidate) => [candidate.type, candidate.principal]),
    [
      [IDENTIFIER_TYPES.CODIGO_INTERNO, true],
      [IDENTIFIER_TYPES.CODIGO_BARRAS, false]
    ]
  );
  assert.equal(candidates[0].source, 'MANUAL');
});

test('traduce tipos extranjeros conocidos y conserva un tipo genérico seguro', () => {
  assert.equal(foreignTypeToIdentifierType('pasaporte'), IDENTIFIER_TYPES.PASAPORTE);
  assert.equal(foreignTypeToIdentifierType('dni'), IDENTIFIER_TYPES.DNI);
  assert.equal(foreignTypeToIdentifierType('cedula'), IDENTIFIER_TYPES.CEDULA);
  assert.equal(
    foreignTypeToIdentifierType('documento local'),
    IDENTIFIER_TYPES.DOCUMENTO_EXTRANJERO
  );
});

test('una importacion con el IPE anterior no reemplaza un RUN ya regularizado', () => {
  assert.equal(shouldPreserveRegularizedRun('RUN_CHILE', 'IPE_MINEDUC'), true);
  assert.equal(shouldPreserveRegularizedRun('RUN_CHILE', 'ID_ERP'), true);
  assert.equal(shouldPreserveRegularizedRun('IPE_MINEDUC', 'RUN_CHILE'), false);
  assert.equal(shouldPreserveRegularizedRun('RUN_CHILE', 'RUN_CHILE'), false);
});
