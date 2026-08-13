export const emptyVisitor = {
  tipo_documento: 'RUT',
  documento: '',
  nombre_completo: '',
  telefono: ''
};

export const emptyVisit = {
  visitante: { ...emptyVisitor },
  motivo_codigo: '',
  motivo_detalle: '',
  destino_codigo: '',
  persona_contactada: '',
  salida_esperada_en: '',
  observaciones: '',
  origen: 'MANUAL'
};

export const emptyWithdrawal = {
  visitante: { ...emptyVisitor },
  id_alumno: '',
  motivo_codigo: '',
  motivo_detalle: '',
  parentesco_declarado_codigo: '',
  parentesco_declarado_detalle: ''
};

export const emptyAuthorization = {
  visitante: { ...emptyVisitor },
  parentesco_codigo: '',
  parentesco_detalle: '',
  es_principal: false,
  origen_autorizacion: '',
  vigente_desde: '',
  vigente_hasta: ''
};

export const isoDate = (date) => date.toISOString().slice(0, 10);
export const todayIso = () => isoDate(new Date());
export const daysAgoIso = (days) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDate(date);
};

export const formatDateTime = (value) => value
  ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : '—';

export const formatDate = (value) => value
  ? new Intl.DateTimeFormat('es-CL', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value))
  : 'sin fecha';

export const studentName = (student) => [student?.nombres, student?.paterno, student?.materno].filter(Boolean).join(' ');

export const stateLabel = (state) => ({
  DENTRO: 'Dentro',
  FINALIZADA: 'Finalizada',
  ANULADA: 'Anulada',
  RECHAZADA: 'Rechazada',
  SOLICITADO: 'Pendiente',
  AUTORIZADO: 'Autorizado',
  RECHAZADO: 'Rechazado',
  ENTREGADO: 'Entregado',
  CANCELADO: 'Cancelado'
}[state] || state);

export const requestConfig = { withCredentials: true };
