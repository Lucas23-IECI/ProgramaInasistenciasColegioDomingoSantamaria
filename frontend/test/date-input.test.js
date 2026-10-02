import test from 'node:test';
import assert from 'node:assert/strict';

import { localDateInputValue, localDateTimeInputValue } from '../src/utils/dateInput.js';

test('los formularios conservan la fecha y hora del dispositivo sin convertirlas a UTC', () => {
  const lateLocalTime = new Date(2026, 7, 30, 23, 45, 0);
  assert.equal(localDateInputValue(lateLocalTime), '2026-08-30');
  assert.equal(localDateTimeInputValue(lateLocalTime), '2026-08-30T23:45');
});

test('las fechas inválidas no llenan controles con valores engañosos', () => {
  assert.equal(localDateInputValue('fecha inválida'), '');
  assert.equal(localDateTimeInputValue('fecha inválida'), '');
});
