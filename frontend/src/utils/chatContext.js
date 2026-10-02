const CONTEXT_TYPES = new Set([
  'SEGUIMIENTO',
  'CONVIVENCIA',
  'DOCUMENTO_ESTUDIANTE',
  'DOCUMENTO',
  'ESTUDIANTE',
  'VISITA',
  'RETIRO'
]);

export const safeInternalPath = (value, fallback = '/admin') => {
  const path = String(value || '').trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return fallback;
  return path;
};

export const buildContextChatUrl = ({ type, id, name, origin, originLabel }) => {
  const normalizedType = CONTEXT_TYPES.has(type) ? type : 'SEGUIMIENTO';
  const params = new URLSearchParams({
    contexto_tipo: normalizedType,
    contexto_id: String(id),
    contexto_nombre: String(name || 'Registro institucional').slice(0, 120),
    origen: safeInternalPath(origin),
    origen_etiqueta: String(originLabel || 'Volver al registro').slice(0, 80)
  });
  return `/chat?${params.toString()}`;
};

const CONTEXT_DESTINATIONS = {
  SEGUIMIENTO: (id) => ({ origin: `/admin/seguimiento/${id}`, originLabel: 'Volver al seguimiento' }),
  CONVIVENCIA: (id) => ({ origin: `/admin/convivencia/${id}`, originLabel: 'Volver al caso reservado' }),
  DOCUMENTO_ESTUDIANTE: (id) => ({ origin: `/admin/documentos/estudiante/${id}`, originLabel: 'Volver al expediente' }),
  DOCUMENTO: (id) => ({ origin: `/admin/documentos/ficha/${id}`, originLabel: 'Volver al documento' }),
  ESTUDIANTE: (id) => ({ origin: `/admin/estudiantes?estudiante_id=${id}`, originLabel: 'Volver a la ficha' }),
  VISITA: (id) => ({ origin: `/admin/visitas?tab=historial&visita_id=${id}`, originLabel: 'Volver a la visita' }),
  RETIRO: (id) => ({ origin: `/admin/visitas?tab=retiros&retiro_id=${id}`, originLabel: 'Volver al retiro' })
};

export const contextQueryFromConversation = (conversation) => {
  const type = String(conversation?.contexto_tipo || '').toUpperCase();
  const id = String(conversation?.contexto_id || '').trim();
  if (!CONTEXT_TYPES.has(type) || !id) return '';
  const destination = CONTEXT_DESTINATIONS[type](encodeURIComponent(id));
  return buildContextChatUrl({
    type,
    id,
    name: conversation.titulo || conversation.conversacion_nombre || conversation.nombre || 'Registro institucional',
    ...destination
  }).slice('/chat'.length);
};

export const contextMeta = (type) => ({
  SEGUIMIENTO: { label: 'caso de seguimiento', prefix: 'Seguimiento' },
  CONVIVENCIA: { label: 'caso reservado de Convivencia', prefix: 'Convivencia' },
  DOCUMENTO_ESTUDIANTE: { label: 'expediente documental', prefix: 'Expediente' },
  DOCUMENTO: { label: 'documento institucional', prefix: 'Documento' },
  ESTUDIANTE: { label: 'ficha de estudiante', prefix: 'Estudiante' },
  VISITA: { label: 'registro de visita', prefix: 'Visita' },
  RETIRO: { label: 'solicitud de retiro', prefix: 'Retiro' }
}[type] || { label: 'registro institucional', prefix: 'Coordinación' });
