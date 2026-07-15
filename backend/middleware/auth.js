const jwt = require('jsonwebtoken');

const pool = require('../db');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET es obligatorio. Configúralo en el archivo .env.');
}

const verifyToken = async (req, res, next) => {
  const token = req.cookies.token; // Recupera desde HttpOnly Cookie

  if (!token) {
    return res.status(403).json({ message: 'Se requiere cookie de autenticación (HttpOnly)' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // INC-04: Comparar versión del token con la BD
    const userRes = await pool.query('SELECT token_version FROM usuarios WHERE id = $1', [decoded.id]);
    if (userRes.rows.length === 0) {
      return res.status(401).json({ message: 'Usuario no encontrado' });
    }

    const currentVersion = userRes.rows[0].token_version;
    if ((decoded.token_version || 1) !== (currentVersion || 1)) {
      return res.status(401).json({ message: 'Sesión invalidada por cambio de contraseña. Por favor, inicie sesión de nuevo.' });
    }

    req.user = decoded; // { id, correo, rol }
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
