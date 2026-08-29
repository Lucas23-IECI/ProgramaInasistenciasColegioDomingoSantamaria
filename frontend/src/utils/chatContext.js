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

export const contextMeta = (type) => ({
  SEGUIMIENTO: { label: 'caso de seguimiento', prefix: 'Seguimiento' },
  CONVIVENCIA: { label: 'caso reservado de Convivencia', prefix: 'Convivencia' },
  DOCUMENTO_ESTUDIANTE: { label: 'expediente documental', prefix: 'Expediente' },
  DOCUMENTO: { label: 'documento institucional', prefix: 'Documento' },
  ESTUDIANTE: { label: 'ficha de estudiante', prefix: 'Estudiante' },
  VISITA: { label: 'registro de visita', prefix: 'Visita' },
  RETIRO: { label: 'solicitud de retiro', prefix: 'Retiro' }
}[type] || { label: 'registro institucional', prefix: 'Coordinación' });
