const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

const retiredRoutes = [
  '/api/attendance/config',
  '/api/asistencia/today',
  '/api/asistencia/today-stats',
  '/api/asistencia/range-stats',
  '/api/asistencia/inasistencias',
  '/api/asistencia/history',
  '/api/admin/reportes/asistencia',
  '/api/asistencia/justificar-nueva',
  '/api/asistencia/registrar-ausencia',
  '/api/asistencia/justificaciones',
  '/api/asistencia/alertas-tempranas'
];

test('las rutas retiradas solo aparecen en el catalogo HTTP 410', () => {
  for (const route of retiredRoutes) {
    assert.equal(serverSource.split(`'${route}'`).length - 1, 1, `${route} debe declararse una sola vez`);
  }
  assert.match(serverSource, /MODULO_ASISTENCIA_DESCONTINUADO/);
});

test('no recompila calculos ni mutaciones de ausencias', () => {
  assert.doesNotMatch(serverSource, /REGISTRAR_AUSENCIA_MANUAL|JUSTIFICAR_AUSENCIA|alertaConsecutiva/);
  assert.doesNotMatch(serverSource, /estado\s*=\s*'Ausente'/);
});

test('mantiene un unico alias transitorio para registrar ingresos', () => {
  assert.equal(serverSource.split("app.post('/api/asistencia'").length - 1, 1);
  assert.match(serverSource, /endpoint_legacy: true/);
});
