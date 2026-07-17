const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateDelayMinutes, calculateStatusAndSeverity } = require('../utils/punctuality');
const { isIsoDate, validateDateRange, validatePunctualityConfig, validateReason } = require('../utils/validation');

test('valida fechas reales y limita el tamaño de los reportes', () => {
  assert.equal(isIsoDate('2026-02-29'), false);
  assert.equal(isIsoDate('2026-02-28'), true);
  assert.equal(validateDateRange('2026-07-01', '2026-07-31').days, 31);
  assert.match(validateDateRange('2026-08-01', '2026-07-01').error, /posterior/);
  assert.match(validateDateRange('2025-01-01', '2026-12-31').error, /366/);
});

test('valida una configuración institucional coherente', () => {
  const result = validatePunctualityConfig({
    nombre_jornada: 'Jornada principal',
    hora_entrada: '08:00',
    hora_limite_atraso: '08:15',
    minutos_atraso_grave: 20,
    umbral_alerta: 3,
    umbral_critico: 5
  });
  assert.equal(result.error, undefined);
  assert.equal(result.value.hora_limite_atraso, '08:15:00');
  assert.match(validatePunctualityConfig({ ...result.value, hora_entrada: '09:00' }).error, /posterior/);
});

test('calcula minutos y severidad desde el umbral configurable', () => {
  assert.equal(calculateDelayMinutes('08:15:01', '08:15:00'), 1);
  assert.equal(calculateDelayMinutes('08:34:30', '08:15:00'), 20);
  assert.deepEqual(
    calculateStatusAndSeverity('Entrada', '08:35:01', { hora_limite_atraso: '08:15:00', minutos_atraso_grave: 20 }),
    { status: 'Atrasado', severidad: 'Grave' }
  );
});

test('exige motivos suficientemente descriptivos', () => {
  assert.match(validateReason('muy corto').error, /10/);
  assert.equal(validateReason('Corrección solicitada por Inspectoría.').value, 'Corrección solicitada por Inspectoría.');
});
