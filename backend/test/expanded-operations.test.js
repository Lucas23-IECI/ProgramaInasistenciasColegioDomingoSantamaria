const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

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

test('Portería ampliada protege restricciones, vehículos y emergencias con permisos específicos', () => {
  const route = read('routes/visitsExtended.js');
  assert.match(route, /verifyPermission\('visits\.restrictions\.manage'\)/u);
  assert.match(route, /verifyPermission\('visits\.vehicles\.manage'\)/u);
  assert.match(route, /verifyPermission\('visits\.emergency\.manage'\)/u);
  assert.match(route, /CREAR_RESTRICCION_VISITA/u);
  assert.match(route, /INICIAR_EMERGENCIA_VISITA/u);
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
