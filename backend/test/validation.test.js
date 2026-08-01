const test = require('node:test');
const assert = require('node:assert/strict');

const { calculateDelayMinutes, calculateStatusAndSeverity } = require('../utils/punctuality');
const {
  isIsoDate,
  validateDateRange,
  validatePunctualityConfig,
  validatePunctualityControl,
  validatePunctualityControlSet,
  validateReason
} = require('../utils/validation');

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

test('valida un control horario completo y normaliza su alcance', () => {
  const result = validatePunctualityControl({
    nombre: 'Regreso del primer recreo',
    tipo: 'REGRESO_RECREO',
    hora_apertura: '09:45',
    hora_referencia: '09:55',
    hora_inicio_atraso: '10:00',
    hora_cierre: '10:25',
    minutos_atraso_grave: 10,
    dias_semana: [5, 1, 1, 3, 2, 4],
    cursos_ids: [3, 3, 8],
    cuenta_alertas: true
  });
  assert.equal(result.error, undefined);
  assert.deepEqual(result.value.dias_semana, [1, 2, 3, 4, 5]);
  assert.deepEqual(result.value.cursos_ids, [3, 8]);
});

test('rechaza controles con ventanas invertidas o gravedad fuera del cierre', () => {
  const inverted = validatePunctualityControl({
    nombre: 'Regreso de recreo',
    tipo: 'REGRESO_RECREO',
    hora_apertura: '10:05',
    hora_referencia: '10:00',
    hora_inicio_atraso: '10:10',
    hora_cierre: '10:30',
    minutos_atraso_grave: 10,
    dias_semana: [1]
  });
  assert.match(inverted.error, /orden apertura/i);

  const severeOutside = validatePunctualityControl({
    nombre: 'Regreso de almuerzo',
    tipo: 'REGRESO_ALMUERZO',
    hora_apertura: '13:40',
    hora_referencia: '13:45',
    hora_inicio_atraso: '13:50',
    hora_cierre: '14:00',
    minutos_atraso_grave: 10,
    dias_semana: [1]
  });
  assert.match(severeOutside.error, /antes del cierre/i);
});

test('rechaza controles superpuestos para los mismos días y cursos', () => {
  const base = {
    activo: true,
    dias_semana: [1, 2, 3, 4, 5],
    cursos_ids: [],
    hora_referencia: '10:00:00',
    hora_inicio_atraso: '10:05:00',
    minutos_atraso_grave: 5
  };
  const first = {
    ...base,
    nombre: 'Regreso del primer recreo',
    hora_apertura: '09:55:00',
    hora_cierre: '10:20:00'
  };
  const second = {
    ...base,
    nombre: 'Control extraordinario',
    hora_apertura: '10:10:00',
    hora_cierre: '10:30:00'
  };

  assert.match(validatePunctualityControlSet([first, second]).error, /superponen/i);
});

test('permite controles simultáneos cuando corresponden a cursos distintos', () => {
  const common = {
    activo: true,
    dias_semana: [1],
    hora_apertura: '10:00:00',
    hora_referencia: '10:05:00',
    hora_inicio_atraso: '10:10:00',
    hora_cierre: '10:30:00',
    minutos_atraso_grave: 5
  };
  const result = validatePunctualityControlSet([
    { ...common, nombre: 'Básica', cursos_ids: [1, 2] },
    { ...common, nombre: 'Media', cursos_ids: [7, 8] }
  ]);

  assert.equal(result.error, undefined);
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
