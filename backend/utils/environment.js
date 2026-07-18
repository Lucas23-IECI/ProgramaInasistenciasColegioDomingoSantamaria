const MINIMUM_SECRET_LENGTH = 32;

const isPositiveInteger = (value, minimum, maximum) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum;
};

const validateEnvironment = (environment = process.env) => {
  const errors = [];
  const warnings = [];
  const required = ['DB_USER', 'DB_HOST', 'DB_NAME', 'DB_PASSWORD', 'JWT_SECRET'];

  for (const name of required) {
    if (!String(environment[name] || '').trim()) {
      errors.push(`${name} es obligatorio.`);
    }
  }

  if (String(environment.JWT_SECRET || '').length < MINIMUM_SECRET_LENGTH) {
    errors.push(`JWT_SECRET debe tener al menos ${MINIMUM_SECRET_LENGTH} caracteres.`);
  }

  if (environment.DEFAULT_USER_PASSWORD && String(environment.DEFAULT_USER_PASSWORD).length < 12) {
    errors.push('DEFAULT_USER_PASSWORD debe tener al menos 12 caracteres.');
  }

  if (!isPositiveInteger(environment.DB_POOL_MAX || '10', 1, 50)) {
    errors.push('DB_POOL_MAX debe ser un entero entre 1 y 50.');
  }

  if (!isPositiveInteger(environment.DB_PORT || '5432', 1, 65535)) {
    errors.push('DB_PORT debe ser un puerto valido entre 1 y 65535.');
  }

  if (String(environment.DB_PASSWORD || '').length < 16) {
    warnings.push('DB_PASSWORD tiene menos de 16 caracteres; debe rotarse antes del despliegue definitivo.');
  }

  if (environment.NODE_ENV === 'production') {
    const allowedOrigins = String(environment.CORS_ORIGIN || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (allowedOrigins.length === 0) {
      errors.push('CORS_ORIGIN es obligatorio en produccion.');
    }
    if (allowedOrigins.some((origin) => origin === '*' || !/^https?:\/\//.test(origin))) {
      errors.push('CORS_ORIGIN solo puede contener origenes HTTP o HTTPS explicitos.');
    }
  }

  return { errors, warnings };
};

const assertEnvironment = (environment = process.env, logger = console) => {
  const result = validateEnvironment(environment);
  const strict = String(environment.STRICT_ENV_VALIDATION || '').toLowerCase() === 'true';
  const failures = strict ? [...result.errors, ...result.warnings] : result.errors;

  for (const warning of result.warnings) {
    logger.warn(`[CONFIGURACION] ${warning}`);
  }

  if (failures.length > 0) {
    throw new Error(`Configuracion de entorno invalida: ${failures.join(' ')}`);
  }

  return result;
};

module.exports = {
  MINIMUM_SECRET_LENGTH,
  assertEnvironment,
  validateEnvironment
};
