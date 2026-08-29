import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getRegistrationError } from '../src/utils/punctualityRegistration.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('distingue un duplicado real de la ausencia de control horario', () => {
  assert.deepEqual(getRegistrationError({ response: { data: {
    code: 'REGISTRO_DUPLICADO', message: 'Esta persona ya fue registrada en este control horario.'
  } } }), {
    duplicate: true,
    message: 'Esta persona ya fue registrada en este control horario.'
  });

  assert.deepEqual(getRegistrationError({ response: { data: {
    code: 'SIN_CONTROL_HORARIO', message: 'No hay un control de puntualidad activo para este curso y horario.'
  } } }), {
    duplicate: false,
    message: 'No hay un control de puntualidad activo para este curso y horario.'
  });
});

test('el terminal bloquea entradas online sin control y conserva la selección manual auditada', () => {
  const source = read('src/components/BarcodeScanner.jsx');
  assert.match(source, /const canAttemptRegistration = isOffline \|\| Boolean\(controlState\.actual \|\| isManualControl\)/u);
  assert.match(source, /disabled=\{!canAttemptRegistration\}/u);
  assert.match(source, /Selecciona un control horario para habilitar el registro/u);
  assert.match(source, /!res\.data\.control && !isManualControl/u);
  assert.doesNotMatch(source, /Ya registrado hoy/u);
});

test('la analítica pagina todos los cursos y enlaza sus atrasos al detalle', () => {
  const source = read('src/AnaliticasAdmin.jsx');
  assert.match(source, /COURSES_PER_PAGE = 8/u);
  assert.match(source, /coursePage/u);
  assert.doesNotMatch(source, /por_curso\.slice\(0, 8\)/u);
  assert.match(source, /openLateRecords/u);
  assert.match(source, /Ver detalle de atrasos/u);
});

test('la cola offline solo descarta conflictos que sean duplicados confirmados', () => {
  const source = read('src/pwa/offlineStore.js');
  assert.match(source, /isDuplicateRegistrationError\(error\)/u);
  assert.doesNotMatch(source, /error\?\.response\?\.status === 409/u);
});
