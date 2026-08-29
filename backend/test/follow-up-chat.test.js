const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const { collectSignals } = require('../services/institutionalFollowUpService');

test('el chat valida identificadores y retención antes de consultar la base', () => {
  const chat = read('routes/internalChat.js');
  assert.match(chat, /Number\.isSafeInteger\(Number\(value\)\)/u);
  assert.match(chat, /retentionDays !== null[\s\S]{0,180}retención de la conversación debe estar entre 30 días y 10 años/u);
  assert.match(chat, /contextId, retentionDays, req\.user\.id/u);
  assert.doesNotMatch(chat, /Number\(req\.body\.retencion_dias\) \|\| null/u);
});

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

test('las notificaciones dirigidas amplían la bandeja con permisos y trazabilidad', () => {
  const migration = read('migrations/042_notificaciones_institucionales.sql');
  const hardening = read('migrations/043_comunicaciones_hardening.sql');
  const route = read('routes/notifications.js');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS notificaciones_envios/u);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS envio_id/u);
  assert.match(migration, /'notifications\.send'/u);
  assert.match(migration, /\('direccion', 'notifications\.send'\)/u);
  assert.doesNotMatch(migration, /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/iu);
  assert.match(route, /verifyPermission\('notifications\.send'\)/u);
  assert.match(route, /ENVIAR_NOTIFICACION_INSTITUCIONAL/u);
  assert.match(route, /institutional-notification/u);
  assert.match(route, /LIMIT \$2 OFFSET \$3/u);
  assert.match(route, /WHERE n\.usuario_id = \$1/u);
  assert.match(hardening, /ALTER COLUMN detalle TYPE VARCHAR\(1000\)/u);
  assert.doesNotMatch(hardening, /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/iu);
});

test('los enlaces de avisos se mantienen dentro de la aplicación', () => {
  const { safeInternalLink } = require('../routes/notifications');
  assert.equal(safeInternalLink('/chat/15?origen=aviso'), '/chat/15?origen=aviso');
  assert.equal(safeInternalLink('https://example.org'), null);
  assert.equal(safeInternalLink('//example.org'), null);
  assert.equal(safeInternalLink('/\\example.org'), null);
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
  assert.deepEqual(calls.find((call) => /HAVING COUNT\(\*\) >= \$2::int/u.test(call.sql))?.params, [15, 3]);
  assert.equal(lateness.studentId, 41);
  assert.equal(lateness.dedupeKey, 'ATRASOS:estudiante:41');
  assert.match(lateness.reason, /15 días/u);
});

