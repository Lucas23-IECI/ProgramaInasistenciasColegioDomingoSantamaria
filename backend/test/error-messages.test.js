const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSource = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
const authMiddlewareSource = fs.readFileSync(path.join(__dirname, '../middleware/auth.js'), 'utf8');
const profileRouteSource = fs.readFileSync(path.join(__dirname, '../routes/profiles.js'), 'utf8');
const safeErrorRoutes = ['coexistence.js', 'followUp.js', 'internalChat.js', 'notifications.js', 'studentDocuments.js']
  .map((file) => fs.readFileSync(path.join(__dirname, '../routes', file), 'utf8'));

test('los fallos globales de la API devuelven causas seguras en JSON', () => {
  assert.match(serverSource, /app\.use\('\/api', \(req, res\) =>/u);
  assert.match(serverSource, /entity\.parse\.failed/u);
  assert.match(serverSource, /entity\.too\.large/u);
  assert.match(serverSource, /CORS_ORIGIN_DENIED/u);
  assert.match(serverSource, /Esta dirección no está autorizada para conectarse al sistema/u);
  assert.match(serverSource, /El servidor no pudo completar la acción/u);
});

test('los errores de sesión no exponen tokens ni cookies', () => {
  assert.doesNotMatch(authMiddlewareSource, /message:\s*['"][^'"]*(?:token|cookie)/iu);
  assert.match(authMiddlewareSource, /Tu sesión venció o ya no es válida/u);
  assert.match(authMiddlewareSource, /La cuenta está desactivada/u);
  assert.match(authMiddlewareSource, /res\.status\(503\).*servicio no está disponible temporalmente/u);
  assert.match(authMiddlewareSource, /\[sesion:validar\]/u);
});

test('los conflictos de persistencia no publican el mensaje técnico de la base', () => {
  for (const source of safeErrorRoutes) {
    assert.match(source, /clientStatus/u);
    assert.doesNotMatch(source, /status >= 500 \? fallback : error\.message/u);
  }
});

test('los perfiles solo publican errores de validación conocidos', () => {
  assert.match(profileRouteSource, /PROFILE_VALIDATION_MESSAGES\.has\(error\.message\)/u);
  assert.match(profileRouteSource, /PROFILE_IMAGE_VALIDATION_MESSAGES\.has\(error\.message\)/u);
  assert.doesNotMatch(profileRouteSource, /\/estado\|vigencia\/i\.test\(error\.message\)/u);
});
