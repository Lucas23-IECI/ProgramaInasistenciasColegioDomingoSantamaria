const {
  VALIDATION_RESULTS,
  calculateChileanRutDv,
  normalizeChileanRut,
  validateChileanRut,
  validateIdentityDocument
} = require('./identityValidatorRegistry');

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

const normalizeStudentRut = normalizeChileanRut;
const calculateRutDv = calculateChileanRutDv;
const validateStudentRut = validateChileanRut;

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
    const validationEvidence = validateIdentityDocument({
      identityType,
      countryCode: 'CHL',
      documentOriginal: `${normalizedRut.rut}-${normalizedRut.dv}`,
      rut: normalizedRut.rut,
      dv: normalizedRut.dv
    });
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
      validationLevel: validationEvidence.validationLevel,
      validationEvidence
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
      validationLevel: 'SIN_DOCUMENTO_CIVIL',
      validationEvidence: {
        accepted: true,
        result: VALIDATION_RESULTS.DECLARED,
        validatorId: null,
        validatorVersion: null,
        errors: [],
        warnings: ['La ficha no dispone de un documento civil para validar.']
      }
    };
  }

  const documentOriginal = normalizeIdentityDocument(documentInput);
  const documentNormalized = normalizeIdentityToken(documentOriginal);
  const isIpe = identityType === MANUAL_IDENTITY_TYPES.IPE_MINEDUC;
  const resolvedCountry = isIpe ? 'CHL' : countryCode;
  const validationEvidence = validateIdentityDocument({
    identityType,
    countryCode: resolvedCountry,
    documentOriginal,
    documentNormalized
  });
  return {
    identityType,
    rut: null,
    dv: null,
    documentOriginal,
    documentNormalized,
    countryCode: resolvedCountry,
    foreignDocumentType: isIpe ? null : identityType,
    validationLevel: isIpe
      ? 'IPE_DECLARADO_MANUAL'
      : validationEvidence.validationLevel,
    validationEvidence
  };
};

const validateManualStudentIdentity = (identity, { manualDetail = '' } = {}) => {
  const errors = [];
  if (identity.identityType === MANUAL_IDENTITY_TYPES.RUN_CHILE) {
    return [...(identity.validationEvidence?.errors || [])];
  }

  if (identity.identityType === MANUAL_IDENTITY_TYPES.IPE_MINEDUC) {
    return [...(identity.validationEvidence?.errors || [])];
  }

  if (identity.identityType === MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO) {
    if (sanitizeStudentText(manualDetail, 500).length < 10) {
      errors.push('Explique en al menos 10 caracteres por qué el estudiante no dispone de documento.');
    }
    return errors;
  }

  return [...(identity.validationEvidence?.errors || [])];
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
