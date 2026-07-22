const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { normalizePermissions, normalizeProfileCode } = require('../utils/permissions');

test('normaliza una selección de permisos sin duplicados ni valores vacíos', () => {
  assert.deepEqual(
    normalizePermissions(['punctuality.register', ' users.manage ', '', 'punctuality.register', null]),
    ['punctuality.register', 'users.manage']
  );
});

test('genera códigos estables para perfiles creados por el establecimiento', () => {
  assert.equal(normalizeProfileCode('Inspector General'), 'inspector_general');
  assert.equal(normalizeProfileCode('  Portería / Hall  '), 'porteria_hall');
  assert.equal(normalizeProfileCode(''), '');
});

test('las rutas operacionales exigen permisos y no dependen de roles rígidos', () => {
  const routerSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'punctuality.js'), 'utf8');
  assert.match(routerSource, /verifyPermission\('punctuality\.register'\)/);
  assert.match(routerSource, /verifyPermission\('punctuality\.correct'\)/);
  assert.match(routerSource, /verifyPermission\('punctuality\.cancel'\)/);
  assert.match(routerSource, /verifyPermission\('punctuality\.justify'\)/);
  assert.doesNotMatch(routerSource, /verifyRole\(/);
});

test('el servidor consulta perfiles configurables en lugar de roles fijos', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /getAccessProfiles/);
  assert.match(serverSource, /\/api\/access-profiles/);
  assert.doesNotMatch(serverSource, /validateSystemRole/);
  assert.doesNotMatch(serverSource, /\/api\/access-people/);
});

test('la eliminación de cuentas conserva trazabilidad y no reutiliza la desactivación', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const migrationSource = fs.readFileSync(path.join(__dirname, '..', 'migrations', '008_eliminacion_logica_usuarios.sql'), 'utf8');
  assert.match(serverSource, /accion: 'ELIMINAR_USUARIO'/);
  assert.match(serverSource, /eliminado_en = CURRENT_TIMESTAMP/);
  assert.match(serverSource, /motivo de eliminación de al menos 8 caracteres/);
  assert.match(migrationSource, /WHERE eliminado_en IS NULL/);
});

test('la auditoría permite consultar actividad y cambios de una cuenta específica', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(serverSource, /cuenta_id/);
  assert.match(serverSource, /relacion = 'todas'/);
  assert.match(serverSource, /a\.usuario_id IS DISTINCT FROM/);
  assert.match(serverSource, /relacion_cuenta/);
  assert.match(serverSource, /a\.usuario_id/);
  assert.match(serverSource, /a\.entidad = 'usuario'/);
});
