const SYSTEM_ROLES = new Set(['admin', 'secretaria', 'lector']);
const SENSITIVE_HEADER_KEYS = new Set([
  'contrasena',
  'password',
  'clave',
  'pass'
]);

const normalizeKey = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const sanitizeSnapshotRow = (row) => Object.fromEntries(
  Object.entries(row || {}).filter(([key]) => !SENSITIVE_HEADER_KEYS.has(normalizeKey(key)))
);

const validateSystemRole = (role) => SYSTEM_ROLES.has(role);

const validatePassword = (password) => {
  if (typeof password !== 'string' || password.length < 12) {
    return 'La contraseña debe tener al menos 12 caracteres.';
  }
  if (!/[a-záéíóúñ]/.test(password) || !/[A-ZÁÉÍÓÚÑ]/.test(password) || !/\d/.test(password)) {
    return 'La contraseña debe incluir mayúsculas, minúsculas y al menos un número.';
  }
  return null;
};

module.exports = {
  SYSTEM_ROLES,
  sanitizeSnapshotRow,
  validatePassword,
  validateSystemRole
};

