const jwt = require('jsonwebtoken');

const pool = require('../db');
const { getEffectivePermissionProfile } = require('../utils/permissions');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET es obligatorio. Configúralo en el archivo .env.');
}

const verifyToken = async (req, res, next) => {
  const token = req.cookies.token; // Recupera desde HttpOnly Cookie

  if (!token) {
    return res.status(401).json({ message: 'Se requiere una sesión autenticada.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const userRes = await pool.query(
      `SELECT u.id, u.correo, u.rol, u.nombre, u.cargo, u.token_version, u.activo,
              u.debe_cambiar_password, p.nombre AS profile_name
       FROM usuarios u
       LEFT JOIN perfiles_acceso p ON p.codigo = u.rol
       WHERE u.id = $1 AND u.eliminado_en IS NULL`,
      [decoded.id]
    );
    if (userRes.rows.length === 0) {
      return res.status(401).json({ message: 'Usuario no encontrado' });
    }

    const currentUser = userRes.rows[0];
    if (!currentUser.activo) {
      return res.status(401).json({ message: 'La cuenta se encuentra desactivada. Contacte a un administrador.' });
    }

    const currentVersion = currentUser.token_version;
    if ((decoded.token_version || 1) !== (currentVersion || 1)) {
      return res.status(401).json({ message: 'Sesión invalidada por cambio de contraseña. Por favor, inicie sesión de nuevo.' });
    }

    const permissionProfile = await getEffectivePermissionProfile(pool, currentUser.id, currentUser.rol);
    req.user = {
      id: currentUser.id,
      correo: currentUser.correo,
      rol: currentUser.rol,
      nombre: currentUser.nombre,
      cargo: currentUser.cargo,
      profile_name: currentUser.profile_name || currentUser.rol,
      token_version: currentUser.token_version,
      debe_cambiar_password: currentUser.debe_cambiar_password,
      permissions: permissionProfile.permissions,
      recommended_permissions: permissionProfile.recommended_permissions
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token de Cookie inválido o expirado' });
  }
};

const verifyPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user || !Array.isArray(req.user.permissions) || !req.user.permissions.includes(permission)) {
      return res.status(403).json({ message: 'No tienes habilitada esta función.' });
    }
    next();
  };
};

const verifyAnyPermission = (permissions) => {
  return (req, res, next) => {
    const available = new Set(req.user?.permissions || []);
    if (!permissions.some((permission) => available.has(permission))) {
      return res.status(403).json({ message: 'No tienes habilitada ninguna de las funciones requeridas.' });
    }
    next();
  };
};

const verifyRole = (rolesAllowed) => {
  return (req, res, next) => {
    if (!req.user || !rolesAllowed.includes(req.user.rol)) {
      return res.status(403).json({ message: 'No tienes permisos suficientes para esta acción' });
    }
    next();
  };
};

module.exports = { verifyToken, verifyRole, verifyPermission, verifyAnyPermission, JWT_SECRET };
