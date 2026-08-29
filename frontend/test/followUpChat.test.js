import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildContextChatUrl, safeInternalPath } from '../src/utils/chatContext.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('seguimiento institucional ofrece operación completa y coordinación', () => {
  const source = read('src/InstitutionalFollowUp.jsx');
  assert.match(source, /Nuevo seguimiento/u);
  assert.match(source, /Derivar a Convivencia/u);
  assert.match(source, /Abrir chat del caso/u);
  assert.match(source, /Adjuntar documento/u);
  assert.match(source, /Completar/u);
  assert.match(source, /vencidos/u);
  assert.match(source, /sin_responsable/u);
  assert.match(source, /Configurar reglas/u);
  assert.match(source, /Revisar ahora/u);
  assert.match(source, /automatizaciones\/previsualizar/u);
  assert.match(source, /Confirmar creación de seguimientos/u);
  assert.match(source, /No pudimos cargar los seguimientos/u);
  assert.match(source, /No pudimos cargar este seguimiento/u);
  assert.match(source, /loadSequenceRef/u);
  assert.match(source, /sequence !== loadSequenceRef\.current/u);
  assert.match(source, /role="alert"/u);
  assert.match(source, /Reintentar/u);
  assert.match(source, /No fue posible completar la tarea/u);
  assert.match(source, /canManage && !closed/u);
  assert.match(source, /Antecedente exacto/u);
  assert.match(source, /Abrir registro de origen/u);
  assert.match(source, /source\.permiso/u);
  assert.match(source, /legacySourceForCase/u);
  assert.match(source, /visita_id\).*Registro de visita/u);
  assert.match(source, /retiro_id\).*Solicitud de retiro/u);
  assert.match(source, /buildContextChatUrl/u);
  assert.match(source, /origin: `\/admin\/seguimiento\/\$\{caseId\}`/u);
  assert.match(source, /originLabel: 'Volver al seguimiento'/u);
  assert.match(source, /CloseCaseDialog/u);
  assert.match(source, /aria-labelledby="close-follow-up-title"/u);
  assert.match(source, /El historial y las tareas pendientes se conservarán/u);
  assert.doesNotMatch(source, /window\.prompt/u);
});

test('la configuración permite seleccionar equipos de escalamiento sin reasignar el caso', () => {
  const source = read('src/components/FollowUpAutomationDialog.jsx');
  assert.match(source, /escalamiento_grupos/u);
  assert.match(source, /Equipos avisados al escalar/u);
  assert.match(source, /El responsable original conserva el caso/u);
  assert.match(source, /min="0"/u);
  assert.match(source, /0 escala al vencer/u);
  assert.match(source, /No pudimos cargar las reglas/u);
  assert.match(source, /setLoadAttempt/u);
});

test('chat interno incluye búsquedas, menciones, urgencia y adjuntos', () => {
  const source = read('src/InternalChat.jsx');
  assert.match(source, /Buscar conversaciones o mensajes/u);
  assert.match(source, /Mencionar a/u);
  assert.match(source, /menciones/u);
  assert.match(source, /Marcar como urgente/u);
  assert.match(source, /Adjuntar archivo/u);
  assert.match(source, /contexto_tipo/u);
  assert.match(source, /ChatSettingsPanel/u);
  assert.match(source, /ChatRetentionDialog/u);
  assert.match(source, /subscribeToChatRealtime/u);
  assert.match(source, /\/conversaciones\/\$\{conversationId\}\/adjuntos/u);
  assert.match(source, /chat-day-separator/u);
  assert.match(source, /downloadAttachment/u);
  assert.match(source, /Cargar mensajes anteriores/u);
  assert.match(source, /antes_de: firstMessageId/u);
  assert.match(source, /La conversación cargó, pero no fue posible actualizar su estado de lectura/u);
  assert.match(source, /previousTop \+ element\.scrollHeight - previousHeight/u);
  assert.doesNotMatch(source, /mensajes\/\$\{message\.data\.id_mensaje\}\/adjuntos/u);
});

test('el chat contextual conserva un retorno interno seguro y cubre los módulos operativos', () => {
  const url = buildContextChatUrl({
    type: 'RETIRO',
    id: 27,
    name: 'Retiro de estudiante',
    origin: '/admin/visitas?tab=retiros&retiro_id=27',
    originLabel: 'Volver al retiro'
  });
  assert.match(url, /^\/chat\?/u);
  assert.match(url, /contexto_tipo=RETIRO/u);
  assert.match(url, /retiro_id%3D27/u);
  assert.equal(safeInternalPath('https://sitio-externo.example'), '/admin');
  assert.equal(safeInternalPath('//sitio-externo.example'), '/admin');
  assert.equal(safeInternalPath('/admin/convivencia/8'), '/admin/convivencia/8');

  const chat = read('src/InternalChat.jsx');
  assert.match(chat, /chat-context-banner/u);
  assert.match(chat, /contextualQuery/u);
  assert.match(chat, /onReturnToOrigin/u);
  assert.match(chat, /searchParams\.get\('contexto_id'\) && !conversationId/u);
  assert.match(read('src/SchoolCoexistence.jsx'), /type: 'CONVIVENCIA'/u);
  assert.match(read('src/StudentDocuments.jsx'), /type: 'DOCUMENTO_ESTUDIANTE'/u);
  assert.match(read('src/StudentDocuments.jsx'), /type: 'DOCUMENTO'/u);
  assert.match(read('src/features/students/StudentDetailDrawer.jsx'), /type: 'ESTUDIANTE'/u);
  assert.match(read('src/features/visits/VisitsView.jsx'), /type: "VISITA"/u);
  assert.match(read('src/features/visits/VisitsView.jsx'), /type: "RETIRO"/u);
  assert.match(read('src/features/visits/VisitsView.jsx'), /Antecedente exacto del seguimiento/u);
  assert.match(read('src/features/visits/useVisitsController.js'), /id: requestedVisitId \|\| undefined/u);
  assert.match(read('src/features/visits/useVisitsController.js'), /id: requestedWithdrawalId \|\| undefined/u);
  assert.match(read('src/features/visits/useVisitsController.js'), /filteredWithdrawals/u);
});

