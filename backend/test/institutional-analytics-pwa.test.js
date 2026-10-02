const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { normalizeAttendanceFilters, validatePeriod } = require('../services/institutionalAnalyticsService');
const { previousPeriod } = require('../services/institutionalReportScheduler');
const { buildInstitutionalPdf, buildInstitutionalWorkbook, buildInstitutionalWorkbookSheets } = require('../services/institutionalReportService');
const { buildReportArtifact, publicReportError } = require('../services/institutionalReportExecutionService');
const { normalizeReportScheduleInput, parsePositiveId } = require('../routes/analytics');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('la analítica institucional limita y valida el período solicitado', () => {
  assert.deepEqual(validatePeriod('2026-08-01', '2026-08-01'), {
    from: '2026-08-01',
    to: '2026-08-01',
    days: 1,
  });
  assert.throws(() => validatePeriod('01-08-2026', '2026-08-02'), /formato AAAA-MM-DD/u);
  assert.throws(() => validatePeriod('2026-02-30', '2026-03-02'), /formato AAAA-MM-DD/u);
  assert.throws(() => validatePeriod('2026-08-02', '2026-08-01'), /inicial no puede ser posterior/u);
  assert.deepEqual(validatePeriod('2025-01-01', '2026-01-01').days, 366);
  assert.throws(() => validatePeriod('2025-01-01', '2026-01-02'), /no puede superar 366 días/u);
});

test('las programaciones validan nombre, día, hora, formato e identificadores sin corregirlos silenciosamente', () => {
  assert.deepEqual(normalizeReportScheduleInput({
    nombre: 'Resumen semanal', frecuencia: 'semanal', formato: 'pdf', dia_semana: '5', hora: '07:30'
  }).value, {
    name: 'Resumen semanal', frequency: 'SEMANAL', format: 'PDF', dayWeek: 5, dayMonth: null, time: '07:30'
  });
  assert.match(normalizeReportScheduleInput({ nombre: 'R', frecuencia: 'SEMANAL', dia_semana: 1, hora: '07:00' }).error, /entre 3 y 120/u);
  assert.match(normalizeReportScheduleInput({ nombre: 'Resumen', frecuencia: 'SEMANAL', dia_semana: 8, hora: '07:00' }).error, /entre 1 y 7/u);
  assert.match(normalizeReportScheduleInput({ nombre: 'Resumen', frecuencia: 'MENSUAL', dia_mes: 29, hora: '07:00' }).error, /entre 1 y 28/u);
  assert.match(normalizeReportScheduleInput({ nombre: 'Resumen', frecuencia: 'MENSUAL', dia_mes: 1, hora: '25:90' }).error, /hora del reporte/u);
  assert.match(normalizeReportScheduleInput(null).error, /nombre del reporte/u);
  assert.equal(parsePositiveId('42'), 42);
  assert.equal(parsePositiveId('0'), null);
  assert.equal(parsePositiveId('abc'), null);
  assert.equal(parsePositiveId('1e2'), null);
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

test('el Excel institucional conserva el mismo alcance y todos los desgloses visibles', async () => {
  const analytics = {
    periodo: { from: '2026-08-01', to: '2026-08-26' },
    filtros: { curso_id: 7, curso: 'Pre-Kínder', justificado: false, severidad: 'Grave' },
    resumen: { ingresos: 38, atrasos: 12, tasa_atrasos: 31.6 },
    tendencia_diaria: [{ fecha: '2026-08-04', ingresos: 4, atrasos: 3 }],
    alertas: [{ level: 'alta', title: 'Alerta', explanation: 'Explicación', rule: 'Regla visible' }],
    comparacion_cursos: [{ curso: 'Pre-Kínder', ingresos: 38, atrasos: 12, porcentaje_atrasos: 31.6 }],
    bloques_horarios: [{ bloque: 'Ingreso', hora_limite: '08:00', ingresos: 38, atrasos: 12, promedio_minutos: 8.4 }],
    estudiantes_mejoraron: [{ estudiante: 'Estudiante de prueba', antes: 4, despues: 1, reduccion: 3 }],
    motivos_visita: [{ motivo: 'Entrevista', total: 7 }],
    retiros_anticipados: [{ motivo: 'Atención médica', total: 2, entregados: 2 }],
    convivencia: { total: 5, abiertos: 3, resueltos: 2, promedio_dias_resolucion: 4.5 },
    reincidencia_post_intervencion: { estudiantes_evaluados: 2, mejoraron: 1, sin_cambio: 1, reincidieron: 0 },
    contactos_apoderados: { casos_con_contacto: 2, cerrados: 1, porcentaje_cierre: 50 },
    carga_trabajo: [{ area: 'Inspectoría', casos: 5, abiertos: 3, resueltos: 2 }],
    metodologia: { privacidad: 'Solo entrega información autorizada.' }
  };
  const sheets = buildInstitutionalWorkbookSheets(analytics);
  assert.deepEqual(sheets.map((sheet) => sheet.sheet), [
    'Resumen', 'Alertas explicadas', 'Evolución diaria', 'Cursos', 'Bloques horarios',
    'Estudiantes mejoraron', 'Visitas y retiros', 'Convivencia', 'Carga por área', 'Metodología'
  ]);
  assert.equal(sheets[0].data[1][1].value, '01 ago 2026 al 26 ago 2026');
  assert.equal(sheets[0].data[6][1].value, 0.316);
  assert.equal(sheets[0].data[6][1].format, '0.0%');
  assert.equal(sheets[3].data[1][3].value, 0.316);
  assert.equal(sheets[3].data[1][3].type, Number);
  assert.equal(sheets[3].data[1][3].format, '0.0%');
  assert.equal(sheets[4].data[1][4].value, 8.4);
  assert.equal(sheets[4].data[1][4].type, Number);
  assert.equal(sheets[7].data[4][2].value, 4.5);
  assert.equal(sheets[7].data[11][2].value, 0.5);
  assert.equal(sheets[7].data[11][2].format, '0.0%');
  assert.equal(sheets[5].data[1][0].value, 'Estudiante de prueba');
  assert.equal(sheets[6].data[2][3].value, 2);
  const workbook = await buildInstitutionalWorkbook(analytics);
  assert.equal(workbook.subarray(0, 2).toString('ascii'), 'PK');
  assert.ok(workbook.length > 10_000, `El Excel fue inesperadamente pequeño: ${workbook.length} bytes`);
});

test('los fallos de reportes se traducen sin publicar detalles internos', () => {
  assert.match(publicReportError(new Error('connect ECONNREFUSED postgres')), /datos institucionales no estuvieron disponibles/u);
  assert.match(publicReportError(new Error('curso inválido')), /alcance configurado/u);
  assert.doesNotMatch(publicReportError(new Error('select * from secreto')), /select|secreto/iu);
});
