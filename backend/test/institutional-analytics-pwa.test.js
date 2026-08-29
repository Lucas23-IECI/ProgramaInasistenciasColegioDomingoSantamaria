const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { normalizeAttendanceFilters, validatePeriod } = require('../services/institutionalAnalyticsService');
const { previousPeriod } = require('../services/institutionalReportScheduler');
const { buildInstitutionalPdf } = require('../services/institutionalReportService');
const { buildReportArtifact, publicReportError } = require('../services/institutionalReportExecutionService');

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

test('la ampliación de reportes conserva archivos y reintentos dentro del respaldo', () => {
  const migration = read('migrations/048_reportes_programados_archivos.sql');
  assert.match(migration, /archivo_bytes BYTEA/u);
  assert.match(migration, /error_publico VARCHAR/u);
  assert.match(migration, /reintento_de BIGINT/u);
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b|DELETE\s+FROM/iu);
  const routes = read('routes/analytics.js');
  assert.match(routes, /programaciones\/ejecuciones/u);
  assert.match(routes, /\/descargar/u);
  assert.match(routes, /\/reintentar/u);
});

test('la analítica institucional valida y conserva los filtros visibles de puntualidad', async () => {
  const pool = {
    query: async (sql, params) => {
      assert.match(sql, /FROM curso WHERE id_curso = \$1/u);
      assert.deepEqual(params, [7]);
      return { rows: [{ id_curso: 7, nombre_curso: 'Pre-Kínder' }] };
    }
  };
  assert.deepEqual(await normalizeAttendanceFilters(pool, {
    courseId: '7', justified: 'false', severity: 'Grave'
  }), {
    courseId: 7, courseName: 'Pre-Kínder', justified: false, severity: 'Grave'
  });
  await assert.rejects(() => normalizeAttendanceFilters(pool, { courseId: '7', justified: 'quizás' }), /justificación no es válido/u);
  await assert.rejects(() => normalizeAttendanceFilters(pool, { courseId: '7', severity: 'Media' }), /severidad seleccionada no es válida/u);
});

test('los desgloses institucionales conservan identificadores para abrir el origen real', () => {
  const service = read('services/institutionalAnalyticsService.js');
  assert.match(service, /ar\.control_puntualidad_id AS control_id/u);
  assert.match(service, /SELECT r\.motivo_codigo, COALESCE\(rm\.nombre/u);
  assert.match(service, /SELECT v\.motivo_codigo, COALESCE\(vm\.nombre/u);
});

test('el PDF institucional contiene informe paginado, gráfico, tablas y metadatos', async () => {
  const analytics = {
    periodo: { from: '2026-08-01', to: '2026-08-26' },
    filtros: { curso_id: 7, curso: 'Pre-Kínder', justificado: false, severidad: 'Grave' },
    generado_en: '2026-08-27T18:00:00-04:00',
    resumen: { ingresos: 38, atrasos: 12, tasa_atrasos: 31.6 },
    convivencia: { abiertos: 3 },
    tendencia_diaria: [
      { fecha: '2026-08-04', ingresos: 4, atrasos: 3 },
      { fecha: '2026-08-05', ingresos: 5, atrasos: 1 },
      { fecha: '2026-08-06', ingresos: 6, atrasos: 4 }
    ],
    alertas: [{ level: 'alta', title: 'Alta proporción de atrasos registrados', explanation: '12 de 38 ingresos fueron atrasos.', rule: 'atrasos / ingresos >= 20%' }],
    comparacion_cursos: Array.from({ length: 22 }, (_, index) => ({ curso: `${index + 1}° Curso`, ingresos: index + 8, atrasos: index % 6, porcentaje_atrasos: 12.5 })),
    bloques_horarios: [{ bloque: 'Ingreso general', hora_limite: '08:00', ingresos: 38, atrasos: 12, promedio_minutos: 8.4 }],
    motivos_visita: [{ motivo: 'Entrevista', total: 7 }],
    retiros_anticipados: [{ motivo: 'Atención médica', total: 2 }],
    carga_trabajo: [{ area: 'Inspectoría', casos: 5, abiertos: 3, resueltos: 2 }],
    metodologia: { privacidad: 'Solo entrega métricas agregadas y no expone detalles reservados.' }
  };
  const pdf = await buildInstitutionalPdf(analytics);
  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-');
  assert.ok(pdf.length > 8_000, `El PDF fue inesperadamente pequeño: ${pdf.length} bytes`);
  const source = pdf.toString('latin1');
  const pageCount = source.match(/\/Type \/Page\b/gu)?.length || 0;
  assert.ok(pageCount >= 2 && pageCount <= 6, `El PDF generó una cantidad anómala de páginas: ${pageCount}`);
  assert.match(source, /\/Title \d+ 0 R/u);
  assert.match(source, /\/Author \d+ 0 R/u);

  const artifact = await buildReportArtifact(analytics, 'PDF', 'Resumen institucional');
  assert.match(artifact.fileName, /^Resumen-institucional-2026-08-01-2026-08-26\.pdf$/u);
  assert.equal(artifact.mime, 'application/pdf');
  assert.equal(artifact.buffer.subarray(0, 5).toString('ascii'), '%PDF-');
});

test('los fallos de reportes se traducen sin publicar detalles internos', () => {
  assert.match(publicReportError(new Error('connect ECONNREFUSED postgres')), /datos institucionales no estuvieron disponibles/u);
  assert.match(publicReportError(new Error('curso inválido')), /alcance configurado/u);
  assert.doesNotMatch(publicReportError(new Error('select * from secreto')), /select|secreto/iu);
});
