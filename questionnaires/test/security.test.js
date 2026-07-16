import test from 'node:test';
import assert from 'node:assert/strict';

import { constantTimeEqual, createAdminSession, randomToken, sha256, verifyAdminSession } from '../functions/_lib/security.js';

test('los tokens tienen entropía suficiente y se almacenan como hash', async () => {
  const left = randomToken();
  const right = randomToken();
  assert.notEqual(left, right);
  assert.ok(left.length >= 40);
  assert.equal((await sha256(left)).length, 64);
});

test('las sesiones administrativas firmadas se verifican', async () => {
  const secret = 'secreto-de-prueba-con-mas-de-32-caracteres';
  const session = await createAdminSession(secret, 60);
  assert.equal(await verifyAdminSession(session, secret), true);
  assert.equal(await verifyAdminSession(`${session}alterada`, secret), false);
});

test('la comparación protegida diferencia claves', async () => {
  assert.equal(await constantTimeEqual('clave correcta', 'clave correcta'), true);
  assert.equal(await constantTimeEqual('clave correcta', 'clave incorrecta'), false);
});
