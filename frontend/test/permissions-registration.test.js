import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PERMISSIONS,
  hasRegistrationMethodPermission,
} from '../src/permissions.js';

test('mantiene compatibilidad con cuentas que solo poseen el permiso histórico', () => {
  const legacyUser = { permissions: [PERMISSIONS.PUNCTUALITY_REGISTER] };

  assert.equal(hasRegistrationMethodPermission(legacyUser, PERMISSIONS.PUNCTUALITY_REGISTER_BARCODE), true);
  assert.equal(hasRegistrationMethodPermission(legacyUser, PERMISSIONS.PUNCTUALITY_REGISTER_CAMERA), true);
  assert.equal(hasRegistrationMethodPermission(legacyUser, PERMISSIONS.PUNCTUALITY_REGISTER_MANUAL), true);
});

test('respeta la selección granular cuando existen permisos por método', () => {
  const cameraOnlyUser = {
    permissions: [
      PERMISSIONS.PUNCTUALITY_REGISTER,
      PERMISSIONS.PUNCTUALITY_REGISTER_CAMERA,
    ],
  };

  assert.equal(hasRegistrationMethodPermission(cameraOnlyUser, PERMISSIONS.PUNCTUALITY_REGISTER_CAMERA), true);
  assert.equal(hasRegistrationMethodPermission(cameraOnlyUser, PERMISSIONS.PUNCTUALITY_REGISTER_BARCODE), false);
  assert.equal(hasRegistrationMethodPermission(cameraOnlyUser, PERMISSIONS.PUNCTUALITY_REGISTER_MANUAL), false);
});
