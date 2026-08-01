const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VALIDATION_RESULTS,
  createDefaultIdentityValidatorRegistry,
  createIdentityValidatorRegistry,
  validateIdentityDocument
} = require('../utils/identityValidatorRegistry');

test('valida el RUN chileno con un validador versionado de módulo 11', () => {
  const result = validateIdentityDocument({
    identityType: 'RUN_CHILE',
    countryCode: 'CHL',
    documentOriginal: '12.345.678-5'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.result, VALIDATION_RESULTS.VERIFIED);
  assert.equal(result.validatorId, 'cl.run.modulo11');
  assert.equal(result.validatorVersion, '1.0.0');
  assert.equal(result.normalizedDocument, '123456785');
});

test('rechaza un RUN inválido sin tratarlo como documento extranjero', () => {
  const result = validateIdentityDocument({
    identityType: 'RUN_CHILE',
    countryCode: 'CHL',
    documentOriginal: '12.345.678-9'
  });

  assert.equal(result.accepted, false);
  assert.equal(result.result, VALIDATION_RESULTS.REJECTED);
  assert.deepEqual(result.errors, ['El RUN chileno no es válido.']);
});

test('valida solo la estructura del IPE y conserva la advertencia institucional', () => {
  const result = validateIdentityDocument({
    identityType: 'IPE_MINEDUC',
    countryCode: 'CHL',
    documentOriginal: '100.721.891-1'
  });

  assert.equal(result.accepted, true);
  assert.equal(result.result, VALIDATION_RESULTS.STRUCTURAL);
  assert.equal(result.validatorId, 'cl.mineduc.ipe.estructura');
  assert.equal(result.warnings.length, 1);
});

test('los documentos extranjeros exigen país pero no reciben una validez universal', () => {
  const valid = validateIdentityDocument({
    identityType: 'PASAPORTE',
    countryCode: 'VEN',
    documentOriginal: 'PA-1234567'
  });
  const missingCountry = validateIdentityDocument({
    identityType: 'PASAPORTE',
    documentOriginal: 'PA-1234567'
  });

  assert.equal(valid.accepted, true);
  assert.equal(valid.result, VALIDATION_RESULTS.STRUCTURAL);
  assert.equal(valid.validatorId, 'global.documento.estructural');
  assert.match(valid.warnings[0], /no acredita la autenticidad/i);
  assert.equal(missingCountry.accepted, false);
});

test('un validador específico por país tiene precedencia sobre el fallback estructural', () => {
  const registry = createDefaultIdentityValidatorRegistry();
  registry.register({
    id: 'pe.dni.prueba-extension',
    version: '0.0.1-test',
    identityTypes: ['DNI'],
    countries: ['PER'],
    validate: ({ normalizedDocument }) => ({
      accepted: /^\d{8}$/.test(normalizedDocument),
      result: VALIDATION_RESULTS.VERIFIED,
      validationLevel: 'REGLA_PAIS_PRUEBA',
      errors: []
    })
  });

  const result = registry.validate({
    identityType: 'DNI',
    countryCode: 'PER',
    documentOriginal: '12345678'
  });

  assert.equal(result.validatorId, 'pe.dni.prueba-extension');
  assert.equal(result.validationLevel, 'REGLA_PAIS_PRUEBA');
});

test('el registro impide sobreescribir silenciosamente un validador existente', () => {
  const registry = createIdentityValidatorRegistry();
  const definition = {
    id: 'ejemplo.documento',
    version: '1.0.0',
    identityTypes: ['DNI'],
    countries: ['PER'],
    validate: () => ({ accepted: true })
  };
  registry.register(definition);

  assert.throws(() => registry.register(definition), /ya se encuentra registrado/i);
});
