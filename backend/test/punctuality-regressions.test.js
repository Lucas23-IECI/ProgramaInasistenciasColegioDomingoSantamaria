const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../routes/punctuality.js'), 'utf8');
const legacySource = fs.readFileSync(path.join(__dirname, '../routes/students/registry.js'), 'utf8');

test('la API identifica explícitamente los conflictos por registro duplicado', () => {
  assert.match(source, /code: 'REGISTRO_DUPLICADO'/u);
  assert.match(source, /code: 'SIN_CONTROL_HORARIO'/u);
});

test('el ingreso heredado conserva causas explícitas y no usa el falso duplicado genérico', () => {
  const start = legacySource.indexOf("app.post('/api/asistencia'");
  assert.notEqual(start, -1);
  const route = legacySource.slice(start);
  assert.match(route, /code: 'SIN_CONTROL_HORARIO'/u);
  assert.match(route, /code: 'REGISTRO_DUPLICADO'/u);
  assert.doesNotMatch(route, /Registro ya realizado hoy/u);
});

test('la API expone el detalle histórico paginado con los mismos filtros de analítica', () => {
  const start = source.indexOf("router.get('/registros'");
  const end = source.indexOf("router.get('/justificaciones-pendientes'", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const route = source.slice(start, end);
  assert.match(route, /r\.fecha BETWEEN \$1 AND \$2/u);
  assert.match(route, /rawCourseId === 'sin_curso'/u);
  assert.match(route, /rawControlId === 'sin_control'/u);
  assert.match(route, /r\.control_puntualidad_id IS NULL/u);
  assert.match(route, /alumno_id: rawStudentId/u);
  assert.match(route, /minutos_desde: rawMinutesFrom/u);
  assert.match(route, /r\.id_alumno = \$\$\{index\+\+\}/u);
  assert.match(route, /r\.minutos_atraso >= \$\$\{index\+\+\}/u);
  assert.match(route, /LIMIT \$\$\{index\} OFFSET \$\$\{index \+ 1\}/u);
  assert.match(route, /registros: result\.rows\.map/u);
});

test('el desglose analítico devuelve el identificador histórico del curso', () => {
  assert.match(source, /COALESCE\(r\.id_curso_registro, m\.id_curso\) AS id_curso/u);
  assert.match(source, /minutos_desde/u);
  assert.match(source, /minutos_hasta/u);
});

test('la configuración obtiene su respuesta dentro de la transacción antes de confirmarla', () => {
  const start = source.indexOf("router.put('/config'");
  const end = source.indexOf("router.get('/offline-roster'", start);
  const route = source.slice(start, end);
  assert.match(route, /const controlsAfter = await getControls\(client\);\s*await client\.query\('COMMIT'\)/u);
  assert.doesNotMatch(route, /await client\.query\('COMMIT'\);[\s\S]*await getControls\(client\)/u);
});
