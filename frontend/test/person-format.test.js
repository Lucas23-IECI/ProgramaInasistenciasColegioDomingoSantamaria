import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatChilePhoneInput,
  formatRutInput,
} from '../src/utils/personFormat.js';

test('el formulario presenta RUT y teléfono progresivamente', () => {
  assert.equal(formatRutInput('123456785'), '12.345.678-5');
  assert.equal(formatRutInput('12.345.678-k'), '12.345.678-K');
  assert.equal(formatChilePhoneInput('987654321'), '+56 9 8765 4321');
  assert.equal(formatChilePhoneInput('+56 41 234 5678'), '+56 41 234 5678');
});
