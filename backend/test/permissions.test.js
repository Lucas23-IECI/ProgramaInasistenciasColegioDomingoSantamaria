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

test('el terminal separa pistola, cámara y búsqueda manual sin retirar el permiso base', () => {
  const routerSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'punctuality.js'), 'utf8');
  const legacySource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'students', 'registry.js'), 'utf8');
  const migrationSource = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '028_metodos_registro_terminal.sql'),
    'utf8'
  );

  assert.match(routerSource, /normalizeRegistrationMethod/);
  assert.match(routerSource, /METODO_REGISTRO_NO_AUTORIZADO/);
  assert.match(routerSource, /metodo_registro: registrationMethod/);
  assert.match(legacySource, /verifyPermission\('punctuality\.register\.barcode'\)/);
  assert.match(migrationSource, /'punctuality\.register\.barcode'/);
  assert.match(migrationSource, /'punctuality\.register\.camera'/);
  assert.match(migrationSource, /'punctuality\.register\.manual'/);
  assert.match(migrationSource, /WHERE base\.permiso_codigo = 'punctuality\.register'/);
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

test('la lectura MRZ exige permiso y no envía imágenes ni texto al servidor', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'students', 'management.js'), 'utf8');
  const migrationSource = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '029_lectura_mrz_pasaporte.sql'),
    'utf8'
  );
  const frontendSource = fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'src', 'components', 'PassportMrzPanel.jsx'),
    'utf8'
  );

  assert.match(routeSource, /verifyPermission\('students\.identity\.mrz'\)/);
  assert.match(routeSource, /conserva_imagen: false/);
  assert.match(routeSource, /conserva_mrz: false/);
  assert.match(migrationSource, /'students\.identity\.mrz'/);
  assert.doesNotMatch(frontendSource, /FormData|type="file"|getUserMedia/);
});

test('las exportaciones del padrón exigen permiso y mantienen trazabilidad', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'studentGovernance.js'), 'utf8');
  const migrationSource = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '025_exportaciones_padron_seguras.sql'),
    'utf8'
  );

  assert.match(routeSource, /verifyPermission\('students\.export'\)/);
  assert.doesNotMatch(routeSource, /students\.export_sensitive/);
  assert.match(routeSource, /EXPORTAR_PADRON_ADMINISTRATIVO/);
  assert.match(routeSource, /Cache-Control', 'no-store, private/);
  assert.match(migrationSource, /'students\.export'/);
  assert.match(migrationSource, /'students\.export_sensitive'/);
  assert.match(migrationSource, /WHERE codigo = 'admin'/);
});

test('la ficha entrega identificadores completos sin un flujo de revelación', () => {
  const routeSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'students', 'management.js'), 'utf8');

  assert.doesNotMatch(routeSource, /SENSITIVE_IDENTIFIER_PERMISSION/);
  assert.doesNotMatch(routeSource, /REVELAR_IDENTIFICADORES_ESTUDIANTE/);
  assert.match(routeSource, /Cache-Control', 'no-store, private/);
  assert.match(routeSource, /protectStudentIdentifier\(identifier\)/);
});
