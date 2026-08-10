const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('las migraciones de seguimiento y chat son aditivas e idempotentes', () => {
  const followUp = read('migrations/036_seguimiento_institucional.sql');
  const chat = read('migrations/037_chat_institucional.sql');
  assert.match(followUp, /CREATE TABLE IF NOT EXISTS seguimiento_casos/u);
  assert.match(followUp, /CREATE TABLE IF NOT EXISTS seguimiento_eventos/u);
  assert.match(chat, /CREATE TABLE IF NOT EXISTS chat_conversaciones/u);
  assert.match(chat, /CREATE TABLE IF NOT EXISTS chat_mensajes/u);
  assert.doesNotMatch(`${followUp}\n${chat}`, /\b(?:DROP\s+TABLE|TRUNCATE)\b/iu);
});

test('seguimiento aplica permisos, transacciones, documentos y filtros operativos', () => {
  const route = read('routes/followUp.js');
  assert.match(route, /verifyPermission\('seguimiento\.view'\)/u);
  assert.match(route, /verifyPermission\('seguimiento\.manage'\)/u);
  assert.match(route, /verifyPermission\('seguimiento\.documents'\)/u);
  assert.match(route, /BEGIN/u);
  assert.match(route, /ROLLBACK/u);
  assert.match(route, /vencidos/u);
  assert.match(route, /sin_responsable/u);
  assert.match(route, /escalar-convivencia/u);
  assert.match(route, /completada_por=CASE WHEN \$3::varchar='COMPLETADA' THEN \$4::integer/u);
});

test('la automatización evita duplicados y ejecuciones paralelas', () => {
  const service = read('services/institutionalFollowUpService.js');
  assert.match(service, /pg_advisory_xact_lock/u);
  assert.match(service, /ON CONFLICT/u);
  assert.match(service, /ROLLBACK/u);
  assert.match(service, /FOLLOW_UP_AUTOMATION_ENABLED \|\| 'false'/u);
});

test('el chat exige membresía y conserva trazabilidad institucional', () => {
  const route = read('routes/internalChat.js');
  assert.match(route, /requireMembership/u);
  assert.match(route, /chat_menciones/u);
  assert.match(route, /chat_lecturas/u);
  assert.match(route, /MODERAR_MENSAJE_CHAT/u);
  assert.match(route, /DESCARGAR_ADJUNTO_CHAT/u);
  assert.match(route, /contexto_tipo/u);
  assert.match(route, /SELECT \* FROM chat_conversaciones WHERE clave_dedupe = \$1 AND activa = true FOR UPDATE/u);
  assert.match(route, /return res\.status\(200\)\.json\(conversation\)/u);
  assert.match(route, /router\.get\('\/buscar'/u);
});

test('el servidor monta ambos módulos y programa la revisión preventiva', () => {
  const server = read('server.js');
  assert.match(server, /app\.use\('\/api\/seguimiento'/u);
  assert.match(server, /app\.use\('\/api\/chat'/u);
  assert.match(server, /startInstitutionalFollowUpScheduler/u);
});
