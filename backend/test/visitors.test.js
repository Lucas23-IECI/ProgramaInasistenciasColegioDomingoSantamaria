const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  calculateRutDv,
  formatChilePhone,
  maskDocument,
  normalizeChilePhone,
  normalizeVisitorDocument,
  validateVisitorInput
} = require('../utils/visitors');

const readRoute = (...segments) => fs.readFileSync(
  path.join(__dirname, '..', 'routes', ...segments),
  'utf8'
);
const visitsRouterSource = () => [
  readRoute('visits.js'),
  readRoute('visits', 'authorizations.js'),
  readRoute('visits', 'withdrawals.js')
].join('\n');

test('calcula y valida un RUT chileno completo', () => {
  assert.equal(calculateRutDv('12345678'), '5');
  const result = normalizeVisitorDocument('RUT', '12.345.678-5');
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value, {
    type: 'RUT',
    document: '123456785',
    body: '12345678',
    dv: '5',
    formatted: '12.345.678-5'
  });
});

test('rechaza un RUT cuyo dígito verificador no coincide', () => {
  const result = normalizeVisitorDocument('RUT', '12.345.678-9');
  assert.match(result.error, /dígito verificador/);
});

test('acepta documentos extranjeros sin confundirlos con RUT', () => {
  const result = validateVisitorInput({
    tipo_documento: 'PASAPORTE',
    documento: 'AB-123456',
    nombre_completo: 'Camila Torres',
    telefono: ''
  });
  assert.equal(result.error, undefined);
  assert.equal(result.value.documento_numero, 'AB123456');
  assert.equal(result.value.telefono, null);
});

test('normaliza y presenta teléfonos chilenos sin guardar separadores', () => {
  assert.deepEqual(normalizeChilePhone('+56 9 8765 4321'), { value: '+56987654321' });
  assert.deepEqual(normalizeChilePhone('41 234 5678'), { value: '+56412345678' });
  assert.equal(formatChilePhone('+56987654321'), '+56 9 8765 4321');
  assert.match(normalizeChilePhone('123').error, /teléfono chileno válido/);
});

test('enmascara documentos antes de mostrarlos en listados generales', () => {
  assert.equal(maskDocument('RUT', '123456785'), '12••••85');
  assert.equal(maskDocument('PASAPORTE', 'AB123456'), 'AB••••56');
});

test('el módulo separa visitas, retiros y puntualidad', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '009_control_visitas_retiros.sql'), 'utf8');
  const router = fs.readFileSync(path.join(__dirname, '..', 'routes', 'visits.js'), 'utf8');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS visitantes/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS visitas/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS retiros_alumno/);
  const guardianMigration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '010_apoderados_retiros_reportes.sql'), 'utf8');
  assert.match(guardianMigration, /CREATE TABLE IF NOT EXISTS importaciones_apoderados/);
  assert.match(guardianMigration, /CREATE TABLE IF NOT EXISTS retiro_motivos/);
  assert.match(guardianMigration, /CREATE TABLE IF NOT EXISTS tipos_parentesco/);
  assert.doesNotMatch(router, /INSERT INTO attendance_registrations/);
  assert.doesNotMatch(router, /INSERT INTO alumno/);
});

test('las mutaciones sensibles exigen permisos granulares', () => {
  const router = visitsRouterSource();
  assert.match(router, /verifyPermission\('visits\.register'\)/);
  assert.match(router, /verifyPermission\('visits\.checkout'\)/);
  assert.match(router, /verifyPermission\('visits\.manage'\)/);
  assert.match(router, /verifyPermission\('withdrawals\.approve'\)/);
  assert.match(router, /verifyPermission\('withdrawals\.authorizations'\)/);
  assert.match(router, /withdrawals\.import_guardians/);
  assert.match(router, /verifyPermission\('visits\.reports'\)/);
});

test('la importación de apoderados no crea alumnos ni cuentas de acceso', () => {
  const router = readRoute('visits', 'authorizations.js');
  const importRoute = router.slice(
    router.indexOf("router.post('/apoderados/importar'"),
    router.indexOf("router.get('/retiros'")
  );
  assert.match(importRoute, /INSERT INTO personas_autorizadas_retiro/);
  assert.doesNotMatch(importRoute, /INSERT INTO alumno/);
  assert.doesNotMatch(importRoute, /INSERT INTO usuarios/);
});

