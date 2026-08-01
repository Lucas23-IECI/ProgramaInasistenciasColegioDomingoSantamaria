const REGISTRATION_METHODS = Object.freeze({
  BARCODE: 'barcode',
  CAMERA: 'camera',
  MANUAL: 'manual'
});

const REGISTRATION_METHOD_PERMISSIONS = Object.freeze({
  [REGISTRATION_METHODS.BARCODE]: 'punctuality.register.barcode',
  [REGISTRATION_METHODS.CAMERA]: 'punctuality.register.camera',
  [REGISTRATION_METHODS.MANUAL]: 'punctuality.register.manual'
});

const normalizeRegistrationMethod = (value, legacyOrigin = 'manual') => {
  const normalized = String(value || '').trim().toLowerCase();
  if (Object.values(REGISTRATION_METHODS).includes(normalized)) return normalized;
  return String(legacyOrigin || '').trim().toLowerCase() === 'lector'
    ? REGISTRATION_METHODS.BARCODE
    : REGISTRATION_METHODS.MANUAL;
};

const getRegistrationMethodPermission = (method) => (
  REGISTRATION_METHOD_PERMISSIONS[method] || null
);

const canUseRegistrationMethod = (user, method) => {
  const permission = getRegistrationMethodPermission(method);
  return Boolean(permission && Array.isArray(user?.permissions) && user.permissions.includes(permission));
};

module.exports = {
  REGISTRATION_METHODS,
  REGISTRATION_METHOD_PERMISSIONS,
  canUseRegistrationMethod,
  getRegistrationMethodPermission,
  normalizeRegistrationMethod
};
