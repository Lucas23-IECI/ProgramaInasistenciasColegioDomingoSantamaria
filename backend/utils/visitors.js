const DOCUMENT_TYPES = new Set(['RUT', 'PASAPORTE', 'OTRO']);

const cleanDocument = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[^0-9A-Z]/g, '');

const calculateRutDv = (body) => {
  let sum = 0;
  let multiplier = 2;
  for (let index = body.length - 1; index >= 0; index -= 1) {
    sum += Number(body[index]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const result = 11 - (sum % 11);
  if (result === 11) return '0';
  if (result === 10) return 'K';
  return String(result);
};

const normalizeVisitorDocument = (typeInput, valueInput) => {
  const type = String(typeInput || 'RUT').trim().toUpperCase();
  if (!DOCUMENT_TYPES.has(type)) {
    return { error: 'El tipo de documento no es válido.' };
  }

  const document = cleanDocument(valueInput);
  if (type === 'RUT') {
    if (!/^\d{6,8}[0-9K]$/.test(document)) {
      return { error: 'Escribe un RUT completo y válido.' };
    }
    const body = document.slice(0, -1).replace(/^0+/, '') || '0';
    const dv = document.slice(-1);
    if (calculateRutDv(body) !== dv) {
      return { error: 'El dígito verificador del RUT no coincide.' };
    }
    return {
      value: {
        type,
        document: `${body}${dv}`,
        body,
        dv,
        formatted: `${Number(body).toLocaleString('es-CL')}-${dv}`
      }
    };
  }

  if (document.length < 4 || document.length > 40) {
    return { error: 'El documento debe tener entre 4 y 40 caracteres.' };
  }
  return { value: { type, document, formatted: document } };
};

const normalizeName = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const normalizeChilePhone = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return { value: null };

  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('56')) digits = digits.slice(2);

  if (digits.length === 9) {
    return { value: `+56${digits}` };
  }

  if (digits.length === 8) {
    return { value: `+56${digits}` };
  }

  return { error: 'Escribe un teléfono chileno válido, con 8 o 9 dígitos.' };
};

const formatChilePhone = (value) => {
  const normalized = normalizeChilePhone(value);
  if (normalized.error || !normalized.value) return value || '';
  const local = normalized.value.slice(3);
  if (local.length === 9 && local.startsWith('9')) {
    return `+56 9 ${local.slice(1, 5)} ${local.slice(5)}`;
  }
  return `+56 ${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`.trim();
};

const validateVisitorInput = (input = {}) => {
  const documentResult = normalizeVisitorDocument(input.tipo_documento, input.documento);
  if (documentResult.error) return documentResult;

  const name = normalizeName(input.nombre_completo);
  if (name.length < 3 || name.length > 160) {
    return { error: 'El nombre completo debe tener entre 3 y 160 caracteres.' };
  }

  const phone = normalizeChilePhone(input.telefono);
  if (phone.error) return phone;

  return {
    value: {
      tipo_documento: documentResult.value.type,
      documento_numero: documentResult.value.document,
      documento_formateado: documentResult.value.formatted,
      nombre_completo: name,
      telefono: phone.value
    }
  };
};

const maskDocument = (type, value) => {
  const document = cleanDocument(value);
  if (type === 'RUT' && document.length >= 5) {
    return `${document.slice(0, 2)}••••${document.slice(-2)}`;
  }
  if (document.length <= 4) return '••••';
  return `${document.slice(0, 2)}••••${document.slice(-2)}`;
};

module.exports = {
  calculateRutDv,
  cleanDocument,
  formatChilePhone,
  maskDocument,
  normalizeChilePhone,
  normalizeVisitorDocument,
  validateVisitorInput
};
