const jwt = require('jsonwebtoken');
const { ipKeyGenerator } = require('express-rate-limit');

const RATE_LIMIT_IDENTITY = Symbol('rateLimitIdentity');

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const createIdentityResolver = (jwtSecret) => (req) => {
  if (req[RATE_LIMIT_IDENTITY]) return req[RATE_LIMIT_IDENTITY];

  const token = req.cookies?.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, jwtSecret);
      if (Number.isSafeInteger(Number(decoded?.id)) && Number(decoded.id) > 0) {
        req[RATE_LIMIT_IDENTITY] = `usuario:${Number(decoded.id)}`;
        return req[RATE_LIMIT_IDENTITY];
      }
    } catch {
      // Un token inválido nunca permite evadir el límite basado en la IP real.
    }
  }

  req[RATE_LIMIT_IDENTITY] = `ip:${ipKeyGenerator(req.ip)}`;
  return req[RATE_LIMIT_IDENTITY];
};

const createApiRateLimitOptions = ({
  jwtSecret,
  authenticatedLimit = process.env.API_RATE_LIMIT_AUTHENTICATED,
  anonymousLimit = process.env.API_RATE_LIMIT_ANONYMOUS
}) => {
  if (!jwtSecret) throw new Error('jwtSecret es obligatorio para configurar el limitador de API.');

  const resolveIdentity = createIdentityResolver(jwtSecret);
  const maxAuthenticated = parsePositiveInteger(authenticatedLimit, 1800);
  const maxAnonymous = parsePositiveInteger(anonymousLimit, 300);

  return {
    windowMs: 15 * 60 * 1000,
    limit: (req) => resolveIdentity(req).startsWith('usuario:') ? maxAuthenticated : maxAnonymous,
    keyGenerator: resolveIdentity,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => {
      const requestPath = String(req.path || '');
      return requestPath === '/health'
        || requestPath.startsWith('/health/')
        || requestPath === '/auth/login'
        || requestPath === '/api/auth/login';
    },
    message: { message: 'Se alcanzó el límite temporal de solicitudes. Intente nuevamente en unos minutos.' }
  };
};

module.exports = {
  createApiRateLimitOptions,
  createIdentityResolver,
  parsePositiveInteger
};