test('los reportes institucionales incluyen formatos seguros y auditados', () => {
  const router = readRoute('visits', 'withdrawals.js');
  const reportRoute = router.slice(
    router.indexOf("router.get('/reportes'"),
    router.indexOf("router.post('/retiros'")
  );
  assert.match(reportRoute, /\['json', 'xlsx', 'pdf', 'md'\]/);
  assert.match(reportRoute, /buildVisitsWorkbook/);
  assert.match(reportRoute, /streamVisitsPdf/);
  assert.match(reportRoute, /EXPORTAR_REPORTE_VISITAS/);
  assert.match(visitsRouterSource(), /documento_mostrado/);
});

test('Portería registra uno o más hermanos en una sola operación trazable', () => {
  const router = readRoute('visits', 'withdrawals.js');
  const route = router.slice(
    router.indexOf("router.post('/retiros/registrar-salida'"),
    router.indexOf("router.patch('/retiros/:id/decision'")
  );
  assert.match(route, /id_alumnos/);
  assert.match(route, /studentIds\.length > 10/);
  assert.match(route, /ENTREGADO/);
  assert.match(route, /validacion_excepcional/);
  assert.match(route, /REGISTRAR_RETIRO_PORTERIA/);
});

test('visitas y retiros aceptan el período y motivo provenientes de Analítica', () => {
  const visits = readRoute('visits.js');
  const withdrawals = readRoute('visits', 'withdrawals.js');
  assert.match(visits, /motivo_codigo: motiveCode/u);
  assert.match(visits, /v\.motivo_codigo = \$\$\{index\+\+\}/u);
  assert.match(withdrawals, /req\.query\.desde/u);
  assert.match(withdrawals, /req\.query\.hasta/u);
  assert.match(withdrawals, /r\.motivo_codigo = \$\$\{index\+\+\}/u);
});

test('visitas y retiros permiten recuperar un antecedente exacto por id', () => {
  const visits = readRoute('visits.js');
  const withdrawals = readRoute('visits', 'withdrawals.js');
  assert.match(visits, /const requestedId = id \? parsePositiveId\(id\) : null/u);
  assert.match(visits, /v\.id = \$\$\{index\+\+\}/u);
  assert.match(withdrawals, /req\.query\.id \? parsePositiveId\(req\.query\.id\) : null/u);
  assert.match(withdrawals, /r\.id = \$\$\{index\+\+\}/u);
});

test('visitas y retiros construyen la respuesta antes de confirmar la transacción', () => {
  const visits = readRoute('visits.js');
  const withdrawals = readRoute('visits', 'withdrawals.js');
  assert.doesNotMatch(visits, /await client\.query\('COMMIT'\);\s*const (created|updated) = await pool\.query\(`\$\{visitSelect\}/u);
  assert.match(visits, /const created = await client\.query\(`\$\{visitSelect\}[\s\S]{0,160}await client\.query\('COMMIT'\)/u);
  assert.match(visits, /const updated = await client\.query\(`\$\{visitSelect\}[\s\S]{0,160}await client\.query\('COMMIT'\)/u);
  assert.doesNotMatch(withdrawals, /await client\.query\('COMMIT'\);\s*const (created|updated) = await pool\.query/u);
  assert.equal((withdrawals.match(/const (?:created|updated) = await client\.query\(/gu) || []).length, 4);
});

test('la ficha de apoderado devuelve todos sus estudiantes vinculados', () => {
  const router = fs.readFileSync(path.join(__dirname, '..', 'routes', 'visits.js'), 'utf8');
  const route = router.slice(
    router.indexOf("router.get('/apoderados/buscar'"),
    router.indexOf("router.get('/estudiantes/buscar'")
  );
  assert.match(route, /personas_autorizadas_retiro/);
  assert.match(route, /JSON_AGG/);
  assert.match(route, /estudiantes/);
});

test('el perfil Lector queda fijo con solo los dos módulos operativos', () => {
  const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '011_perfil_lector_porteria.sql'), 'utf8');
  assert.match(migration, /DELETE FROM permisos_usuario/);
  assert.match(migration, /DELETE FROM permisos_rol/);
  assert.match(migration, /punctuality\.register/);
  assert.match(migration, /visits\.view/);
  assert.match(migration, /visits\.register/);
  assert.match(migration, /visits\.checkout/);
  assert.match(migration, /withdrawals\.register/);
  assert.doesNotMatch(migration, /withdrawals\.approve/);
});
