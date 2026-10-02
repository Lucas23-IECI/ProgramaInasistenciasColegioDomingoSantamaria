const normalizePermissions = (permissions) => [...new Set(
  (Array.isArray(permissions) ? permissions : [])
    .filter((permission) => typeof permission === 'string')
    .map((permission) => permission.trim())
    .filter(Boolean)
)].sort();

const { getPersonalProfileSummary } = require('../services/personalProfileService');

const normalizeProfileCode = (name) => String(name || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 42);

const LEGACY_STUDENT_PRIVACY_PERMISSIONS = [
  'students.export_sensitive',
  'students.identifiers.view_sensitive'
];

const PERMISSION_DEPENDENCIES = {
  'punctuality.register.barcode': ['punctuality.register'],
  'punctuality.register.camera': ['punctuality.register'],
  'punctuality.register.manual': ['punctuality.register'],
  'punctuality.correct': ['punctuality.view'],
  'punctuality.cancel': ['punctuality.view'],
  'punctuality.justify': ['punctuality.view'],
  'reports.generate': ['punctuality.view'],
  'analytics.institutional.export': ['analytics.institutional.view'],
  'analytics.schedules.manage': ['analytics.institutional.view'],
  'students.manage': ['students.view'],
  'students.import': ['students.view'],
  'students.identity.regularize': ['students.view'],
  'students.identity.mrz': ['students.view'],
  'students.export': ['students.view'],
  'withdrawals.import_guardians': ['students.view'],
  'visits.register': ['visits.view'],
  'visits.checkout': ['visits.view'],
  'visits.manage': ['visits.view'],
  'visits.history': ['visits.view'],
  'withdrawals.register': ['visits.view'],
  'withdrawals.approve': ['visits.view'],
  'withdrawals.authorizations': ['visits.view'],
  'visits.reports': ['visits.view'],
  'visits.preregistrations.manage': ['visits.view'],
  'visits.restrictions.manage': ['visits.view'],
  'visits.deliveries.manage': ['visits.view'],
  'visits.vehicles.manage': ['visits.view'],
  'visits.emergency.view': ['visits.view'],
  'visits.emergency.manage': ['visits.view'],
  'operations.close': ['operations.view'],
  'operations.tasks.manage': ['operations.view'],
  'profiles.contact.view': ['profiles.directory.view'],
  'profiles.manage': ['profiles.directory.view'],
  'convivencia.create': ['convivencia.view'],
  'convivencia.manage': ['convivencia.view'],
  'convivencia.documents': ['convivencia.view'],
  'convivencia.close': ['convivencia.view'],
  'documents.upload': ['documents.view'],
  'documents.manage': ['documents.view'],
  'documents.sign': ['documents.view'],
  'documents.templates': ['documents.view'],
  'documents.ocr': ['documents.view'],
  'seguimiento.create': ['seguimiento.view'],
  'seguimiento.manage': ['seguimiento.view'],
  'seguimiento.assign': ['seguimiento.view'],
  'seguimiento.contacts': ['seguimiento.view'],
  'seguimiento.documents': ['seguimiento.view'],
  'seguimiento.close': ['seguimiento.view'],
  'seguimiento.automation.manage': ['seguimiento.view'],
  'chat.direct.create': ['chat.access'],
  'chat.group.create': ['chat.access'],
  'chat.channels.manage': ['chat.access'],
  'chat.urgent': ['chat.access'],
  'chat.attach': ['chat.access'],
  'chat.moderate': ['chat.access'],
  'agenda.create': ['agenda.view'],
  'resources.request': ['resources.view'],
  'resources.manage': ['resources.view'],
};

const expandPermissionDependencies = (permissions) => {
  const expanded = new Set(normalizePermissions(permissions));
  const pending = [...expanded];
  while (pending.length) {
    const permission = pending.pop();
    for (const dependency of PERMISSION_DEPENDENCIES[permission] || []) {
      if (expanded.has(dependency)) continue;
      expanded.add(dependency);
      pending.push(dependency);
    }
  }
  return [...expanded].sort();
};

const getPermissionCatalog = async (queryable) => {
  const result = await queryable.query(`
    SELECT codigo, grupo, etiqueta, descripcion, orden, critico
    FROM permisos_sistema
    WHERE codigo <> ALL($1::varchar[])
    ORDER BY orden, codigo
  `, [LEGACY_STUDENT_PRIVACY_PERMISSIONS]);
  return result.rows;
};

const getStoredRecommendedPermissions = async (queryable, role) => {
  const result = await queryable.query(`
    SELECT permiso_codigo
    FROM permisos_rol
    WHERE rol = $1 AND permiso_codigo <> ALL($2::varchar[])
    ORDER BY permiso_codigo
  `, [role, LEGACY_STUDENT_PRIVACY_PERMISSIONS]);
  return normalizePermissions(result.rows.map((row) => row.permiso_codigo));
};

const getRecommendedPermissions = async (queryable, role) => expandPermissionDependencies(
  await getStoredRecommendedPermissions(queryable, role)
);

