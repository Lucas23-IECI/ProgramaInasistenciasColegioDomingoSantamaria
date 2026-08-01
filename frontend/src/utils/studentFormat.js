export const getStudentDisplayName = (student) => {
  if (!student) return 'Persona sin nombre';
  if (student.name && String(student.name).trim()) return String(student.name).trim();

  return [student.nombres, student.paterno, student.materno]
    .map((part) => String(part || '').trim())
    .filter(Boolean)
    .join(' ') || 'Persona sin nombre';
};

export const getStudentRut = (student) => {
  if (!student?.rut) return 'RUT no informado';
  return `${student.rut}${student.dv ? `-${student.dv}` : ''}`;
};

export const getStudentIdentifier = (student) => {
  if (student?.documento_mostrado) return String(student.documento_mostrado);
  if (student?.rut) return `${student.rut}${student.dv ? `-${student.dv}` : ''}`;
  if (student?.documento_erp) return String(student.documento_erp);
  if (student?.uuid_erp) return String(student.uuid_erp);
  if (student?.codigo_barra) return String(student.codigo_barra);
  return 'Identificador no informado';
};

export const getStudentIdentifierLabel = (student) => {
  const identityType = String(student?.tipo_identificador || student?.identity?.identityType || '');
  const foreignType = String(
    student?.tipo_documento_extranjero
      || student?.identity?.foreignDocumentType
      || ''
  );

  if (identityType === 'RUN_CHILE') return 'RUN chileno';
  if (identityType === 'IPE_MINEDUC') return 'IPE Mineduc';
  if (identityType === 'DOCUMENTO_EXTRANJERO') {
    if (foreignType === 'PASAPORTE') return 'Pasaporte';
    if (foreignType === 'DNI') return 'DNI extranjero';
    if (foreignType === 'CEDULA') return 'Cédula extranjera';
    return 'Documento extranjero';
  }
  if (identityType === 'SIN_IDENTIFICADOR_MANUAL') return 'Código institucional';
  if (student?.rut) return 'RUN chileno';
  if (student?.documento_erp) return 'Documento ERP';
  if (student?.uuid_erp) return 'ID ERP';
  if (student?.codigo_barra) return 'Código institucional';
  return 'Identificador';
};

export const getStudentMaskedRut = (student) => {
  if (student?.documento_mostrado) return String(student.documento_mostrado);
  const rut = String(student?.rut || '');
  if (!rut) {
    const alternative = String(student?.documento_erp || student?.uuid_erp || '');
    if (!alternative) return 'Identificador no informado';
    if (alternative.length <= 6) return `${alternative.slice(0, 2)}***`;
    return `${alternative.slice(0, 3)}***${alternative.slice(-2)}`;
  }
  if (rut.length <= 4) return `${rut.slice(0, 1)}***${student?.dv ? `-${student.dv}` : ''}`;
  return `${rut.slice(0, 2)}.${rut.slice(2, 5)}.***${student?.dv ? `-${student.dv}` : ''}`;
};

