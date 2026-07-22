const normalizePermissions = (permissions) => [...new Set(
  (Array.isArray(permissions) ? permissions : [])
    .filter((permission) => typeof permission === 'string')
    .map((permission) => permission.trim())
    .filter(Boolean)
)].sort();

const normalizeProfileCode = (name) => String(name || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 42);

const getPermissionCatalog = async (queryable) => {
  const result = await queryable.query(`
    SELECT codigo, grupo, etiqueta, descripcion, orden, critico
    FROM permisos_sistema
    ORDER BY orden, codigo
  `);
  return result.rows;
};

const getRecommendedPermissions = async (queryable, role) => {
  const result = await queryable.query(`
    SELECT permiso_codigo
    FROM permisos_rol
    WHERE rol = $1
    ORDER BY permiso_codigo
  `, [role]);
  return result.rows.map((row) => row.permiso_codigo);
};

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
               FILTER (WHERE pr.permiso_codigo IS NOT NULL),
             ARRAY[]::varchar[]
           ) AS recommended_permissions
    FROM perfiles_acceso p
    LEFT JOIN usuarios u ON u.rol = p.codigo
    LEFT JOIN permisos_rol pr ON pr.rol = p.codigo
    WHERE ($1::boolean = true OR p.activo = true)
    GROUP BY p.codigo, p.nombre, p.descripcion, p.sistema, p.activo, p.orden
    ORDER BY p.activo DESC, p.orden, LOWER(p.nombre)
  `, [includeInactive]);
  return result.rows;
};

const getAccessProfile = async (queryable, code, { includeInactive = false } = {}) => {
  const result = await queryable.query(`
    SELECT codigo, nombre, descripcion, sistema, activo, orden
    FROM perfiles_acceso
    WHERE codigo = $1 AND ($2::boolean = true OR activo = true)
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
    ORDER BY p.orden, p.codigo
  `, [userId, role]);

  return {
    permissions: result.rows.filter((row) => row.concedido).map((row) => row.codigo),
    recommended_permissions: result.rows.filter((row) => row.recomendado).map((row) => row.codigo)
  };
};

const attachPermissionProfile = async (queryable, user) => {
  if (!user) return user;
  const [permissions, profile] = await Promise.all([
    getEffectivePermissionProfile(queryable, user.id, user.rol),
    getAccessProfile(queryable, user.rol, { includeInactive: true })
  ]);
  return {
    ...user,
    ...permissions,
    profile_name: profile?.nombre || user.rol,
    profile_description: profile?.descripcion || ''
  };
};

const validatePermissionSelection = async (queryable, permissions) => {
  if (!Array.isArray(permissions)) {
    return { error: 'La selección de permisos debe ser una lista.', permissions: [] };
  }
  const normalized = normalizePermissions(permissions);
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
  const recommended = new Set(await getRecommendedPermissions(client, role));
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
  normalizePermissions,
  normalizeProfileCode,
  replaceProfilePermissions,
  replaceUserPermissionOverrides,
  validatePermissionSelection
};
