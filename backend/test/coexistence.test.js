const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  createCoexistenceRouter,
  validateParticipant
} = require('../routes/coexistence');

const migrationSource = () => fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '033_convivencia_escolar.sql'),
  'utf8'
);

const routeSource = () => fs.readFileSync(
  path.join(__dirname, '..', 'routes', 'coexistence.js'),
  'utf8'
);

test('acepta participantes institucionales y externos con referencias coherentes', () => {
  assert.deepEqual(validateParticipant({
    tipo_persona: 'estudiante',
    rol_en_caso: 'afectado',
    estudiante_id: 24
  }).participant, {
    tipo_persona: 'ESTUDIANTE',
    rol_en_caso: 'AFECTADO',
    detalle_relacion: null,
    estudiante_id: 24,
    usuario_id: null,
    nombre_externo: null
  });

  assert.equal(validateParticipant({
    tipo_persona: 'externa',
    rol_en_caso: 'apoderado',
    nombre_externo: '  Ana   Perez  '
  }).participant.nombre_externo, 'Ana Perez');
});

test('rechaza participantes ambiguos o sin referencia valida', () => {
  assert.match(validateParticipant({
    tipo_persona: 'estudiante',
    rol_en_caso: 'afectado'
  }).error, /estudiante valido/i);
  assert.match(validateParticipant({
    tipo_persona: 'externa',
    rol_en_caso: 'apoderado',
    nombre_externo: 'A'
  }).error, /persona externa/i);
  assert.match(validateParticipant({
    tipo_persona: 'desconocida',
    rol_en_caso: 'otro'
  }).error, /tipo de persona/i);
});

test('la migracion crea un dominio aislado y aditivo para convivencia', () => {
  const migration = migrationSource();
  for (const table of [
    'convivencia_casos',
    'convivencia_participantes',
    'convivencia_eventos',
    'convivencia_evento_participantes',
    'convivencia_documentos'
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)|TRUNCATE/i);
  assert.doesNotMatch(migration, /ALTER\s+TABLE\s+(alumno|matricula|attendance_registrations)/i);
});

test('los permisos reservados se entregan solo a administrador y convivencia', () => {
  const migration = migrationSource();
  for (const permission of ['view', 'create', 'manage', 'documents', 'close']) {
    assert.match(migration, new RegExp(`convivencia\\.${permission}`));
  }
  assert.match(migration, /SELECT 'admin', codigo/);
  assert.match(migration, /SELECT 'convivencia', codigo/);
  assert.doesNotMatch(migration, /SELECT '(inspector|secretaria|direccion|lector)', codigo/);
});

test('cada operacion sensible exige permiso en backend', () => {
  const router = routeSource();
  assert.equal(typeof createCoexistenceRouter, 'function');
  assert.match(router, /verifyPermission\('convivencia\.view'\)/);
  assert.match(router, /verifyPermission\('convivencia\.create'\)/);
  assert.match(router, /verifyPermission\('convivencia\.manage'\)/);
  assert.match(router, /verifyPermission\('convivencia\.documents'\)/);
  assert.match(router, /verifyPermission\('convivencia\.close'\)/);
});

test('la auditoria general conserva metadatos sin duplicar narrativas sensibles', () => {
  const router = routeSource();
  const auditDetails = [...router.matchAll(/detalle:\s*\{([^}]*)\}/g)]
    .map((match) => match[1])
    .join('\n');
  assert.doesNotMatch(auditDetails, /descripcion_inicial|detalle_evento|motivo_cierre|resultado/);
  assert.match(router, /CONVIVENCIA_CASO_CREADO/);
  assert.match(router, /CONVIVENCIA_ACTUACION_REGISTRADA/);
  assert.match(router, /CONVIVENCIA_CASO_CERRADO/);
  assert.match(router, /CONVIVENCIA_DOCUMENTO_DESCARGADO/);
});

test('los casos no se eliminan y los cerrados bloquean nuevas modificaciones', () => {
  const router = routeSource();
  assert.doesNotMatch(router, /router\.delete|DELETE FROM convivencia_/i);
  assert.match(router, /no admite cambios mientras se encuentre cerrado o anulado/i);
  assert.match(router, /SELECT id_caso, codigo, estado, version FROM convivencia_casos[\s\S]*FOR UPDATE/);
});

test('el listado protegido acepta desgloses explicables provenientes de Analítica', () => {
  const router = routeSource();
  const start = router.indexOf("router.get('/casos'");
  const end = router.indexOf("router.get('/casos/:caseId'", start);
  const listRoute = router.slice(start, end);
  assert.match(listRoute, /req\.query\.activos/u);
  assert.match(listRoute, /req\.query\.contacto_apoderado/u);
  assert.match(listRoute, /req\.query\.desde/u);
  assert.match(listRoute, /req\.query\.hasta/u);
  assert.match(listRoute, /perfil_responsable/u);
  assert.match(listRoute, /cp\.rol_en_caso = 'APODERADO'/u);
});
