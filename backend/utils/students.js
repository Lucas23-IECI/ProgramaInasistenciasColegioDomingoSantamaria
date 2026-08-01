const sanitizeStudentText = (value, maxLength = 100) => String(value ?? '')
  .trim()
  .replace(/\s+/g, ' ')
  .slice(0, maxLength);

const MANUAL_IDENTITY_TYPES = Object.freeze({
  RUN_CHILE: 'RUN_CHILE',
  IPE_MINEDUC: 'IPE_MINEDUC',
  PASAPORTE: 'PASAPORTE',
  DNI: 'DNI',
  CEDULA: 'CEDULA',
  SIN_DOCUMENTO: 'SIN_DOCUMENTO'
});

const normalizeIdentityDocument = (value, maxLength = 64) => sanitizeStudentText(value, maxLength)
  .toUpperCase()
  .replace(/\s+/g, '');

const normalizeIdentityToken = (value) => normalizeIdentityDocument(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^0-9A-Z]/g, '');

const normalizeManualIdentityType = (value, fallbackToRun = true) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (Object.values(MANUAL_IDENTITY_TYPES).includes(normalized)) return normalized;
  return fallbackToRun ? MANUAL_IDENTITY_TYPES.RUN_CHILE : '';
};

const normalizeStudentRut = (rutInput, dvInput = '') => {
  const suppliedDv = String(dvInput ?? '').trim().toUpperCase().replace(/[^0-9K]/g, '').slice(0, 1);
  const compact = String(rutInput ?? '').trim().toUpperCase().replace(/[^0-9K]/g, '');

  if (!compact) return { rut: '', dv: '' };
  if (suppliedDv) {
    return {
      rut: compact.replace(/\D/g, '').slice(0, 8),
      dv: suppliedDv
    };
  }

  return {
    rut: compact.slice(0, -1).replace(/\D/g, '').slice(0, 8),
    dv: compact.slice(-1)
  };
};

const calculateRutDv = (rut) => {
  let sum = 0;
  let multiplier = 2;
  const digits = String(rut ?? '').replace(/\D/g, '');

  for (let index = digits.length - 1; index >= 0; index -= 1) {
    sum += Number(digits[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const result = 11 - (sum % 11);
  if (result === 11) return '0';
  if (result === 10) return 'K';
  return String(result);
};

const validateStudentRut = (rutInput, dvInput = '') => {
  const normalized = normalizeStudentRut(rutInput, dvInput);
  if (!/^\d{6,8}$/.test(normalized.rut) || !/^[0-9K]$/.test(normalized.dv)) return false;
  return calculateRutDv(normalized.rut) === normalized.dv;
};

const normalizeManualStudentIdentity = (payload = {}) => {
  const identityType = normalizeManualIdentityType(
    payload.tipo_identificador || payload.identity_type,
    true
  );
  const documentInput = payload.documento ?? payload.document_number ?? payload.rut ?? '';
  const countryCode = sanitizeStudentText(
    payload.pais_emisor ?? payload.country_code ?? '',
    3
  ).toUpperCase();

  if (identityType === MANUAL_IDENTITY_TYPES.RUN_CHILE) {
    const normalizedRut = normalizeStudentRut(documentInput, payload.dv);
    return {
      identityType,
      rut: normalizedRut.rut,
      dv: normalizedRut.dv,
      documentOriginal: normalizedRut.rut && normalizedRut.dv
        ? `${normalizedRut.rut}-${normalizedRut.dv}`
        : '',
      documentNormalized: `${normalizedRut.rut}${normalizedRut.dv}`,
      countryCode: 'CHL',
      foreignDocumentType: null,
      validationLevel: 'DV_VERIFICADO'
    };
  }

  if (identityType === MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO) {
    return {
      identityType,
      rut: null,
      dv: null,
      documentOriginal: '',
      documentNormalized: '',
      countryCode: null,
      foreignDocumentType: null,
      validationLevel: 'SIN_DOCUMENTO_CIVIL'
    };
  }

  const documentOriginal = normalizeIdentityDocument(documentInput);
  const documentNormalized = normalizeIdentityToken(documentOriginal);
  const isIpe = identityType === MANUAL_IDENTITY_TYPES.IPE_MINEDUC;
  return {
    identityType,
    rut: null,
    dv: null,
    documentOriginal,
    documentNormalized,
    countryCode: isIpe ? 'CHL' : countryCode,
    foreignDocumentType: isIpe ? null : identityType,
    validationLevel: isIpe
      ? 'IPE_DECLARADO_MANUAL'
      : 'FORMATO_Y_PAIS_DECLARADO'
  };
};

const validateManualStudentIdentity = (identity, { manualDetail = '' } = {}) => {
  const errors = [];
  if (identity.identityType === MANUAL_IDENTITY_TYPES.RUN_CHILE) {
    if (!validateStudentRut(identity.rut, identity.dv)) {
      errors.push('El RUN chileno no es válido.');
    }
    return errors;
  }

  if (identity.identityType === MANUAL_IDENTITY_TYPES.IPE_MINEDUC) {
    if (!/^1\d{8}[0-9K]$/.test(identity.documentNormalized)) {
      errors.push('El IPE debe corresponder a un identificador provisorio de Mineduc.');
    }
    return errors;
  }

  if (identity.identityType === MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO) {
    if (sanitizeStudentText(manualDetail, 500).length < 10) {
      errors.push('Explique en al menos 10 caracteres por qué el estudiante no dispone de documento.');
    }
    return errors;
  }

  if (!/^[0-9A-Z]{3,64}$/.test(identity.documentNormalized)) {
    errors.push('El documento extranjero debe contener entre 3 y 64 letras o números.');
  }
  if (!/^[A-Z]{3}$/.test(identity.countryCode || '')) {
    errors.push('Seleccione el país emisor del documento extranjero.');
  }
  return errors;
};

const normalizeStudentPayload = (payload = {}) => {
  const normalizedRut = normalizeStudentRut(payload.rut, payload.dv);
  return {
    rut: normalizedRut.rut,
    dv: normalizedRut.dv,
    nombres: sanitizeStudentText(payload.nombres),
    paterno: sanitizeStudentText(payload.paterno),
    materno: sanitizeStudentText(payload.materno),
    email: sanitizeStudentText(payload.email, 150).toLowerCase(),
    telefono: sanitizeStudentText(payload.telefono, 30),
    grade: sanitizeStudentText(payload.grade, 100),
    motivo: sanitizeStudentText(payload.motivo, 300)
  };
};

const validateStudentPayload = (student, { requireRut = true, requireGrade = true } = {}) => {
  const errors = [];
  if (requireRut && !validateStudentRut(student.rut, student.dv)) errors.push('El RUT chileno no es válido.');
  if (!student.nombres) errors.push('Los nombres son obligatorios.');
  if (!student.paterno) errors.push('El apellido paterno es obligatorio.');
  if (requireGrade && !student.grade) errors.push('Debe seleccionar un curso existente.');
  if (student.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student.email)) errors.push('El correo electrónico no es válido.');
  if (student.telefono && student.telefono.replace(/\D/g, '').length < 8) errors.push('El teléfono no es válido.');
  return errors;
};

module.exports = {
  MANUAL_IDENTITY_TYPES,
  calculateRutDv,
  normalizeManualStudentIdentity,
  normalizeManualIdentityType,
  normalizeStudentPayload,
  normalizeStudentRut,
  sanitizeStudentText,
  validateManualStudentIdentity,
  validateStudentPayload,
  validateStudentRut
};
