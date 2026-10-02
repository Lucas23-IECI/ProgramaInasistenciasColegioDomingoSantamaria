import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('un fallo temporal al verificar la sesión no se interpreta como cierre de sesión', () => {
  const context = read('src/context/AuthContext.jsx');
  const routes = read('src/main.jsx');

  assert.match(context, /error\.response\?\.status === 401/u);
  assert.match(context, /setSessionError\('No pudimos verificar tu sesión con el servidor\.'\)/u);
  assert.doesNotMatch(context, /catch \{\s*setUser\(null\)/u);
  assert.match(routes, /No pudimos verificar tu sesión/u);
  assert.match(routes, /Reintentar conexión/u);
  assert.match(routes, /if \(sessionError\) return <SessionVerificationError/u);
});

test('el cierre explícito y los cambios de pestaña invalidan respuestas anteriores', () => {
  const context = read('src/context/AuthContext.jsx');
  assert.match(context, /signedOutRef\.current = true/u);
  assert.match(context, /if \(signedOutRef\.current\)/u);
  assert.match(context, /probe === sessionProbeRef\.current/u);
  assert.match(context, /change\.type === 'SIGNED_IN'[\s\S]*authEpochRef\.current \+= 1/u);
  assert.match(context, /if \(logoutRequestRef\.current\) await logoutRequestRef\.current/u);
});

test('el cambio de contraseña conserva el destino interno en vez de forzar el panel', () => {
  const page = read('src/ChangePassword.jsx');
  assert.match(page, /navigate\(getSafeReturnPath\(location\.state\?\.returnTo\)/u);
  assert.match(read('src/main.jsx'), /to="\/cambiar-clave" state=\{\{ returnTo: buildReturnPath\(location\) \}\}/u);
});