test('seguimiento detecta documentos, contacto familiar, duplicados y convivencia con origen exacto', async () => {
  const queryable = {
    query: async (sql) => {
      if (/ninguna registra un teléfono|telefono_emergencia/u.test(sql)) return { rows: [{ id_alumno: 7, estudiante: 'Ana Pérez' }] };
      if (/d\.vence_en < CURRENT_DATE/u.test(sql)) return { rows: [{ id_documento_expediente: 51, id_alumno: 7, titulo: 'Autorización anual', vence_en: new Date('2026-08-20T00:00:00Z'), estudiante: 'Ana Pérez' }] };
      if (/dias_restantes/u.test(sql)) return { rows: [{ id_documento_expediente: 52, id_alumno: 7, titulo: 'Certificado médico', vence_en: new Date('2026-08-30T00:00:00Z'), dias_restantes: 4, estudiante: 'Ana Pérez' }] };
      if (/array_agg\(id_alumno/u.test(sql)) return { rows: [{ estudiantes_ids: [7, 9], estudiante: 'Ana Pérez', fecha_nacimiento: '2014-03-01' }] };
      if (/FROM convivencia_casos c/u.test(sql)) return { rows: [{ id_caso: 81, codigo: 'CONV-81', prioridad: 'URGENTE', proxima_revision: '2026-08-26', id_alumno: 7 }] };
      return { rows: [] };
    }
  };
  const rules = new Map([
    ['CONTACTO_FAMILIAR_INCOMPLETO', { codigo: 'CONTACTO_FAMILIAR_INCOMPLETO', activa: true }],
    ['DOCUMENTO_VENCIDO', { codigo: 'DOCUMENTO_VENCIDO', activa: true }],
    ['DOCUMENTO_POR_VENCER', { codigo: 'DOCUMENTO_POR_VENCER', activa: true, ventana_dias: 30 }],
    ['POSIBLE_DUPLICADO_ESTUDIANTE', { codigo: 'POSIBLE_DUPLICADO_ESTUDIANTE', activa: true }],
    ['CONVIVENCIA_CRITICA', { codigo: 'CONVIVENCIA_CRITICA', activa: true }]
  ]);
  const detected = await collectSignals(queryable, rules);
  assert.equal(detected.find((item) => item.rule === 'CONTACTO_FAMILIAR_INCOMPLETO').data.origen.enlace, '/admin/familias?estudiante_id=7');
  assert.equal(detected.find((item) => item.rule === 'DOCUMENTO_VENCIDO').data.origen.enlace, '/admin/documentos/ficha/51');
  assert.equal(detected.find((item) => item.rule === 'DOCUMENTO_POR_VENCER').data.dias_restantes, 4);
  assert.deepEqual(detected.find((item) => item.rule === 'POSIBLE_DUPLICADO_ESTUDIANTE').relatedStudentIds, [7, 9]);
  assert.equal(detected.find((item) => item.rule === 'CONVIVENCIA_CRITICA').data.origen.permiso, 'convivencia.view');
});

test('la ampliación transversal de seguimiento es aditiva y exige revisión humana de duplicados', () => {
  const migration = read('migrations/044_seguimiento_origenes_transversales.sql');
  assert.match(migration, /CONTACTO_FAMILIAR_INCOMPLETO/u);
  assert.match(migration, /DOCUMENTO_VENCIDO/u);
  assert.match(migration, /DOCUMENTO_POR_VENCER/u);
  assert.match(migration, /POSIBLE_DUPLICADO_ESTUDIANTE/u);
  assert.match(migration, /nunca fusiona automáticamente/u);
  assert.match(migration, /CONVIVENCIA_CRITICA/u);
  assert.doesNotMatch(migration, /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM)\b/iu);
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
  assert.match(route, /El seguimiento está cerrado\. Reábrelo antes de incorporar nuevos antecedentes\./u);
  assert.ok((route.match(/loadEditableCase\(client,/gu) || []).length >= 8);
  assert.ok((route.match(/inTransaction\(pool,/gu) || []).length >= 7);
  assert.doesNotMatch(route, /await addEvent\(pool,/u);
  assert.match(route, /const response = await loadCase\(client, caseId\);\s*await client\.query\('COMMIT'\)/u);
  assert.match(route, /signals: signals\.rows/u);
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
  assert.match(service, /ciclo_deteccion/u);
  assert.match(service, /REACTIVACION_AUTOMATICA/u);
  assert.match(service, /TAREA_VENCIDA/u);
  assert.match(service, /seguimiento:tarea:/u);
});

test('las notificaciones conservan estado de entrega, lectura, fallo y reintento', () => {
  const migration = read('migrations/045_notificaciones_estado_entrega.sql');
  const route = read('routes/notifications.js');
  assert.match(migration, /estado IN \('PENDIENTE', 'ENVIADO', 'FALLIDO'\)/u);
  assert.match(migration, /destinatarios_ids JSONB/u);
  assert.match(migration, /reintento_de/u);
  assert.match(route, /router\.get\('\/enviadas\/:shipmentId'/u);
  assert.match(route, /CASE WHEN n\.leida_en IS NULL THEN 'ENTREGADA' ELSE 'LEIDA'/u);
  assert.match(route, /router\.post\('\/envios\/:shipmentId\/reintentar'/u);
  assert.match(route, /SET estado = 'FALLIDO', error_publico/u);
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
  assert.match(route, /CONTEXT_TYPES/u);
  assert.match(route, /Indica el registro institucional que se coordinará/u);
  assert.match(route, /El tipo de registro vinculado no es válido/u);
  assert.match(route, /SELECT \* FROM chat_conversaciones WHERE clave_dedupe = \$1 AND activa = true FOR UPDATE/u);
  assert.match(route, /return res\.status\(200\)\.json\(conversation\)/u);
  assert.match(route, /router\.get\('\/buscar'/u);
  assert.match(route, /router\.get\('\/eventos'/u);
  assert.match(route, /horario_silencio_desde/u);
  assert.match(route, /configuracion\/retencion\/ejecutar/u);
  assert.match(route, /router\.post\('\/conversaciones\/:conversationId\/adjuntos'/u);
  assert.match(route, /ADJUNTAR_ARCHIVO_CHAT/u);
  assert.match(route, /await client\.query\('ROLLBACK'\)/u);
  const readRoute = route.slice(
    route.indexOf("router.post('/conversaciones/:conversationId/leer'"),
    route.indexOf("router.post('/conversaciones/:conversationId/mensajes/:messageId/fijar'")
  );
  assert.match(readRoute, /await client\.query\('BEGIN'\)/u);
  assert.match(readRoute, /await client\.query\('COMMIT'\)/u);
  assert.match(readRoute, /await client\.query\('ROLLBACK'\)/u);
  assert.doesNotMatch(route, /La cuenta \$\{userId\}/u);
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
  assert.match(server, /app\.use\('\/api\/notificaciones'/u);
  assert.match(server, /startInstitutionalFollowUpScheduler/u);
  assert.match(server, /startChatRetentionScheduler/u);
  assert.match(server, /createChatRealtimeHub/u);
});
