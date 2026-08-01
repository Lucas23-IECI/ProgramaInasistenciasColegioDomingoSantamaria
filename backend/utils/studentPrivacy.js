const SENSITIVE_IDENTIFIER_PERMISSION = 'students.identifiers.view_sensitive';

const clean = (value) => String(value ?? '').trim();

const grouped = (value) => String(value || '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const maskRun = (value) => {
  const normalized = clean(value).toUpperCase().replace(/[^0-9K]/g, '');
  if (normalized.length < 2) return 'RUN protegido';
  const body = normalized.slice(0, -1);
  if (body.length <= 3) return `${'*'.repeat(body.length)}-*`;
  const formatted = grouped(body);
  return `${formatted.slice(0, -3)}***-*`;
};

const maskIdentifierValue = (typeInput, valueInput) => {
  const type = clean(typeInput).toUpperCase();
  const value = clean(valueInput);
  if (!value) return 'Identificador protegido';

  if (['RUN', 'RUT', 'RUN_CHILE'].includes(type)) return maskRun(value);

  const compact = value.toUpperCase().replace(/\s+/g, '');
  if (['PASAPORTE', 'DNI', 'CEDULA', 'DOCUMENTO_EXTRANJERO'].includes(type)) {
    if (compact.length <= 4) return '*'.repeat(compact.length);
    return `${compact.slice(0, 2)}${'*'.repeat(Math.max(4, compact.length - 4))}${compact.slice(-2)}`;
  }
  if (type === 'IPE_MINEDUC' || type === 'IPE') {
    return compact.length <= 5
      ? '*'.repeat(compact.length)
      : `${compact.slice(0, 3)}${'*'.repeat(Math.max(3, compact.length - 5))}${compact.slice(-2)}`;
  }
  if (['ID_ERP', 'UUID_ERP'].includes(type) || compact.includes('-')) {
    return compact.length <= 8
      ? '*'.repeat(compact.length)
      : `${compact.slice(0, 4)}…${compact.slice(-4)}`;
  }
  if (compact.length <= 4) return '*'.repeat(compact.length);
  return `${'*'.repeat(Math.max(4, compact.length - 4))}${compact.slice(-4)}`;
};

const resolvePrimaryIdentifier = (student = {}) => {
  const type = clean(student.tipo_identificador).toUpperCase();
  if (student.rut) return { type: 'RUN_CHILE', value: `${student.rut}${student.dv || ''}` };
  if (student.documento_erp) return { type: type || 'ID_ERP', value: student.documento_erp };
  if (student.uuid_erp) return { type: 'UUID_ERP', value: student.uuid_erp };
  if (student.codigo_barra) return { type: 'CODIGO_BARRAS', value: student.codigo_barra };
  return { type: type || 'IDENTIFICADOR', value: '' };
};

const protectStudentRecord = (student, { reveal = false } = {}) => {
  if (!student || typeof student !== 'object') return student;
  const result = { ...student };
  const primary = resolvePrimaryIdentifier(student);
  result.documento_mostrado = reveal
    ? clean(primary.value) || 'Identificador no informado'
    : maskIdentifierValue(primary.type, primary.value);
  result.identificadores_protegidos = !reveal;

  if (!reveal) {
    for (const field of [
      'rut', 'dv', 'documento_erp', 'uuid_erp', 'codigo_barra',
      'nombre_usuario', 'rut_apoderado', 'valor_original', 'valor_normalizado'
    ]) delete result[field];
  }
  return result;
};

const protectStudentIdentifier = (identifier, { reveal = false } = {}) => {
  if (!identifier || typeof identifier !== 'object') return identifier;
  const result = { ...identifier };
  result.valor_mostrado = reveal
    ? clean(identifier.valor_original || identifier.valor_normalizado)
    : maskIdentifierValue(identifier.tipo, identifier.valor_original || identifier.valor_normalizado);
  result.protegido = !reveal;
  if (!reveal) {
    delete result.valor_original;
    delete result.valor_normalizado;
  }
  return result;
};

const protectIdentityRegularization = (regularization, { reveal = false } = {}) => {
  if (!regularization || typeof regularization !== 'object') return regularization;
  const result = { ...regularization };
  result.identificador_anterior_mostrado = reveal
    ? clean(regularization.identificador_anterior)
    : maskIdentifierValue('IDENTIFICADOR', regularization.identificador_anterior);
  result.identificador_nuevo_mostrado = reveal
    ? clean(regularization.identificador_nuevo)
    : maskIdentifierValue('RUN_CHILE', regularization.identificador_nuevo);
  if (!reveal) {
    delete result.identificador_anterior;
    delete result.identificador_nuevo;
  }
  return result;
};

const canRevealStudentIdentifiers = (user) => Array.isArray(user?.permissions)
  && user.permissions.includes(SENSITIVE_IDENTIFIER_PERMISSION);

module.exports = {
  SENSITIVE_IDENTIFIER_PERMISSION,
  canRevealStudentIdentifiers,
  maskIdentifierValue,
  protectIdentityRegularization,
  protectStudentIdentifier,
  protectStudentRecord
};