const getAccessProfiles = async (queryable, { includeInactive = true } = {}) => {
  const result = await queryable.query(`
    SELECT p.codigo AS value,
           p.nombre AS label,
           p.descripcion AS description,
           p.sistema,
           p.activo,
           p.orden,
           COUNT(DISTINCT u.id)::int AS account_count,
           COUNT(DISTINCT u.id) FILTER (WHERE u.activo)::int AS active_account_count,
           COALESCE(
               ARRAY_AGG(DISTINCT pr.permiso_codigo ORDER BY pr.permiso_codigo)
               FILTER (WHERE pr.permiso_codigo IS NOT NULL AND pr.permiso_codigo <> ALL($2::varchar[])),
             ARRAY[]::varchar[]
           ) AS recommended_permissions
    FROM perfiles_acceso p
    LEFT JOIN usuarios u ON u.rol = p.codigo AND u.eliminado_en IS NULL
    LEFT JOIN permisos_rol pr ON pr.rol = p.codigo
    WHERE p.eliminado_en IS NULL
      AND ($1::boolean = true OR p.activo = true)
    GROUP BY p.codigo, p.nombre, p.descripcion, p.sistema, p.activo, p.orden
    ORDER BY p.activo DESC, p.orden, LOWER(p.nombre)
  `, [includeInactive, LEGACY_STUDENT_PRIVACY_PERMISSIONS]);
  return result.rows.map((profile) => ({
    ...profile,
    recommended_permissions: expandPermissionDependencies(profile.recommended_permissions),
  }));
};

const getAccessProfile = async (queryable, code, { includeInactive = false } = {}) => {
  const result = await queryable.query(`
    SELECT codigo, nombre, descripcion, sistema, activo, orden
    FROM perfiles_acceso
    WHERE codigo = $1
      AND eliminado_en IS NULL
      AND ($2::boolean = true OR activo = true)
    LIMIT 1
  `, [String(code || '').trim(), includeInactive]);
  return result.rows[0] || null;
};

const getEffectivePermissionProfile = async (queryable, userId, role) => {
  const result = await queryable.query(`
    SELECT p.codigo,
           (pr.permiso_codigo IS NOT NULL) AS recomendado,
           COALESCE(pu.concedido, pr.permiso_codigo IS NOT NULL) AS concedido
    FROM permisos_sistema p
    LEFT JOIN permisos_rol pr
      ON pr.permiso_codigo = p.codigo AND pr.rol = $2
    LEFT JOIN permisos_usuario pu
      ON pu.permiso_codigo = p.codigo AND pu.usuario_id = $1
    WHERE p.codigo <> ALL($3::varchar[])
    ORDER BY p.orden, p.codigo
  `, [userId, role, LEGACY_STUDENT_PRIVACY_PERMISSIONS]);

  return {
    permissions: expandPermissionDependencies(result.rows.filter((row) => row.concedido).map((row) => row.codigo)),
    recommended_permissions: expandPermissionDependencies(result.rows.filter((row) => row.recomendado).map((row) => row.codigo))
  };
};

const attachPermissionProfile = async (queryable, user) => {
  if (!user) return user;
  const [permissions, profile, personalProfile] = await Promise.all([
    getEffectivePermissionProfile(queryable, user.id, user.rol),
    getAccessProfile(queryable, user.rol, { includeInactive: true }),
    getPersonalProfileSummary(queryable, user.id)
  ]);
  return {
    ...user,
    ...permissions,
    profile_name: profile?.nombre || user.rol,
    profile_description: profile?.descripcion || '',
    personal_profile: personalProfile
  };
};

const validatePermissionSelection = async (queryable, permissions) => {
  if (!Array.isArray(permissions)) {
    return { error: 'La selección de permisos debe ser una lista.', permissions: [] };
  }
  const normalized = expandPermissionDependencies(permissions);
  const catalog = await getPermissionCatalog(queryable);
  const validCodes = new Set(catalog.map((permission) => permission.codigo));
  const invalid = normalized.filter((permission) => !validCodes.has(permission));
  if (invalid.length > 0) {
    return { error: `Hay permisos no reconocidos: ${invalid.join(', ')}`, permissions: [] };
  }
  return { error: null, permissions: normalized };
};

const replaceUserPermissionOverrides = async (client, { userId, role, permissions, updatedBy }) => {
  const desired = new Set(normalizePermissions(permissions));
  const recommended = new Set(await getStoredRecommendedPermissions(client, role));
  const catalog = await getPermissionCatalog(client);

  await client.query('DELETE FROM permisos_usuario WHERE usuario_id = $1', [userId]);
  for (const permission of catalog) {
    const granted = desired.has(permission.codigo);
    const isRecommended = recommended.has(permission.codigo);
    if (granted === isRecommended) continue;
    await client.query(`
      INSERT INTO permisos_usuario
        (usuario_id, permiso_codigo, concedido, actualizado_por, actualizado_en)
      VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
    `, [userId, permission.codigo, granted, updatedBy]);
  }
};

const replaceProfilePermissions = async (client, profileCode, permissions) => {
  await client.query('DELETE FROM permisos_rol WHERE rol = $1', [profileCode]);
  for (const permission of normalizePermissions(permissions)) {
    await client.query(
      'INSERT INTO permisos_rol (rol, permiso_codigo) VALUES ($1, $2)',
      [profileCode, permission]
    );
  }
};

const countActivePermissionHolders = async (queryable, permissionCode, excludedUserId = null) => {
  const result = await queryable.query(`
    SELECT COUNT(*)::int AS total
    FROM usuarios u
    WHERE u.activo = true
      AND ($2::int IS NULL OR u.id <> $2)
      AND COALESCE(
        (SELECT pu.concedido FROM permisos_usuario pu
         WHERE pu.usuario_id = u.id AND pu.permiso_codigo = $1),
        EXISTS (SELECT 1 FROM permisos_rol pr
                WHERE pr.rol = u.rol AND pr.permiso_codigo = $1)
      ) = true
  `, [permissionCode, excludedUserId]);
  return result.rows[0]?.total || 0;
};

module.exports = {
  attachPermissionProfile,
  countActivePermissionHolders,
  getAccessProfile,
  getAccessProfiles,
  getEffectivePermissionProfile,
  getPermissionCatalog,
  getRecommendedPermissions,
  expandPermissionDependencies,
  normalizePermissions,
  normalizeProfileCode,
  replaceProfilePermissions,
  replaceUserPermissionOverrides,
  validatePermissionSelection
};
