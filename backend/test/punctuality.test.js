const test = require('node:test');
const assert = require('node:assert/strict');
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
