const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { calculateStatusAndSeverity, normalizeClockTime } = require('../utils/punctuality');

test('normaliza horas institucionales con y sin segundos', () => {
  assert.equal(normalizeClockTime('8:05'), '08:05:00');
  assert.equal(normalizeClockTime('08:05:09-03'), '08:05:09');
  assert.equal(normalizeClockTime('25:00'), null);
});

test('clasifica un ingreso real anterior al límite como presente', () => {
  assert.deepEqual(
    calculateStatusAndSeverity('Entrada', '08:14:59', { hora_limite_atraso: '08:15:00' }),
    { status: 'Presente', severidad: 'Normal' }
  );
});

test('clasifica el límite y los siguientes quince minutos como atraso leve', () => {
  assert.deepEqual(
    calculateStatusAndSeverity('Entrada', '08:15:00', { hora_limite_atraso: '08:15:00' }),
    { status: 'Atrasado', severidad: 'Leve' }
  );
  assert.deepEqual(
    calculateStatusAndSeverity('Entrada', '08:30:00', { hora_limite_atraso: '08:15:00' }),
    { status: 'Atrasado', severidad: 'Leve' }
  );
});

test('clasifica un ingreso posterior al margen como atraso grave', () => {
  assert.deepEqual(
    calculateStatusAndSeverity('Entrada', '08:30:01', { hora_limite_atraso: '08:15:00' }),
    { status: 'Atrasado', severidad: 'Grave' }
  );
});

test('conserva el estado de salida fuera de la clasificación de atrasos', () => {
  assert.deepEqual(
    calculateStatusAndSeverity('Salida', '18:00:00', { hora_limite_atraso: '08:15:00' }),
    { status: 'Salida', severidad: 'Normal' }
  );
});

test('expone una bandeja histórica paginada solo para atrasos pendientes', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/punctuality.js'), 'utf8');
  const start = source.indexOf("router.get('/justificaciones-pendientes'");
  const end = source.indexOf("router.get('/resumen-hoy'", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const route = source.slice(start, end);

  assert.match(route, /verifyPermission\('punctuality\.justify'\)/u);
  assert.match(route, /r\.fecha BETWEEN \$1 AND \$2/u);
  assert.match(route, /r\.estado = 'Atrasado'/u);
  assert.match(route, /r\.justificado = false/u);
  assert.match(route, /COALESCE\(r\.id_curso_registro, m\.id_curso\)/u);
  assert.match(route, /ORDER BY r\.fecha DESC, r\.hora DESC/u);
  assert.match(route, /LIMIT \$\$\{index\} OFFSET \$\$\{index \+ 1\}/u);
});

test('justificar conserva la fecha original y registra responsable y momento de regularización', () => {
  const source = fs.readFileSync(path.join(__dirname, '../routes/punctuality.js'), 'utf8');
  const start = source.indexOf("router.post('/registros/:id/justificar'");
  const end = source.indexOf("router.patch('/registros/:id/revocar-justificacion'", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const route = source.slice(start, end);

  assert.doesNotMatch(route, /SET\s+fecha\s*=/u);
  assert.match(route, /regularizado_por = \$4/u);
  assert.match(route, /regularizado_en = CURRENT_TIMESTAMP/u);
  assert.match(route, /accion: 'JUSTIFICAR_ATRASO'/u);
  assert.match(route, /antes:\s*before,\s*despues:\s*after/u);
});
