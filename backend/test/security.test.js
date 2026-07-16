const test = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeSnapshotRow,
  validatePassword,
  validateSystemRole
} = require('../utils/security');

test('el snapshot elimina cualquier encabezado de contraseña conocido', () => {
  const sanitized = sanitizeSnapshotRow({
    RUT: '11111111-1',
    Contraseña: 'secreto',
    PASSWORD: 'otro',
    Clave: 'tercero',
    Nombres: 'Persona Ficticia'
  });

  assert.deepEqual(sanitized, {
    RUT: '11111111-1',
    Nombres: 'Persona Ficticia'
  });
});

test('la política de contraseñas exige longitud y composición', () => {
  assert.match(validatePassword('corta'), /12 caracteres/);
  assert.match(validatePassword('solominusculaslargas'), /mayúsculas/);
  assert.equal(validatePassword('ClaveSegura2026!'), null);
});

test('solo se aceptan roles del sistema', () => {
  assert.equal(validateSystemRole('admin'), true);
  assert.equal(validateSystemRole('secretaria'), true);
  assert.equal(validateSystemRole('lector'), true);
  assert.equal(validateSystemRole('director'), false);
});

