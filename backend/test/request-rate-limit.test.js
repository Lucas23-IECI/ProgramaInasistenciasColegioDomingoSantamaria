const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');

const {
  createApiRateLimitOptions,
  parsePositiveInteger
} = require('../utils/requestRateLimit');

const JWT_SECRET = 'secreto-de-prueba-con-longitud-suficiente';

test('el limitador separa usuarios autenticados aunque compartan una IP', () => {
  const options = createApiRateLimitOptions({
    jwtSecret: JWT_SECRET,
    authenticatedLimit: 1800,
    anonymousLimit: 300
  });
  const sharedIp = '192.168.50.28';
  const first = {
    cookies: { token: jwt.sign({ id: 7 }, JWT_SECRET) },
    ip: sharedIp,
    path: '/students'
  };
  const second = {
    cookies: { token: jwt.sign({ id: 9 }, JWT_SECRET) },
    ip: sharedIp,
    path: '/students'
  };

  assert.equal(options.keyGenerator(first), 'usuario:7');
  assert.equal(options.keyGenerator(second), 'usuario:9');
  assert.equal(options.limit(first), 1800);
  assert.equal(options.limit(second), 1800);
});

test('el limitador usa la IP real cuando no existe una sesión válida', () => {
  const options = createApiRateLimitOptions({
    jwtSecret: JWT_SECRET,
    authenticatedLimit: 1800,
    anonymousLimit: 300
  });
  const anonymous = { cookies: {}, ip: '192.168.1.6', path: '/students' };
  const invalid = { cookies: { token: 'token-invalido' }, ip: '192.168.1.6', path: '/students' };

  assert.equal(options.keyGenerator(anonymous), 'ip:192.168.1.6');
  assert.equal(options.keyGenerator(invalid), 'ip:192.168.1.6');
  assert.equal(options.limit(anonymous), 300);
});

test('el acceso conserva su protección específica sin duplicar el límite global', () => {
  const options = createApiRateLimitOptions({ jwtSecret: JWT_SECRET });

  assert.equal(options.skip({ path: '/auth/login' }), true);
  assert.equal(options.skip({ path: '/api/auth/login' }), true);
  assert.equal(options.skip({ path: '/students' }), false);
});

test('los límites configurables rechazan valores inseguros o inválidos', () => {
  assert.equal(parsePositiveInteger('2400', 1800), 2400);
  assert.equal(parsePositiveInteger('0', 1800), 1800);
  assert.equal(parsePositiveInteger('texto', 300), 300);
});
