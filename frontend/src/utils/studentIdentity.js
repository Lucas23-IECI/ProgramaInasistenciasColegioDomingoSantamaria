import { formatRutInput, validateRutInput } from './personFormat.js';

export const MANUAL_IDENTITY_TYPES = Object.freeze({
  RUN_CHILE: 'RUN_CHILE',
  IPE_MINEDUC: 'IPE_MINEDUC',
  PASAPORTE: 'PASAPORTE',
  DNI: 'DNI',
  CEDULA: 'CEDULA',
  SIN_DOCUMENTO: 'SIN_DOCUMENTO',
});

export const manualIdentityOptions = [
  { value: MANUAL_IDENTITY_TYPES.RUN_CHILE, label: 'RUN chileno' },
  { value: MANUAL_IDENTITY_TYPES.IPE_MINEDUC, label: 'IPE de Mineduc' },
  { value: MANUAL_IDENTITY_TYPES.PASAPORTE, label: 'Pasaporte' },
  { value: MANUAL_IDENTITY_TYPES.DNI, label: 'DNI extranjero' },
  { value: MANUAL_IDENTITY_TYPES.CEDULA, label: 'Cédula extranjera' },
  { value: MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO, label: 'Sin documento disponible' },
];

export const countryOptions = [
  { value: 'ARG', label: 'Argentina' },
  { value: 'BOL', label: 'Bolivia' },
  { value: 'BRA', label: 'Brasil' },
  { value: 'CHN', label: 'China' },
  { value: 'COL', label: 'Colombia' },
  { value: 'CUB', label: 'Cuba' },
  { value: 'DOM', label: 'República Dominicana' },
  { value: 'ECU', label: 'Ecuador' },
  { value: 'ESP', label: 'España' },
  { value: 'HTI', label: 'Haití' },
  { value: 'MEX', label: 'México' },
  { value: 'PAN', label: 'Panamá' },
  { value: 'PRY', label: 'Paraguay' },
  { value: 'PER', label: 'Perú' },
  { value: 'URY', label: 'Uruguay' },
  { value: 'USA', label: 'Estados Unidos' },
  { value: 'VEN', label: 'Venezuela' },
  { value: 'OTRO', label: 'Otro país' },
];

const foreignTypes = new Set([
  MANUAL_IDENTITY_TYPES.PASAPORTE,
  MANUAL_IDENTITY_TYPES.DNI,
  MANUAL_IDENTITY_TYPES.CEDULA,
]);

export const isForeignManualIdentity = (type) => foreignTypes.has(type);

export const getManualIdentityLabel = (type) => (
  manualIdentityOptions.find((option) => option.value === type)?.label || 'Identificador'
);

export const formatManualIdentityDocument = (type, value) => {
  if (type === MANUAL_IDENTITY_TYPES.RUN_CHILE) return formatRutInput(value);
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, '')
    .slice(0, 64);
};

export const validateManualIdentityForm = ({
  tipo_identificador: type,
  documento,
  pais_emisor: countryCode,
  pais_emisor_otro: otherCountryCode,
}) => {
  if (type === MANUAL_IDENTITY_TYPES.RUN_CHILE) {
    return validateRutInput(documento) ? '' : 'El RUN ingresado no es válido.';
  }
  if (type === MANUAL_IDENTITY_TYPES.IPE_MINEDUC) {
    const compact = String(documento || '').toUpperCase().replace(/[^0-9K]/g, '');
    return /^1\d{8}[0-9K]$/.test(compact)
      ? ''
      : 'Ingrese el IPE provisorio entregado por Mineduc.';
  }
  if (type === MANUAL_IDENTITY_TYPES.SIN_DOCUMENTO) return '';

  const compact = String(documento || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (compact.length < 3) return 'Ingrese el número completo del documento extranjero.';
  if (!countryCode) return 'Seleccione el país emisor del documento.';
  if (countryCode === 'OTRO' && !/^[A-Z]{3}$/.test(String(otherCountryCode || '').trim().toUpperCase())) {
    return 'Ingrese el código ISO de tres letras del país emisor.';
  }
  return '';
};

export const resolveManualIdentityCountry = ({
  pais_emisor: countryCode,
  pais_emisor_otro: otherCountryCode,
}) => (
  countryCode === 'OTRO'
    ? String(otherCountryCode || '').trim().toUpperCase()
    : countryCode
);
