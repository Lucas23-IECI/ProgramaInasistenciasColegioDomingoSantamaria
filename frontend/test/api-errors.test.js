import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { getApiErrorMessage, isSafeApiMessage } from '../src/utils/apiError.js';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const applicationSources = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const target = path.join(directory, entry.name);
  if (entry.isDirectory()) return applicationSources(target);
  return /\.(?:js|jsx)$/u.test(entry.name) ? [target] : [];
});

test('conserva la causa clara del servidor sin mostrar el código interno', () => {
  const error = { response: { status: 409, data: {
    code: 'SIN_CONTROL_HORARIO',
    message: 'No hay un control de puntualidad activo para este curso y horario.'
  } } };
  const message = getApiErrorMessage(error, 'No fue posible registrar el ingreso.');
  assert.equal(message, 'No hay un control de puntualidad activo para este curso y horario.');
  assert.doesNotMatch(message, /SIN_CONTROL_HORARIO/u);
});

test('distingue una caída de red de una respuesta del servidor', () => {
  assert.match(getApiErrorMessage({ code: 'ERR_NETWORK' }), /comunicarse con el servidor/u);
  assert.match(getApiErrorMessage({ code: 'ECONNABORTED' }), /tardó demasiado/u);
  assert.match(getApiErrorMessage({ response: { status: 403, data: {} } }), /no tiene permiso/u);
  assert.match(getApiErrorMessage({ response: { status: 429, data: {} } }), /demasiados intentos/u);
});

test('oculta HTML, errores de programación y consultas técnicas', () => {
  for (const technical of [
    '<html>Bad gateway</html>',
    'TypeError: Cannot read properties of undefined',
    'ERR_CONNECTION_REFUSED',
    'SELECT password FROM usuarios',
    'REGISTRO_DUPLICADO',
    'relation "usuarios" does not exist',
    "ENOENT: no such file or directory, open 'C:\\app\\secret.env'",
    'Prisma failed while reading /app/config',
    'JsonWebTokenError: jwt malformed',
    '{"error":"internal"}'
  ]) {
    assert.equal(isSafeApiMessage(technical), false);
    assert.doesNotMatch(
      getApiErrorMessage({ response: { status: 500, data: { message: technical } } }, 'No fue posible guardar.'),
      new RegExp(technical.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u')
    );
  }
});

test('las pantallas no vuelven a mostrar errores técnicos directamente', () => {
  for (const file of applicationSources(sourceRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(
      source,
      /(?:error|err|requestError)\.response\??\.data\??\.message\s*\|\|/u,
      file
    );
    assert.doesNotMatch(
      source,
      /(?:notify|setError|setErrorMsg|setFormError|setUploadError|setGuardianError)\([^\n]*(?:error|err|requestError)\.message/u,
      file
    );
  }
});

test('los estados globales no inventan el resultado ni publican detalles técnicos', () => {
  const boundary = fs.readFileSync(path.join(sourceRoot, 'components/AppErrorBoundary.jsx'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(sourceRoot, 'pwa/registerServiceWorker.js'), 'utf8');

  assert.doesNotMatch(boundary, /Los datos no se han modificado/u);
  assert.match(boundary, /verifica la última acción antes de repetirla/u);
  assert.doesNotMatch(serviceWorker, /registrationError:\s*error\.message/u);
  assert.match(serviceWorker, /El sistema puede seguir utilizándose en línea/u);
});
