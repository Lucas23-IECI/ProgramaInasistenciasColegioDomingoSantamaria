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
  const serverSource = [
    fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8'),
    fs.readFileSync(path.join(__dirname, '..', 'routes', 'users.js'), 'utf8')
  ].join('\n');
  assert.match(serverSource, /getAccessProfiles/);
  assert.match(serverSource, /\/api\/access-profiles/);
  assert.doesNotMatch(serverSource, /validateSystemRole/);
  assert.doesNotMatch(serverSource, /\/api\/access-people/);
});

test('la eliminación de cuentas conserva trazabilidad y no reutiliza la desactivación', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'users.js'), 'utf8');
  const migrationSource = fs.readFileSync(path.join(__dirname, '..', 'migrations', '008_eliminacion_logica_usuarios.sql'), 'utf8');
  assert.match(serverSource, /accion: 'ELIMINAR_USUARIO'/);
  assert.match(serverSource, /eliminado_en = CURRENT_TIMESTAMP/);
  assert.match(serverSource, /motivo de eliminación de al menos 8 caracteres/);
  assert.match(migrationSource, /WHERE eliminado_en IS NULL/);
});

test('la auditoría permite consultar actividad y cambios de una cuenta específica', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'audit.js'), 'utf8');
  assert.match(serverSource, /cuenta_id/);
  assert.match(serverSource, /relacion = 'todas'/);
  assert.match(serverSource, /a\.usuario_id IS DISTINCT FROM/);
  assert.match(serverSource, /relacion_cuenta/);
  assert.match(serverSource, /a\.usuario_id/);
  assert.match(serverSource, /a\.entidad = 'usuario'/);
});

test('la regularizacion IPE a RUN exige permiso, respaldo y auditoria', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'students', 'management.js'), 'utf8');
  const migrationSource = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '024_regularizacion_ipe_run.sql'),
    'utf8'
  );

  assert.match(routeSource, /\/api\/students\/:id\/identifiers\/ipe-to-run/);
  assert.match(routeSource, /verifyPermission\('students\.identity\.regularize'\)/);
  assert.match(routeSource, /createDocument/);
  assert.match(routeSource, /accion: 'REGULARIZAR_IPE_A_RUN'/);
  assert.match(migrationSource, /'students\.identity\.regularize'/);
  assert.match(migrationSource, /documento_id INT NOT NULL/);
});

test('las exportaciones del padrón separan la salida operativa de la restringida', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'studentGovernance.js'), 'utf8');
  const migrationSource = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '025_exportaciones_padron_seguras.sql'),
    'utf8'
  );

  assert.match(routeSource, /students\.export_sensitive/);
  assert.match(routeSource, /EXPORTAR_PADRON_ADMINISTRATIVO/);
  assert.match(routeSource, /Cache-Control', 'no-store, private/);
  assert.match(migrationSource, /'students\.export'/);
  assert.match(migrationSource, /'students\.export_sensitive'/);
  assert.match(migrationSource, /WHERE codigo = 'admin'/);
});

test('la revelación de identificadores exige permiso crítico y queda auditada', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'students', 'management.js'), 'utf8');
  const migrationSource = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '026_proteccion_identificadores_estudiantiles.sql'),
    'utf8'
  );

  assert.match(routeSource, /SENSITIVE_IDENTIFIER_PERMISSION/);
  assert.match(routeSource, /REVELAR_IDENTIFICADORES_ESTUDIANTE/);
  assert.match(routeSource, /Cache-Control', 'no-store, private/);
  assert.match(migrationSource, /'students\.identifiers\.view_sensitive'/);
  assert.match(migrationSource, /true\s*\)/);
  assert.match(migrationSource, /WHERE codigo = 'admin'/);
});
