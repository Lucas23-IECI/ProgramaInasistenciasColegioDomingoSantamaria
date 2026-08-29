import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const frontendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(frontendRoot, relative), 'utf8');
const source = fs.readFileSync(path.join(frontendRoot, 'src/AnaliticasAdmin.jsx'), 'utf8');

test('la analítica institucional expone indicadores explicables y exportables', () => {
  assert.match(source, /Analítica explicable/u);
  assert.match(source, /Alertas con explicación/u);
  assert.match(source, /exportInstitutional\('pdf'\)/u);
  assert.match(source, /exportInstitutional\('xlsx'\)/u);
  assert.match(source, /activeAnalyticsParams/u);
  assert.match(source, /id_curso: courseId \|\| undefined/u);
  assert.match(source, /params: \{ \.\.\.activeAnalyticsParams, formato: format \}/u);
  assert.match(source, /Alcance del informe/u);
});

test('el gráfico diario permite comparar por línea, barras o tabla y expone cantidades accesibles', () => {
  assert.match(source, /CHART_VIEWS/u);
  assert.match(source, /Línea/u);
  assert.match(source, /Barras/u);
  assert.match(source, /Tabla/u);
  assert.match(source, /aria-pressed/u);
  assert.match(source, /Pasa el cursor para consultar/u);
  assert.match(source, /onMouseLeave=\{\(\) => setHoveredIndex\(null\)\}/u);
  assert.match(source, /current === index \? null : index/u);
  assert.match(source, /chart-tooltip/u);
  assert.match(source, /daily-chart-table/u);
});

test('los administradores autorizados pueden gestionar reportes automáticos', () => {
  assert.match(source, /ANALYTICS_SCHEDULES_MANAGE/u);
  assert.match(source, /\/analitica\/programaciones/u);
  assert.match(source, /Reportes automáticos/u);
  assert.match(source, /toggleSchedule/u);
  assert.match(source, /Historial de ejecuciones/u);
  assert.match(source, /downloadExecution/u);
  assert.match(source, /retryExecution/u);
  assert.match(source, /error_publico/u);
});

test('la ayuda de estadísticas explica los controles, el gráfico, el alcance y las exportaciones actuales', () => {
  const tours = read('src/help/tours.js');
  for (const marker of [
    'analytics-summary', 'analytics-daily-chart', 'analytics-breakdowns',
    'analytics-recurrence', 'analytics-institutional', 'analytics-export', 'analytics-schedules'
  ]) assert.match(source, new RegExp(`data-tour="${marker}"`, 'u'));
  assert.match(tours, /Evolución diaria interactiva/u);
  assert.match(tours, /PDF y Excel conservan el período, curso, justificación y severidad visibles/u);
  assert.match(tours, /No reutiliza filtros temporales/u);
});

test('cada indicador enlaza su conjunto real y conserva los filtros del análisis', () => {
  assert.match(source, /Ver registros del día/u);
  assert.match(source, /minutos_desde/u);
  assert.match(source, /alumno_id/u);
  assert.match(source, /control_id/u);
  assert.match(source, /openCoexistenceRecords/u);
  assert.match(source, /contacto_apoderado/u);
  assert.match(source, /estado: 'CERRADO', contacto_apoderado: 'true'/u);
  assert.match(source, /item\.control_id \|\| 'sin_control'/u);
  assert.match(source, /openVisitRecords\('historial'/u);
  assert.match(source, /openVisitRecords\('retiros'/u);
  assert.match(source, /Estudiantes que mejoraron/u);
  assert.match(source, /Ejecución anterior a esta mejora/u);
  const tours = read('src/help/tours.js');
  assert.match(tours, /Los cuatro se pueden abrir/u);
  assert.match(tours, /listas reales filtradas/u);
});
