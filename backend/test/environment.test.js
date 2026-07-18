const test = require('node:test');
const assert = require('node:assert/strict');

const { assertEnvironment, validateEnvironment } = require('../utils/environment');

const validEnvironment = {
  DB_USER: 'ldsm_app',
  DB_HOST: 'postgres',
  DB_NAME: 'ldsm_puntualidad',
  DB_PASSWORD: 'ClaveBaseDatosSegura2026!',
  DB_PORT: '5432',
  DB_POOL_MAX: '10',
  JWT_SECRET: 'secreto-principal-con-mas-de-treinta-y-dos-caracteres',
  DEFAULT_USER_PASSWORD: 'ClaveInicial2026!',
  NODE_ENV: 'production',
  COOKIE_SECURE: 'false',
  CORS_ORIGIN: 'http://localhost,http://192.168.1.5'
};

test('acepta una configuracion de produccion explicita y segura', () => {
  assert.deepEqual(validateEnvironment(validEnvironment), { errors: [], warnings: [] });
});

test('exige declarar el transporte de la cookie y recomienda proteccion bajo HTTPS', () => {
  const missing = validateEnvironment({ ...validEnvironment, COOKIE_SECURE: '' });
  assert.match(missing.errors.join(' '), /COOKIE_SECURE/);

  const httpsWithoutSecureCookie = validateEnvironment({
    ...validEnvironment,
    CORS_ORIGIN: 'https://atrasos.ejemplo.cl',
    COOKIE_SECURE: 'false'
  });
  assert.match(httpsWithoutSecureCookie.warnings.join(' '), /HTTPS/);
});

test('rechaza secretos debiles, puertos invalidos y CORS abierto', () => {
  const result = validateEnvironment({
    ...validEnvironment,
    JWT_SECRET: 'corto',
    DB_PORT: '70000',
    CORS_ORIGIN: '*'
  });

  assert.equal(result.errors.length, 3);
  assert.match(result.errors.join(' '), /JWT_SECRET/);
  assert.match(result.errors.join(' '), /DB_PORT/);
  assert.match(result.errors.join(' '), /CORS_ORIGIN/);
});

test('permite advertencias en transicion y las convierte en error en modo estricto', () => {
  const transitional = { ...validEnvironment, DB_PASSWORD: 'corta-presente' };
  const messages = [];
  const logger = { warn: (message) => messages.push(message) };

  assert.doesNotThrow(() => assertEnvironment(transitional, logger));
  assert.equal(messages.length, 1);
  assert.throws(
    () => assertEnvironment({ ...transitional, STRICT_ENV_VALIDATION: 'true' }, logger),
    /DB_PASSWORD/
  );
});
