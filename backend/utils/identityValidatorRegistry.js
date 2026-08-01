const VALIDATION_RESULTS = Object.freeze({
  VERIFIED: 'VERIFICADO',
  STRUCTURAL: 'ESTRUCTURAL',
  DECLARED: 'DECLARADO',
  SYSTEM: 'SISTEMA',
  PENDING: 'PENDIENTE',
  REJECTED: 'RECHAZADO'
});

const normalizeDocumentToken = (value) => String(value || '')
  .trim()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toUpperCase()
  .replace(/[^0-9A-Z]/g, '');

const normalizeCountryCode = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
};

const normalizeChileanRut = (rutInput, dvInput = '') => {
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

const calculateChileanRutDv = (rut) => {
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

const validateChileanRut = (rutInput, dvInput = '') => {
  const normalized = normalizeChileanRut(rutInput, dvInput);
  if (!/^\d{6,8}$/.test(normalized.rut) || !/^[0-9K]$/.test(normalized.dv)) return false;
  return calculateChileanRutDv(normalized.rut) === normalized.dv;
};

const normalizeSelector = (value, fallback = '*') => {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized || fallback;
};

const createIdentityValidatorRegistry = () => {
  const validators = new Map();
  const definitions = new Map();

  const register = ({ id, version, identityTypes, countries = ['*'], validate }) => {
    const normalizedId = String(id || '').trim();
    const normalizedVersion = String(version || '').trim();
    const types = [...new Set((identityTypes || []).map((type) => normalizeSelector(type, '')))]
      .filter(Boolean);
    const countrySelectors = [...new Set((countries || ['*']).map((country) => normalizeSelector(country)))]
      .filter(Boolean);

    if (!normalizedId || !normalizedVersion || types.length === 0 || typeof validate !== 'function') {
      throw new Error('La definición del validador de identidad está incompleta.');
    }
    if (definitions.has(normalizedId)) {
      throw new Error(`El validador ${normalizedId} ya se encuentra registrado.`);
    }

    const definition = Object.freeze({
      id: normalizedId,
      version: normalizedVersion,
      identityTypes: Object.freeze(types),
      countries: Object.freeze(countrySelectors),
      validate
    });

    for (const type of types) {
      for (const country of countrySelectors) {
        const key = `${type}:${country}`;
        if (validators.has(key)) {
          throw new Error(`Ya existe un validador para ${type} y ${country}.`);
        }
        validators.set(key, definition);
      }
    }
    definitions.set(normalizedId, definition);
    return definition;
  };

  const resolve = ({ identityType, countryCode }) => {
    const type = normalizeSelector(identityType, '');
    const country = normalizeCountryCode(countryCode) || '*';
    if (!type) return null;
    return validators.get(`${type}:${country}`)
      || validators.get(`${type}:*`)
      || validators.get(`*:${country}`)
      || validators.get('*:*')
      || null;
  };

  const validate = (input = {}) => {
    const identityType = normalizeSelector(input.identityType, '');
    const countryCode = normalizeCountryCode(input.countryCode);
    const definition = resolve({ identityType, countryCode });
    const normalizedDocument = normalizeDocumentToken(
      input.documentOriginal || input.documentNormalized || input.document || ''
    );

    if (!definition) {
      return {
        accepted: false,
        result: VALIDATION_RESULTS.PENDING,
        validationLevel: 'SIN_VALIDADOR_CONFIGURADO',
        validatorId: null,
        validatorVersion: null,
        normalizedDocument,
        countryCode,
        errors: ['No existe un validador configurado para este tipo de documento y país.'],
        warnings: []
      };
    }

    const rawResult = definition.validate({
      ...input,
      identityType,
      countryCode,
      normalizedDocument
    }) || {};
    const errors = Array.isArray(rawResult.errors) ? rawResult.errors.filter(Boolean) : [];
    const warnings = Array.isArray(rawResult.warnings) ? rawResult.warnings.filter(Boolean) : [];
    const accepted = rawResult.accepted !== false && errors.length === 0;

    return Object.freeze({
      accepted,
      result: accepted
        ? rawResult.result || VALIDATION_RESULTS.STRUCTURAL
        : rawResult.result || VALIDATION_RESULTS.REJECTED,
      validationLevel: rawResult.validationLevel || (accepted
        ? 'FORMATO_VALIDADO'
        : 'VALIDACION_RECHAZADA'),
      validatorId: definition.id,
      validatorVersion: definition.version,
      normalizedDocument: rawResult.normalizedDocument || normalizedDocument,
      countryCode: rawResult.countryCode || countryCode,
      errors,
      warnings
    });
  };

  const list = () => [...definitions.values()].map((definition) => ({
    id: definition.id,
    version: definition.version,
    identityTypes: [...definition.identityTypes],
    countries: [...definition.countries]
  }));

  return Object.freeze({ register, resolve, validate, list });
};

const createDefaultIdentityValidatorRegistry = () => {
  const registry = createIdentityValidatorRegistry();

  registry.register({
    id: 'cl.run.modulo11',
    version: '1.0.0',
    identityTypes: ['RUN_CHILE'],
    countries: ['CHL'],
    validate: ({ documentOriginal, document, rut, dv }) => {
      const normalized = normalizeChileanRut(rut || documentOriginal || document, dv);
      const accepted = validateChileanRut(normalized.rut, normalized.dv);
      return {
        accepted,
        result: accepted ? VALIDATION_RESULTS.VERIFIED : VALIDATION_RESULTS.REJECTED,
        validationLevel: accepted ? 'DV_VERIFICADO' : 'DV_INVALIDO',
        normalizedDocument: `${normalized.rut}${normalized.dv}`,
        countryCode: 'CHL',
        errors: accepted ? [] : ['El RUN chileno no es válido.']
      };
    }
  });

  registry.register({
    id: 'cl.mineduc.ipe.estructura',
    version: '1.0.0',
    identityTypes: ['IPE_MINEDUC'],
    countries: ['CHL'],
    validate: ({ normalizedDocument }) => {
      const accepted = /^1\d{8}[0-9K]$/.test(normalizedDocument);
      return {
        accepted,
        result: accepted ? VALIDATION_RESULTS.STRUCTURAL : VALIDATION_RESULTS.REJECTED,
        validationLevel: accepted ? 'ESTRUCTURA_IPE_VALIDADA' : 'ESTRUCTURA_IPE_INVALIDA',
        countryCode: 'CHL',
        errors: accepted ? [] : ['El IPE debe corresponder a un identificador provisorio de Mineduc.'],
        warnings: accepted
          ? ['La estructura del IPE no reemplaza la comprobación con la fuente oficial de Mineduc.']
          : []
      };
    }
  });

  registry.register({
    id: 'global.documento.estructural',
    version: '1.0.0',
    identityTypes: ['PASAPORTE', 'DNI', 'CEDULA', 'DOCUMENTO_EXTRANJERO'],
    countries: ['*'],
    validate: ({ normalizedDocument, countryCode }) => {
      const errors = [];
      if (!/^[0-9A-Z]{3,64}$/.test(normalizedDocument)) {
        errors.push('El documento extranjero debe contener entre 3 y 64 letras o números.');
      }
      if (!countryCode) errors.push('Seleccione el país emisor del documento extranjero.');
      return {
        accepted: errors.length === 0,
        result: errors.length === 0 ? VALIDATION_RESULTS.STRUCTURAL : VALIDATION_RESULTS.REJECTED,
        validationLevel: errors.length === 0
          ? 'FORMATO_Y_PAIS_DECLARADO'
          : 'FORMATO_O_PAIS_INVALIDO',
        errors,
        warnings: errors.length === 0
          ? ['La validación estructural no acredita la autenticidad del documento extranjero.']
          : []
      };
    }
  });

  registry.register({
    id: 'sistema.identificador.interno',
    version: '1.0.0',
    identityTypes: ['ID_ERP', 'CODIGO_INTERNO', 'CODIGO_BARRAS'],
    countries: ['*'],
    validate: ({ normalizedDocument }) => {
      const accepted = normalizedDocument.length >= 2;
      return {
        accepted,
        result: accepted ? VALIDATION_RESULTS.SYSTEM : VALIDATION_RESULTS.REJECTED,
        validationLevel: accepted ? 'IDENTIFICADOR_SISTEMA' : 'IDENTIFICADOR_SISTEMA_INVALIDO',
        errors: accepted ? [] : ['El identificador interno no es válido.']
      };
    }
  });

  return registry;
};

const defaultIdentityValidatorRegistry = createDefaultIdentityValidatorRegistry();
const validateIdentityDocument = (input) => defaultIdentityValidatorRegistry.validate(input);

module.exports = {
  VALIDATION_RESULTS,
  calculateChileanRutDv,
  createDefaultIdentityValidatorRegistry,
  createIdentityValidatorRegistry,
  defaultIdentityValidatorRegistry,
  normalizeChileanRut,
  normalizeCountryCode,
  normalizeDocumentToken,
  validateChileanRut,
  validateIdentityDocument
};
