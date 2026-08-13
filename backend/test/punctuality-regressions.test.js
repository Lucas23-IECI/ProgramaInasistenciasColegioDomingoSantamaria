const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../routes/punctuality.js'), 'utf8');

test('la API identifica explícitamente los conflictos por registro duplicado', () => {
  assert.match(source, /code: 'REGISTRO_DUPLICADO'/u);
  assert.match(source, /code: 'SIN_CONTROL_HORARIO'/u);
});

test('la API expone el detalle histórico paginado con los mismos filtros de analítica', () => {
  const start = source.indexOf("router.get('/registros'");
  const end = source.indexOf("router.get('/justificaciones-pendientes'", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const route = source.slice(start, end);
  assert.match(route, /r\.fecha BETWEEN \$1 AND \$2/u);
  assert.match(route, /rawCourseId === 'sin_curso'/u);
  assert.match(route, /LIMIT \$\$\{index\} OFFSET \$\$\{index \+ 1\}/u);
  assert.match(route, /registros: result\.rows\.map/u);
});

test('el desglose analítico devuelve el identificador histórico del curso', () => {
  assert.match(source, /COALESCE\(r\.id_curso_registro, m\.id_curso\) AS id_curso/u);
});
