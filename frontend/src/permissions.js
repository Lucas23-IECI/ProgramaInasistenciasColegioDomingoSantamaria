export const PERMISSIONS = {
  PUNCTUALITY_VIEW: 'punctuality.view',
  PUNCTUALITY_REGISTER: 'punctuality.register',
  PUNCTUALITY_REGISTER_BARCODE: 'punctuality.register.barcode',
  PUNCTUALITY_REGISTER_CAMERA: 'punctuality.register.camera',
  PUNCTUALITY_REGISTER_MANUAL: 'punctuality.register.manual',
  PUNCTUALITY_CORRECT: 'punctuality.correct',
  PUNCTUALITY_CANCEL: 'punctuality.cancel',
  PUNCTUALITY_JUSTIFY: 'punctuality.justify',
  PUNCTUALITY_CONTROLS_OVERRIDE: 'punctuality.controls.override',
  PUNCTUALITY_CONTROLS_MANAGE: 'punctuality.controls.manage',
  REPORTS_GENERATE: 'reports.generate',
  ANALYTICS_VIEW: 'analytics.view',
  STUDENTS_VIEW: 'students.view',
  STUDENTS_MANAGE: 'students.manage',
  STUDENTS_IMPORT: 'students.import',
  STUDENTS_IDENTITY_REGULARIZE: 'students.identity.regularize',
  STUDENTS_EXPORT: 'students.export',
  STUDENTS_EXPORT_SENSITIVE: 'students.export_sensitive',
  STUDENTS_IDENTIFIERS_VIEW_SENSITIVE: 'students.identifiers.view_sensitive',
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view',
  VISITS_VIEW: 'visits.view',
  VISITS_REGISTER: 'visits.register',
  VISITS_CHECKOUT: 'visits.checkout',
  VISITS_MANAGE: 'visits.manage',
  VISITS_HISTORY: 'visits.history',
  WITHDRAWALS_REGISTER: 'withdrawals.register',
  WITHDRAWALS_APPROVE: 'withdrawals.approve',
  WITHDRAWALS_AUTHORIZATIONS: 'withdrawals.authorizations',
  WITHDRAWALS_IMPORT_GUARDIANS: 'withdrawals.import_guardians',
  VISITS_REPORTS: 'visits.reports',
  VISITS_SETTINGS: 'visits.settings',
  OPERATIONS_VIEW: 'operations.view',
  OPERATIONS_CLOSE: 'operations.close',
  FAMILY_MANAGE: 'family.manage',
};

export const ADMIN_MODULE_PERMISSIONS = [
  PERMISSIONS.PUNCTUALITY_VIEW,
  PERMISSIONS.PUNCTUALITY_CONTROLS_MANAGE,
  PERMISSIONS.REPORTS_GENERATE,
  PERMISSIONS.ANALYTICS_VIEW,
  PERMISSIONS.STUDENTS_VIEW,
  PERMISSIONS.STUDENTS_MANAGE,
  PERMISSIONS.STUDENTS_IMPORT,
  PERMISSIONS.STUDENTS_IDENTITY_REGULARIZE,
  PERMISSIONS.STUDENTS_EXPORT,
  PERMISSIONS.STUDENTS_EXPORT_SENSITIVE,
  PERMISSIONS.STUDENTS_IDENTIFIERS_VIEW_SENSITIVE,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.AUDIT_VIEW,
  PERMISSIONS.VISITS_VIEW,
  PERMISSIONS.VISITS_REGISTER,
  PERMISSIONS.VISITS_CHECKOUT,
  PERMISSIONS.VISITS_MANAGE,
  PERMISSIONS.VISITS_HISTORY,
  PERMISSIONS.WITHDRAWALS_REGISTER,
  PERMISSIONS.WITHDRAWALS_APPROVE,
  PERMISSIONS.WITHDRAWALS_AUTHORIZATIONS,
  PERMISSIONS.WITHDRAWALS_IMPORT_GUARDIANS,
  PERMISSIONS.VISITS_REPORTS,
  PERMISSIONS.VISITS_SETTINGS,
  PERMISSIONS.OPERATIONS_VIEW,
  PERMISSIONS.OPERATIONS_CLOSE,
  PERMISSIONS.FAMILY_MANAGE,
];

export const hasPermission = (user, permission) => Array.isArray(user?.permissions)
  && user.permissions.includes(permission);

export const hasAnyPermission = (user, permissions) => permissions.some((permission) => hasPermission(user, permission));

const REGISTRATION_METHOD_PERMISSIONS = [
  PERMISSIONS.PUNCTUALITY_REGISTER_BARCODE,
  PERMISSIONS.PUNCTUALITY_REGISTER_CAMERA,
  PERMISSIONS.PUNCTUALITY_REGISTER_MANUAL,
];

export const hasRegistrationMethodPermission = (user, permission) => {
  if (hasPermission(user, permission)) return true;
  const hasGranularPermissions = REGISTRATION_METHOD_PERMISSIONS.some((candidate) => hasPermission(user, candidate));
  return !hasGranularPermissions && hasPermission(user, PERMISSIONS.PUNCTUALITY_REGISTER);
};

export const roleLabel = (role) => ({
  admin: 'Administrador',
  inspector: 'Inspectoría',
  secretaria: 'Secretaría',
  direccion: 'Dirección',
  lector: 'Lector',
  personalizado: 'Personalizado',
}[role] || role || 'Usuario');

