const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { validatePeriod } = require('../services/institutionalAnalyticsService');
const { previousPeriod } = require('../services/institutionalReportScheduler');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('la analítica institucional limita y valida el período solicitado', () => {
  assert.deepEqual(validatePeriod('2026-08-01', '2026-08-01'), {
    from: '2026-08-01',
    to: '2026-08-01',
    days: 1,
  });
  assert.throws(() => validatePeriod('01-08-2026', '2026-08-02'), /fechas válidas/u);
  assert.throws(() => validatePeriod('2026-08-02', '2026-08-01'), /entre 1 y 366 días/u);
  assert.throws(() => validatePeriod('2025-01-01', '2026-08-01'), /entre 1 y 366 días/u);
});

test('los reportes semanales y mensuales utilizan períodos anteriores cerrados', () => {
  const now = new Date('2026-08-09T12:00:00Z');
  assert.deepEqual(previousPeriod('SEMANAL', now), { from: '2026-08-02', to: '2026-08-08' });
  assert.deepEqual(previousPeriod('MENSUAL', now), { from: '2026-07-01', to: '2026-07-31' });
});

test('la migración de analítica y PWA es aditiva e idempotente', () => {
  const migration = read('migrations/035_analitica_institucional_pwa.sql');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS offline_operation_id UUID/u);
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_offline_operation/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS reportes_institucionales_programados/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS reportes_institucionales_ejecuciones/u);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b/iu);
});

test('el registro diferido tiene idempotencia y ventana temporal acotada en backend', () => {
  const route = read('routes/punctuality.js');
  assert.match(route, /offline_operation_id/u);
  assert.match(route, /WHERE offline_operation_id = \$1 LIMIT 1/u);
  assert.match(route, /interval '24 hours'/u);
  assert.match(route, /interval '5 minutes'/u);
  assert.match(route, /registrado_sin_conexion/u);
  assert.match(route, /\/offline-roster/u);
});

test('el programador evita ejecuciones paralelas del mismo informe', () => {
  const scheduler = read('services/institutionalReportScheduler.js');
  assert.match(scheduler, /pg_try_advisory_lock/u);
  assert.match(scheduler, /pg_advisory_unlock/u);
  assert.match(scheduler, /BEGIN/u);
  assert.match(scheduler, /COMMIT/u);
  assert.match(scheduler, /ROLLBACK/u);
});
