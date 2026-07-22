export const PERMISSIONS = {
  PUNCTUALITY_VIEW: 'punctuality.view',
  PUNCTUALITY_REGISTER: 'punctuality.register',
  PUNCTUALITY_CORRECT: 'punctuality.correct',
  PUNCTUALITY_CANCEL: 'punctuality.cancel',
  PUNCTUALITY_JUSTIFY: 'punctuality.justify',
  REPORTS_GENERATE: 'reports.generate',
  ANALYTICS_VIEW: 'analytics.view',
  STUDENTS_VIEW: 'students.view',
  STUDENTS_MANAGE: 'students.manage',
  STUDENTS_IMPORT: 'students.import',
  USERS_MANAGE: 'users.manage',
  SETTINGS_MANAGE: 'settings.manage',
  AUDIT_VIEW: 'audit.view',
};

export const ADMIN_MODULE_PERMISSIONS = [
  PERMISSIONS.PUNCTUALITY_VIEW,
  PERMISSIONS.REPORTS_GENERATE,
  PERMISSIONS.ANALYTICS_VIEW,
  PERMISSIONS.STUDENTS_VIEW,
  PERMISSIONS.STUDENTS_MANAGE,
  PERMISSIONS.STUDENTS_IMPORT,
  PERMISSIONS.USERS_MANAGE,
  PERMISSIONS.SETTINGS_MANAGE,
  PERMISSIONS.AUDIT_VIEW,
];

export const hasPermission = (user, permission) => Array.isArray(user?.permissions)
  && user.permissions.includes(permission);

export const hasAnyPermission = (user, permissions) => permissions.some((permission) => hasPermission(user, permission));

export const roleLabel = (role) => ({
  admin: 'Administrador',
  inspector: 'Inspectoría',
  secretaria: 'Secretaría',
  direccion: 'Dirección',
  lector: 'Lector',
  personalizado: 'Personalizado',
}[role] || role || 'Usuario');

