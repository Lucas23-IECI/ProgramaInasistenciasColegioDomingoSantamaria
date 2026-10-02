const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { blockingRestrictionType } = require('../routes/visitsExtended');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('las migraciones de Portería y puntualidad son aditivas y conservan datos existentes', () => {
  for (const file of ['migrations/040_porteria_ampliada.sql', 'migrations/041_puntualidad_ampliada.sql']) {
    const migration = read(file);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS/u);
    assert.doesNotMatch(migration, /^\s*(?:DROP|TRUNCATE|DELETE\s+FROM)\b/imu);
  }
});

test('la credencial temporal almacena un hash y controla vigencia y cantidad de usos', () => {
  const route = read('routes/visitsExtended.js');
  assert.match(route, /crypto\.createHash\('sha256'\)/u);
  assert.match(route, /token_hash/u);
  assert.match(route, /new Date\(row\.valida_desde\)[\s\S]*<= now/u);
  assert.match(route, /pre\.usos_realizados >= pre\.usos_maximos/u);
  assert.doesNotMatch(route, /INSERT INTO visita_preinscripciones[\s\S]{0,300}\btoken\b\s*,/u);
});

test('la credencial temporal nunca elude una autorización o bloqueo vigente', () => {
  const route = read('routes/visitsExtended.js');
  assert.equal(blockingRestrictionType([{ tipo: 'ALERTA' }]), null);
  assert.equal(blockingRestrictionType([{ tipo: 'REQUIERE_AUTORIZACION' }]), 'REQUIERE_AUTORIZACION');
  assert.equal(blockingRestrictionType([{ tipo: 'ALERTA' }, { tipo: 'BLOQUEO' }]), 'BLOQUEO');
  assert.match(route, /tipo IN \('BLOQUEO', 'REQUIERE_AUTORIZACION'\)/u);
  assert.match(route, /VISITOR_AUTHORIZATION_REQUIRED/u);
  assert.match(route, /bloqueo_acceso: accessRestriction/u);
  assert.match(route, /vm\.nombre AS motivo_nombre, vd\.nombre AS destino_nombre/u);
});

test('Portería ampliada protege restricciones, vehículos y emergencias con permisos específicos', () => {
  const route = read('routes/visitsExtended.js');
  assert.match(route, /verifyPermission\('visits\.restrictions\.manage'\)/u);
  assert.match(route, /verifyPermission\('visits\.vehicles\.manage'\)/u);
  assert.match(route, /verifyPermission\('visits\.emergency\.manage'\)/u);
  assert.match(route, /CREAR_RESTRICCION_VISITA/u);
  assert.match(route, /INICIAR_EMERGENCIA_VISITA/u);
  assert.match(route, /SELECT id, estado FROM visitas WHERE id = \$1 FOR UPDATE/u);
  assert.match(route, /Solo puedes vincular vehículos a una visita que todavía está dentro/u);
  assert.match(route, /SELECT id FROM visita_emergencias WHERE id=\$1 AND estado='ACTIVA' FOR UPDATE/u);
  assert.match(route, /La emergencia ya no está activa/u);
  assert.match(route, /GUARDAR_PUNTO_REUNION_VISITA/u);
});

test('el registro manual no permite eludir restricciones vigentes', () => {
  const route = read('routes/visits.js');
  assert.match(route, /visita_restricciones_acceso/u);
  assert.match(route, /VISITOR_ACCESS_BLOCKED/u);
  assert.match(route, /VISITOR_AUTHORIZATION_REQUIRED/u);
  assert.match(route, /tipo IN \('BLOQUEO', 'REQUIERE_AUTORIZACION'\)/u);
});

test('las políticas de puntualidad mantienen snapshot histórico y operaciones reversibles', () => {
  const policies = read('routes/punctualityPolicies.js');
  const punctuality = read('routes/punctuality.js');
  assert.match(policies, /HORARIO_ESPECIAL/u);
  assert.match(policies, /REVOCAR_EXCEPCION_ESTUDIANTE/u);
  assert.match(policies, /CERRAR_COMPROMISO_PUNTUALIDAD/u);
  assert.match(policies, /ON CONFLICT \(id_alumno,fecha,control_puntualidad_id\)/u);
  assert.match(punctuality, /turno_id_aplicado/u);
  assert.match(punctuality, /turno_nombre_aplicado/u);
  assert.match(punctuality, /calendario_excepcion_id/u);
  assert.match(punctuality, /motivo_institucional_codigo/u);
});

test('el buscador de estudiantes permite operar las nuevas políticas sin ampliar administración', () => {
  const registry = read('routes/students/registry.js');
  assert.match(registry, /punctuality\.exceptions\.manage/u);
  assert.match(registry, /punctuality\.contingencies\.manage/u);
  assert.match(registry, /punctuality\.commitments\.manage/u);
});
