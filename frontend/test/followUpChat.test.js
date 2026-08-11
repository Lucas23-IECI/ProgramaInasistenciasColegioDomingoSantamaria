import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
});

test('la configuración permite seleccionar equipos de escalamiento sin reasignar el caso', () => {
  const source = read('src/components/FollowUpAutomationDialog.jsx');
  assert.match(source, /escalamiento_grupos/u);
  assert.match(source, /Equipos avisados al escalar/u);
  assert.match(source, /El responsable original conserva el caso/u);
  assert.match(source, /min="0"/u);
  assert.match(source, /0 escala al vencer/u);
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
});

test('las rutas y herramientas globales exponen los dos módulos protegidos', () => {
  const main = read('src/main.jsx');
  const tools = read('src/components/GlobalTools.jsx');
  assert.match(main, /\/admin\/seguimiento\/:caseId/u);
  assert.match(main, /\/chat\/:conversationId/u);
  assert.match(tools, /\/api\/chat\/resumen/u);
  assert.match(tools, /mensajes sin leer/u);
  assert.match(tools, /\/api\/seguimiento\/notificaciones/u);
  assert.match(tools, /showChatNotification/u);
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
  assert.match(notes, /Seguimiento institucional/u);
  assert.match(notes, /Chat interno vinculado al trabajo/u);
});
