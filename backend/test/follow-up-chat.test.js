const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const { collectSignals } = require('../services/institutionalFollowUpService');

test('las migraciones de seguimiento y chat son aditivas e idempotentes', () => {
  const followUp = read('migrations/036_seguimiento_institucional.sql');
  const chat = read('migrations/037_chat_institucional.sql');
  assert.match(followUp, /CREATE TABLE IF NOT EXISTS seguimiento_casos/u);
  assert.match(followUp, /CREATE TABLE IF NOT EXISTS seguimiento_eventos/u);
  assert.match(chat, /CREATE TABLE IF NOT EXISTS chat_conversaciones/u);
  assert.match(chat, /CREATE TABLE IF NOT EXISTS chat_mensajes/u);
  assert.doesNotMatch(`${followUp}\n${chat}`, /\b(?:DROP\s+TABLE|TRUNCATE)\b/iu);
});

test('la operación programada agrega configuración y bandejas sin borrar información', () => {
  const migration = read('migrations/038_operacion_seguimiento_chat.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS seguimiento_configuracion/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS notificaciones_internas/u);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS chat_configuracion/u);
  assert.match(migration, /automatizacion_activa BOOLEAN NOT NULL DEFAULT false/u);
  assert.match(migration, /retencion_activa BOOLEAN NOT NULL DEFAULT false/u);
  assert.doesNotMatch(migration, /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/iu);
});

test('la política de Dirección aplica 3 atrasos en 15 días, plazo de 3 días y escalamiento conjunto', () => {
  const migration = read('migrations/039_politica_seguimiento_direccion.sql');
  assert.match(migration, /umbral = 3/u);
  assert.match(migration, /ventana_dias = 15/u);
  assert.match(migration, /plazo_dias = 3/u);
  assert.match(migration, /responsable_perfil_codigo = 'inspector'/u);
  assert.match(migration, /escalamiento_dias = 0/u);
  assert.match(migration, /'ATRASOS_PREVENTIVOS', 'INSPECTORIA'/u);
  assert.match(migration, /'ATRASOS_PREVENTIVOS', 'EQUIPO_GESTION'/u);
  assert.match(migration, /retencion_predeterminada_dias = 365/u);
  assert.match(migration, /retencion_activa = false/u);
  assert.doesNotMatch(migration, /\b(?:DROP\s+TABLE|TRUNCATE)\b/iu);
});

test('la detección de atrasos utiliza el umbral y la ventana configurados', async () => {
  const calls = [];
  const queryable = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (Array.isArray(params) && /HAVING COUNT\(\*\) >= \$2::int/u.test(sql)) {
        return { rows: [{ id_alumno: 41, total: 3, estudiante: 'Estudiante de prueba' }] };
      }
      return { rows: [] };
    }
  };
  const rules = new Map([['ATRASOS_PREVENTIVOS', {
    codigo: 'ATRASOS_PREVENTIVOS', activa: true, tipo_senal: 'ATRASOS',
    umbral: 3, ventana_dias: 15, prioridad: 'MEDIA'
  }]]);
  const detected = await collectSignals(queryable, rules);
  const lateness = detected.find((item) => item.rule === 'ATRASOS_PREVENTIVOS');
  assert.deepEqual(calls.find((call) => Array.isArray(call.params))?.params, [15, 3]);
  assert.equal(lateness.studentId, 41);
  assert.equal(lateness.dedupeKey, 'ATRASOS:estudiante:41');
  assert.match(lateness.reason, /15 días/u);
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

test('la automatización evita duplicados, asigna, escala y respeta su interruptor', () => {
  const service = read('services/institutionalFollowUpService.js');
  assert.match(service, /pg_advisory_xact_lock/u);
  assert.match(service, /ON CONFLICT/u);
  assert.match(service, /ROLLBACK/u);
  assert.match(service, /FOLLOW_UP_AUTOMATION_ENABLED \|\| 'true'/u);
  assert.match(service, /ASIGNACION_AUTOMATICA/u);
  assert.match(service, /ESCALAMIENTO_AUTOMATICO/u);
  assert.doesNotMatch(service, /ACTIVE_CASE_STATES[^\n]+RESUELTO/u);
  assert.match(service, /READ ONLY/u);
  assert.match(service, /previewInstitutionalFollowUp/u);
  assert.match(service, /replacementSignal/u);
});

test('los canales institucionales se sincronizan por perfiles y conservan todo el año', () => {
  const service = read('services/institutionalChannelsService.js');
  assert.match(service, /codigo_institucional/u);
  assert.match(service, /retencion_dias, creada_por/u);
  assert.match(service, /VALUES \('CANAL', \$1, \$2, 365/u);
  assert.match(service, /seguimiento_grupo_perfiles/u);
  assert.match(service, /u\.activo = true AND u\.eliminado_en IS NULL/u);
  assert.doesNotMatch(service, /DELETE\s+FROM\s+chat_/iu);
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
  assert.match(route, /router\.get\('\/eventos'/u);
  assert.match(route, /horario_silencio_desde/u);
  assert.match(route, /configuracion\/retencion\/ejecutar/u);
});

test('la retención de chat es explícita, auditable y protege mensajes fijados', () => {
  const service = read('services/chatRetentionService.js');
  assert.match(service, /retencion_activa/u);
  assert.match(service, /pg_advisory_xact_lock/u);
  assert.match(service, /chat_mensajes_fijados/u);
  assert.match(service, /Mensaje retirado por política de retención/u);
  assert.match(service, /ROLLBACK/u);
});

test('el servidor monta ambos módulos y programa la revisión preventiva', () => {
  const server = read('server.js');
  assert.match(server, /app\.use\('\/api\/seguimiento'/u);
  assert.match(server, /app\.use\('\/api\/chat'/u);
  assert.match(server, /startInstitutionalFollowUpScheduler/u);
  assert.match(server, /startChatRetentionScheduler/u);
  assert.match(server, /createChatRealtimeHub/u);
});
