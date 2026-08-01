const test = require('node:test');
const assert = require('node:assert/strict');

const {
  canUseRegistrationMethod,
  getRegistrationMethodPermission,
  normalizeRegistrationMethod
} = require('../utils/registrationMethods');

test('normaliza solicitudes antiguas sin romper pistola ni búsqueda manual', () => {
  assert.equal(normalizeRegistrationMethod(undefined, 'lector'), 'barcode');
  assert.equal(normalizeRegistrationMethod(undefined, 'manual'), 'manual');
  assert.equal(normalizeRegistrationMethod('camera', 'manual'), 'camera');
  assert.equal(normalizeRegistrationMethod('desconocido', 'lector'), 'barcode');
});

test('cada método exige su permiso específico', () => {
  assert.equal(getRegistrationMethodPermission('barcode'), 'punctuality.register.barcode');
  assert.equal(getRegistrationMethodPermission('camera'), 'punctuality.register.camera');
  assert.equal(getRegistrationMethodPermission('manual'), 'punctuality.register.manual');
  assert.equal(canUseRegistrationMethod({ permissions: ['punctuality.register.camera'] }, 'camera'), true);
  assert.equal(canUseRegistrationMethod({ permissions: ['punctuality.register.camera'] }, 'manual'), false);
});
