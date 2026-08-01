const { sanitizeStudentText, validateStudentRut } = require('./students');

const normalizeErpDocument = (value) => sanitizeStudentText(value, 64)
  .toUpperCase()
  .replace(/\s+/g, '');

const normalizeBarcodeToken = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^0-9A-Z]/g, '');

const IDENTITY_TYPES = Object.freeze({
  RUN_CHILE: 'RUN_CHILE',
  IPE_MINEDUC: 'IPE_MINEDUC',
  DOCUMENTO_EXTRANJERO: 'DOCUMENTO_EXTRANJERO',
  ID_ERP: 'ID_ERP'
});

const FOREIGN_DOCUMENT_TYPES = Object.freeze({
  PASAPORTE: 'PASAPORTE',
  DNI: 'DNI',
  CEDULA: 'CEDULA',
  OTRO: 'OTRO'
});

const hasChileanRutShape = (rutInput, dvInput = '') => {
  const rawRut = String(rutInput ?? '').trim().toUpperCase();
  const compactRut = rawRut.replace(/[^0-9K]/g, '');
  const suppliedDv = String(dvInput ?? '').trim().toUpperCase().replace(/[^0-9K]/g, '');

  if (suppliedDv && !rawRut.includes('-')) {
    return /^\d{6,8}$/.test(compactRut) && /^[0-9K]$/.test(suppliedDv);
  }

  return /^\d{6,8}[0-9K]$/.test(compactRut);
};

const normalizeForeignDocumentType = (value) => {
  const normalized = sanitizeStudentText(value, 40)
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  if (!normalized) return null;
  if (normalized.includes('PASAP')) return FOREIGN_DOCUMENT_TYPES.PASAPORTE;
  if (normalized === 'DNI' || normalized.includes('DOCUMENTO NACIONAL')) {
    return FOREIGN_DOCUMENT_TYPES.DNI;
  }
  if (normalized.includes('CEDULA') || normalized.includes('IDENTIDAD')) {
    return FOREIGN_DOCUMENT_TYPES.CEDULA;
  }
  return FOREIGN_DOCUMENT_TYPES.OTRO;
};

const normalizeCountryCode = (value) => {
  const normalized = sanitizeStudentText(value, 3).trim().toUpperCase();
  return /^[A-Z]{2,3}$/.test(normalized) ? normalized : null;
};

const isMineducProvisionalIdentifier = (value) => {
  const compact = normalizeBarcodeToken(value);
  // MINEDUC describe el antiguo "RUT 100" como un número provisorio sobre
  // 100 millones. No se valida con el módulo 11 del RUN chileno.
  return /^1\d{8}[0-9K]$/.test(compact);
};

const isStructurallyValidForeignDocument = (value) => {
  const normalized = normalizeErpDocument(value);
  return normalized.length >= 3
    && normalized.length <= 64
    && /^[0-9A-Z./-]+$/.test(normalized);
};

const getIdentityLabel = (identityType, foreignDocumentType = null) => {
  if (identityType === IDENTITY_TYPES.RUN_CHILE) return 'RUN chileno';
  if (identityType === IDENTITY_TYPES.IPE_MINEDUC) return 'IPE Mineduc';
  if (identityType === IDENTITY_TYPES.DOCUMENTO_EXTRANJERO) {
    if (foreignDocumentType === FOREIGN_DOCUMENT_TYPES.PASAPORTE) return 'Pasaporte';
    if (foreignDocumentType === FOREIGN_DOCUMENT_TYPES.DNI) return 'DNI extranjero';
    if (foreignDocumentType === FOREIGN_DOCUMENT_TYPES.CEDULA) return 'Cédula extranjera';
    return 'Documento extranjero';
  }
  return 'ID ERP';
};

const normalizeErpStudentIdentity = ({
  uuidErp,
  rutInput,
  dvInput,
  documentTypeInput,
  countryCodeInput,
  normalizeRutAndDv
}) => {
  const erpId = sanitizeStudentText(uuidErp, 100);
  const documentErp = normalizeErpDocument(rutInput);
  const foreignDocumentType = normalizeForeignDocumentType(documentTypeInput);
  const countryCode = normalizeCountryCode(countryCodeInput);
  const normalizedRut = normalizeRutAndDv(rutInput, dvInput);
  const hasValidRut = hasChileanRutShape(rutInput, dvInput)
    && validateStudentRut(normalizedRut.rut, normalizedRut.dv);
  const rut = hasValidRut ? normalizedRut.rut : null;
  const dv = hasValidRut ? normalizedRut.dv : null;
  const hasMineducIdentifier = !hasValidRut && isMineducProvisionalIdentifier(documentErp);
  const hasForeignDocument = !hasValidRut
    && !hasMineducIdentifier
    && isStructurallyValidForeignDocument(documentErp);
  const hasTrustedForeignDocumentContext = hasForeignDocument
    && Boolean(erpId || foreignDocumentType || countryCode);
  const identityType = hasValidRut
    ? IDENTITY_TYPES.RUN_CHILE
    : hasMineducIdentifier
      ? IDENTITY_TYPES.IPE_MINEDUC
      : hasForeignDocument
        ? IDENTITY_TYPES.DOCUMENTO_EXTRANJERO
        : IDENTITY_TYPES.ID_ERP;
  const canIdentify = Boolean(erpId || rut || hasMineducIdentifier || hasTrustedForeignDocumentContext);
  const barcode = hasValidRut
    ? `${rut}${dv}`
    : normalizeBarcodeToken(documentErp) || erpId;

  return {
    uuidErp: erpId || null,
    documentoErp: documentErp || null,
    rut,
    dv,
    barcode: barcode || null,
    hasValidRut,
    hasMineducIdentifier,
    hasForeignDocument,
    hasTrustedForeignDocumentContext,
    canIdentify,
    acceptedByErpId: !hasValidRut && Boolean(erpId),
    identityType,
    identityLabel: getIdentityLabel(identityType, foreignDocumentType),
    foreignDocumentType: identityType === IDENTITY_TYPES.DOCUMENTO_EXTRANJERO
      ? foreignDocumentType || FOREIGN_DOCUMENT_TYPES.OTRO
      : null,
    countryCode: identityType === IDENTITY_TYPES.DOCUMENTO_EXTRANJERO ? countryCode : null,
    validationLevel: hasValidRut
      ? 'DV_VERIFICADO'
      : hasMineducIdentifier
        ? 'FUENTE_MINEDUC_ERP'
        : hasForeignDocument
          ? 'FORMATO_Y_ORIGEN_ERP'
          : 'ID_ERP'
  };
};

module.exports = {
  FOREIGN_DOCUMENT_TYPES,
  IDENTITY_TYPES,
  getIdentityLabel,
  hasChileanRutShape,
  isMineducProvisionalIdentifier,
  isStructurallyValidForeignDocument,
  normalizeBarcodeToken,
  normalizeCountryCode,
  normalizeErpDocument,
  normalizeForeignDocumentType,
  normalizeErpStudentIdentity
};
