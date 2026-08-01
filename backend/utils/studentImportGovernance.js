const normalizeComparable = (value) => {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

const FIELD_RULES = [
  ['uuid_erp', 'Identificador ERP', 'identity'],
  ['rut', 'RUT', 'identity'],
  ['dv', 'DV', 'identity'],
  ['documento_erp', 'Documento informado por ERP', 'identity'],
  ['tipo_identificador', 'Tipo de identificador', 'identity'],
  ['tipo_documento_extranjero', 'Tipo de documento extranjero', 'identity'],
  ['pais_emisor_documento', 'País emisor', 'identity'],
  ['nombres', 'Nombres', 'identity'],
  ['paterno', 'Apellido paterno', 'identity'],
  ['materno', 'Apellido materno', 'identity'],
  ['fecha_nacimiento', 'Fecha de nacimiento', 'identity'],
  ['email', 'Correo', 'erp'],
  ['telefono', 'Teléfono', 'erp'],
  ['rol', 'Rol', 'erp'],
  ['seccion', 'Sección', 'erp'],
  ['genero', 'Género', 'erp'],
  ['nombre_usuario', 'Usuario ERP', 'erp'],
  ['rut_apoderado', 'RUT apoderado', 'erp'],
  ['grade', 'Curso', 'erp']
];

const compareStudentFields = (incoming, current) => FIELD_RULES.map(([field, label, policy]) => {
  const currentValue = current?.[field] ?? null;
  const incomingValue = incoming?.[field] ?? null;
  const currentNormalized = normalizeComparable(currentValue);
  const incomingNormalized = normalizeComparable(incomingValue);
  let decision = 'SIN_CAMBIOS';

  if (!incomingNormalized) decision = currentNormalized ? 'CONSERVAR_ACTUAL' : 'SIN_DATOS';
  else if (!currentNormalized) decision = 'ACTUALIZAR_DESDE_ERP';
  else if (incomingNormalized !== currentNormalized) {
    decision = policy === 'identity' ? 'REVISAR_CONFLICTO' : 'ACTUALIZAR_DESDE_ERP';
  }

  return {
    field,
    label,
    current: currentValue,
    incoming: incomingValue,
    decision,
    blocking: decision === 'REVISAR_CONFLICTO'
  };
});

const detectIdentifierCollision = ({
  rutMatch,
  uuidMatch,
  documentMatch,
  identifierMatches = []
}) => {
  const matches = [
    rutMatch,
    uuidMatch,
    documentMatch,
    ...identifierMatches
  ].filter(Boolean);
  const studentIds = new Set(matches.map((match) => Number(match.id_alumno)));
  if (studentIds.size <= 1) return null;
  return {
    code: 'COLISION_IDENTIFICADORES',
    blocking: true,
    message: 'Los identificadores de la fila apuntan a fichas distintas. La importación se bloqueó para evitar unir personas diferentes.'
  };
};

const validateImportMode = (value) => (
  String(value || '').toUpperCase() === 'COMPLETA' ? 'COMPLETA' : 'PARCIAL'
);

module.exports = {
  FIELD_RULES,
  compareStudentFields,
  detectIdentifierCollision,
  normalizeComparable,
  validateImportMode
};
