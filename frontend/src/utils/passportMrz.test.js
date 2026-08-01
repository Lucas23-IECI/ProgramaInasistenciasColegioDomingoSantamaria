import test from 'node:test';
import assert from 'node:assert/strict';
import { computeMrzCheckDigit, normalizeMrzInput, parsePassportTd3Mrz } from './passportMrz.js';

const VALID_TD3 = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
].join('\n');

test('valida y extrae una MRZ TD3 completa sin almacenar imágenes', () => {
  const result = parsePassportTd3Mrz(VALID_TD3);
  assert.equal(result.valid, true);
  assert.equal(result.numero_pasaporte, 'L898902C3');
  assert.equal(result.pais_emisor, 'UTO');
  assert.equal(result.nombres, 'ANNA MARIA');
  assert.equal(result.apellidos, 'ERIKSSON');
  assert.equal(result.fecha_nacimiento, '1974-08-12');
  assert.equal(result.fecha_vencimiento, '2012-04-15');
  assert.equal(Object.values(result.checks).every(Boolean), true);
});

test('rechaza una MRZ alterada aunque conserve el largo', () => {
  const altered = VALID_TD3.replace('L898902C36', 'L898902C30');
  const result = parsePassportTd3Mrz(altered);
  assert.equal(result.valid, false);
  assert.equal(result.checks.numero_pasaporte, false);
});

test('normaliza espacios y limita la entrada a dos líneas', () => {
  assert.equal(normalizeMrzInput(`  ${VALID_TD3}\nTERCERA`), VALID_TD3);
  assert.equal(computeMrzCheckDigit('L898902C3'), 6);
});
