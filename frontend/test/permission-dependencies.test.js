import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODULE_ACCESS_PERMISSIONS,
  PERMISSIONS,
  expandPermissionDependencies,
  removePermissionWithDependents,
} from '../src/permissions.js';

test('agregar una acción incorpora el acceso necesario al módulo', () => {
  assert.deepEqual(
    expandPermissionDependencies([PERMISSIONS.RESOURCES_MANAGE]),
    [PERMISSIONS.RESOURCES_MANAGE, PERMISSIONS.RESOURCES_VIEW],
  );
  assert.deepEqual(
    expandPermissionDependencies([PERMISSIONS.ANALYTICS_SCHEDULES_MANAGE]),
    [PERMISSIONS.ANALYTICS_INSTITUTIONAL_VIEW, PERMISSIONS.ANALYTICS_SCHEDULES_MANAGE],
  );
  assert.deepEqual(
    expandPermissionDependencies([PERMISSIONS.PUNCTUALITY_REGISTER_CAMERA]),
    [PERMISSIONS.PUNCTUALITY_REGISTER, PERMISSIONS.PUNCTUALITY_REGISTER_CAMERA],
  );
});

test('retirar el acceso base retira también las acciones que dependen de él', () => {
  const current = [
    PERMISSIONS.DOCUMENTS_VIEW,
    PERMISSIONS.DOCUMENTS_UPLOAD,
    PERMISSIONS.DOCUMENTS_SIGN,
    PERMISSIONS.AUDIT_VIEW,
  ];
  assert.deepEqual(
    removePermissionWithDependents(current, PERMISSIONS.DOCUMENTS_VIEW),
    [PERMISSIONS.AUDIT_VIEW],
  );
});

test('los módulos configurables reúnen lectura y acciones sin duplicados', () => {
  for (const permissions of Object.values(MODULE_ACCESS_PERMISSIONS)) {
    assert.equal(permissions.length, new Set(permissions).size);
  }
  assert.ok(MODULE_ACCESS_PERMISSIONS.analytics.includes(PERMISSIONS.ANALYTICS_INSTITUTIONAL_VIEW));
  assert.ok(MODULE_ACCESS_PERMISSIONS.visits.includes(PERMISSIONS.VISITS_EMERGENCY_MANAGE));
  assert.ok(MODULE_ACCESS_PERMISSIONS.punctualitySettings.includes(PERMISSIONS.PUNCTUALITY_CALENDAR_MANAGE));
  assert.ok(MODULE_ACCESS_PERMISSIONS.punctuality.includes(PERMISSIONS.REPORTS_GENERATE));
  assert.ok(MODULE_ACCESS_PERMISSIONS.families.includes(PERMISSIONS.FAMILY_MANAGE));
  assert.ok(MODULE_ACCESS_PERMISSIONS.directory.includes(PERMISSIONS.PROFILES_MANAGE));
});
