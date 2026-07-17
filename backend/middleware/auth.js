const jwt = require('jsonwebtoken');

const pool = require('../db');

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
      `SELECT id, correo, rol, nombre, token_version, activo, debe_cambiar_password
       FROM usuarios WHERE id = $1`,
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

    req.user = {
      id: currentUser.id,
      correo: currentUser.correo,
      rol: currentUser.rol,
      nombre: currentUser.nombre,
      token_version: currentUser.token_version,
      debe_cambiar_password: currentUser.debe_cambiar_password
    };
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token de Cookie inválido o expirado' });
  }
};

const verifyRole = (rolesAllowed) => {
  return (req, res, next) => {
    if (!req.user || !rolesAllowed.includes(req.user.rol)) {
      return res.status(403).json({ message: 'No tienes permisos suficientes para esta acción' });
    }
    next();
  };
};

module.exports = { verifyToken, verifyRole, JWT_SECRET };