test('las rutas y herramientas globales exponen los dos módulos protegidos', () => {
  const main = read('src/main.jsx');
  const tools = read('src/components/GlobalTools.jsx');
  assert.match(main, /\/admin\/seguimiento\/:caseId/u);
  assert.match(main, /\/chat\/:conversationId/u);
  assert.match(tools, /\/api\/chat\/resumen/u);
  assert.match(tools, /mensajes sin leer/u);
  assert.match(tools, /NotificationCenter/u);
  assert.match(tools, /showChatNotification/u);
});

test('Dirección puede enviar avisos dirigidos y toda cuenta tiene bandeja en tiempo real', () => {
  const center = read('src/components/NotificationCenter.jsx');
  const composer = read('src/components/NotificationComposer.jsx');
  const history = read('src/components/NotificationHistoryDialog.jsx');
  const realtime = read('src/pwa/institutionalNotifications.js');
  const permissions = read('src/permissions.js');
  assert.match(center, /\/api\/notificaciones/u);
  assert.match(center, /subscribeToInstitutionalNotifications/u);
  assert.match(center, /Página \{page\} de \{pages\}/u);
  assert.match(composer, /\/api\/notificaciones\/envios/u);
  assert.match(composer, /Seleccionar visibles/u);
  assert.match(composer, /El envío quedará registrado en auditoría/u);
  assert.match(composer, /loadError/u);
  assert.match(composer, /Reintentar/u);
  assert.match(composer, /aria-modal="true"/u);
  assert.match(realtime, /institutional-notification/u);
  assert.match(permissions, /NOTIFICATIONS_SEND: 'notifications\.send'/u);
  assert.match(center, /quiet: true/u);
  assert.match(center, /openRealtimeNotification/u);
  assert.match(center, /global-notifications-panel__error/u);
  assert.match(center, /setLoadError\(message\)/u);
  assert.match(center, /Reintentar/u);
  assert.match(center, /loadError[\s\S]*notifications\.length === 0/u);
  assert.match(center, /Historial/u);
  assert.match(history, /Historial de notificaciones/u);
  assert.match(history, /\/enviadas\/\$\{shipment\.id_envio\}/u);
  assert.match(history, /\/reintentar/u);
  assert.match(history, /Entregada/u);
  assert.match(composer, /initialRecipients/u);
  assert.match(read('src/InternalChat.jsx'), /loadSequenceRef/u);
  assert.match(read('src/InternalChat.jsx'), /sequence !== loadSequenceRef\.current/u);
});

test('las preferencias y la retención explican el alcance institucional', () => {
  const settings = read('src/components/ChatSettingsPanel.jsx');
  const retention = read('src/components/ChatRetentionDialog.jsx');
  assert.match(settings, /Horario de silencio/u);
  assert.match(settings, /Silenciar excepcionalmente/u);
  assert.match(settings, /Integrantes/u);
  assert.match(retention, /política institucional aprobada/u);
  assert.match(retention, /mensajes vencidos/u);
  assert.match(retention, /Aplicar ahora/u);
});

test('ambos módulos tienen adaptación móvil explícita', () => {
  const followUp = read('src/styles/follow-up.css');
  const chat = read('src/styles/internal-chat.css');
  assert.match(followUp, /@media \(max-width: 560px\)/u);
  assert.match(chat, /@media \(max-width: 760px\)/u);
  assert.match(chat, /chat-mobile-back/u);
});

test('las novedades y ayudas explican ambos módulos', () => {
  const tours = read('src/help/tours.js');
  const notes = read('src/releaseNotes.js');
  assert.match(tours, /Recorrido de seguimiento institucional/u);
  assert.match(tours, /Recorrido del chat interno/u);
  assert.match(tours, /solo previsualiza las condiciones detectadas/u);
  assert.match(tours, /permite volver directamente/u);
  assert.match(tours, /política de retención permanece desactivada/u);
  assert.match(notes, /Seguimiento institucional/u);
  assert.match(notes, /Chat interno vinculado al trabajo/u);
});

test('Convivencia explica sus avisos automáticos y mantiene ayuda completa en lista y ficha', () => {
  const source = read('src/SchoolCoexistence.jsx');
  const tours = read('src/help/tours.js');
  assert.match(source, /coexistence-alerts/u);
  assert.match(source, /Una revisión vencida avisa a su responsable/u);
  assert.match(source, /permiso para consultar Convivencia/u);
  assert.match(source, /coexistence-filters/u);
  assert.match(source, /coexistence-facts/u);
  assert.match(source, /coexistence-protected-data/u);
  assert.match(tours, /Avisos automáticos y privados/u);
  assert.match(tours, /evita repetir el mismo aviso mientras el problema siga abierto/u);
  assert.match(tours, /Responsabilidad y próxima revisión/u);
  assert.match(tours, /Personas y documentos protegidos/u);
});
