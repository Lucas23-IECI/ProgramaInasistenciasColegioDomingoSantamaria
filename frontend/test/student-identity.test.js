import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MANUAL_IDENTITY_TYPES,
  formatManualIdentityDocument,
  resolveManualIdentityCountry,
  validateManualIdentityForm,
} from '../src/utils/studentIdentity.js';

test('el alta manual formatea RUN y conserva documentos extranjeros', () => {
  assert.equal(
    formatManualIdentityDocument(MANUAL_IDENTITY_TYPES.RUN_CHILE, '123456785'),
    '12.345.678-5'
  );
  assert.equal(
    formatManualIdentityDocument(MANUAL_IDENTITY_TYPES.PASAPORTE, ' ab 123-45 '),
    'AB123-45'
  );
});

test('el formulario exige país solo para documentos extranjeros', () => {
  assert.equal(validateManualIdentityForm({
    tipo_identificador: MANUAL_IDENTITY_TYPES.IPE_MINEDUC,
    documento: '1007218911',
    pais_emisor: '',
  }), '');
  assert.equal(validateManualIdentityForm({
    tipo_identificador: MANUAL_IDENTITY_TYPES.PASAPORTE,
    documento: 'AB123456',
    pais_emisor: '',
  }), 'Seleccione el país emisor del documento.');
  assert.equal(validateManualIdentityForm({
    tipo_identificador: MANUAL_IDENTITY_TYPES.DNI,
    documento: '12345678',
    pais_emisor: 'PER',
  }), '');
});

test('admite un país no listado mediante su código ISO alfa-3', () => {
  const form = {
    tipo_identificador: MANUAL_IDENTITY_TYPES.PASAPORTE,
    documento: 'C01X23456',
    pais_emisor: 'OTRO',
    pais_emisor_otro: 'deu',
  };

  assert.equal(validateManualIdentityForm(form), '');
  assert.equal(resolveManualIdentityCountry(form), 'DEU');
});
