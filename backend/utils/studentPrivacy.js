const clean = (value) => String(value ?? '').trim();

const grouped = (value) => String(value || '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const formatRun = (value) => {
  const normalized = clean(value).toUpperCase().replace(/[^0-9K]/g, '');
  if (normalized.length < 2) return clean(value);
  return `${grouped(normalized.slice(0, -1))}-${normalized.slice(-1)}`;
};

// Nombre conservado por compatibilidad con consumidores existentes. Los
// identificadores estudiantiles se muestran completos por decisión institucional.
const maskIdentifierValue = (typeInput, valueInput) => {
  const type = clean(typeInput).toUpperCase();
  const value = clean(valueInput);
  if (!value) return 'Identificador no informado';
  if (['RUN', 'RUT', 'RUN_CHILE'].includes(type)) return formatRun(value);
  return value;
};

const resolvePrimaryIdentifier = (student = {}) => {
  const type = clean(student.tipo_identificador).toUpperCase();
  if (student.rut) return { type: 'RUN_CHILE', value: `${student.rut}${student.dv || ''}` };
  if (student.documento_erp) return { type: type || 'ID_ERP', value: student.documento_erp };
  if (student.uuid_erp) return { type: 'UUID_ERP', value: student.uuid_erp };
  if (student.codigo_barra) return { type: 'CODIGO_BARRAS', value: student.codigo_barra };
  return { type: type || 'IDENTIFICADOR', value: '' };
};

const protectStudentRecord = (student) => {
  if (!student || typeof student !== 'object') return student;
  const result = { ...student };
  const primary = resolvePrimaryIdentifier(student);
  result.documento_mostrado = maskIdentifierValue(primary.type, primary.value);
  result.identificadores_protegidos = false;
  return result;
};

const protectStudentIdentifier = (identifier) => {
  if (!identifier || typeof identifier !== 'object') return identifier;
  const result = { ...identifier };
  result.valor_mostrado = maskIdentifierValue(
    identifier.tipo,
    identifier.valor_original || identifier.valor_normalizado
  );
  result.protegido = false;
  return result;
};

const protectIdentityRegularization = (regularization) => {
  if (!regularization || typeof regularization !== 'object') return regularization;
  const result = { ...regularization };
  result.identificador_anterior_mostrado = clean(regularization.identificador_anterior);
  result.identificador_nuevo_mostrado = maskIdentifierValue('RUN_CHILE', regularization.identificador_nuevo);
  return result;
};

module.exports = {
  maskIdentifierValue,
  protectIdentityRegularization,
  protectStudentIdentifier,
  protectStudentRecord
};
