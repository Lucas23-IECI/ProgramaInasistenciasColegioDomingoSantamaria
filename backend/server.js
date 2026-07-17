const express = require('express');
const cors = require('cors');
const pool = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
require('dotenv').config();

const { verifyToken, verifyRole, JWT_SECRET } = require('./middleware/auth');
const { runMigrations } = require('./migrations');
const {
  DocumentValidationError,
  createDocument,
  deleteDocumentIfUnreferenced,
  removeStoredFile,
  resolveDocumentPath
} = require('./services/documentService');
const {
  normalizeEmail,
  sanitizeSnapshotRow,
  validateEmail,
  validatePassword,
  validateSystemRole
} = require('./utils/security');
const { calculateStatusAndSeverity } = require('./utils/punctuality');
const { createPunctualityRouter } = require('./routes/punctuality');

const app = express();
app.set('trust proxy', 1);

// CORS CONFIGURATION
const rawOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
let allowedOrigins = rawOrigin.split(',').map(o => o.trim());
const fallbackOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5000'
];
if (process.env.NODE_ENV !== 'production') {
  fallbackOrigins.forEach(origin => {
    if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
  });
}

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    console.error(`[CORS REJECTED] Origin: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' }
}));
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { message: 'Se alcanzó el límite temporal de solicitudes. Intente nuevamente en unos minutos.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: 'Demasiados intentos de acceso. Intente nuevamente en 15 minutos.' }
});

app.use('/api', apiLimiter);

const PORT = process.env.PORT || 5000;
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/'
};

const toPublicUser = (user) => ({
  id: user.id,
  correo: user.correo,
  rol: user.rol,
  nombre: user.nombre,
  debe_cambiar_password: Boolean(user.debe_cambiar_password)
});

const setSessionCookie = (res, user) => {
  const token = jwt.sign(
    {
      id: user.id,
      correo: user.correo,
      rol: user.rol,
      nombre: user.nombre,
      token_version: user.token_version
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.cookie('token', token, {
    ...cookieOptions,
    maxAge: 12 * 60 * 60 * 1000
  });
};

const getDefaultUserPassword = () => {
  const password = process.env.DEFAULT_USER_PASSWORD;
  const passwordError = validatePassword(password);
  if (passwordError) throw new Error(`DEFAULT_USER_PASSWORD no cumple la política: ${passwordError}`);
  return password;
};

// HELPERS
const sanitizeText = (value) => {
  if (value === null || value === undefined) return '';
  return String(value).trim();
};

const normalizeHeaderKey = (value) => {
  return sanitizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
};

const pickRowValue = (row, aliases) => {
  const aliasSet = new Set(aliases.map((alias) => normalizeHeaderKey(alias)));
  for (const [key, value] of Object.entries(row || {})) {
    if (!aliasSet.has(normalizeHeaderKey(key))) continue;
    if (value === undefined || value === null) continue;
    const cleaned = sanitizeText(value);
    if (cleaned !== '') return cleaned;
  }
  return '';
};

const normalizeRutAndDv = (rutInput, dvInput) => {
  let rawRut = sanitizeText(rutInput).toUpperCase().replace(/\./g, '');
  let rawDv = sanitizeText(dvInput).toUpperCase();

  if (!rawRut) return { rut: '', dv: '' };

  if (rawRut.includes('-')) {
    const [rutPart, dvPart] = rawRut.split('-');
    return {
      rut: rutPart.replace(/\D/g, ''),
      dv: (dvPart || '').replace(/[^0-9K]/g, '').slice(0, 1)
    };
  }

  // If no hyphen, look if the last char could be the DV
  if (rawRut.length > 1) {
    const lastChar = rawRut.slice(-1);
    if (/[0-9K]/.test(lastChar)) {
      return {
        rut: rawRut.slice(0, -1).replace(/\D/g, ''),
        dv: lastChar
      };
    }
  }

  return {
    rut: rawRut.replace(/\D/g, ''),
    dv: rawDv.replace(/[^0-9K]/g, '').slice(0, 1)
  };
};

const normalizeDateInput = (value) => {
  if (value === null || value === undefined || value === '') return null;

  if (typeof value === 'number' && Number.isFinite(value)) {
    const base = new Date(Date.UTC(1899, 11, 30));
    const ms = value * 24 * 60 * 60 * 1000;
    const parsed = new Date(base.getTime() + ms);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  const cleaned = sanitizeText(value);
  if (!cleaned) return null;

  // Handle DD/MM/YYYY
  const dmwParts = cleaned.split(/[-/]/);
  if (dmwParts.length === 3) {
    // Check if first part is day and last is year
    if (dmwParts[0].length <= 2 && dmwParts[2].length === 4) {
      const day = parseInt(dmwParts[0], 10);
      const month = parseInt(dmwParts[1], 10) - 1;
      const year = parseInt(dmwParts[2], 10);
      const parsed = new Date(Date.UTC(year, month, day));
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
    }
  }

  const parsed = new Date(cleaned);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
};

const STUDENT_PUBLIC_FIELDS = `
  a.id_alumno, a.uuid_erp, a.rut, a.dv, a.nombres, a.paterno, a.materno,
  a.email, a.telefono, a.rol, a.seccion, a.genero, a.fecha_nacimiento,
  a.nombre_usuario, a.rut_apoderado, a.activo, a.fecha_actualizacion,
  a.codigo_barra
`;


const getInstitutionalClock = async (queryable = pool) => {
  const result = await queryable.query("SELECT TO_CHAR(LOCALTIME, 'HH24:MI:SS') AS hora");
  return result.rows[0].hora;
};

// AUDIT HELPER
const insertarAudit = async (queryable, { usuario_id, usuario_correo, accion, entidad, entidad_id, detalle, ip }) => {
  await queryable.query(
    `INSERT INTO audit_log (usuario_id, usuario_correo, accion, entidad, entidad_id, detalle, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [usuario_id, usuario_correo, accion, entidad, entidad_id, detalle ? JSON.stringify(detalle) : null, ip]
  );
};

const registrarAudit = async (event) => {
  try {
    await insertarAudit(pool, event);
  } catch (err) {
    console.error('Audit Log Error:', err.message);
  }
};

const getClientIp = (req) => {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
};

app.use('/api/puntualidad', createPunctualityRouter({
  pool,
  verifyToken,
  verifyRole,
  insertarAudit,
  getClientIp
}));

const bootstrapBaseSchema = async () => {
  const tableExists = await pool.query("SELECT to_regclass('alumno') AS exists");
  if (tableExists.rows[0]?.exists) return false;

  const initSqlPath = path.join(__dirname, 'init.sql');
  const initSql = fs.readFileSync(initSqlPath, 'utf8');

  console.log('No se detectó el esquema base. Aplicando init.sql...');
  await pool.query(initSql);
  console.log('Esquema base creado correctamente.');
  return true;
};

// HEALTH CHECK
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'OK', database: 'connected', timestamp: new Date() });
  } catch {
    res.status(503).json({ status: 'ERROR', database: 'unavailable', timestamp: new Date() });
  }
});

// AUTHENTICATION
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password) {
    return res.status(400).json({ message: 'Correo y contraseña son requeridos.' });
  }

  try {
    const normalizedEmail = normalizeEmail(correo);
    const userRes = await pool.query(
      'SELECT * FROM usuarios WHERE LOWER(correo) = $1 LIMIT 1',
      [normalizedEmail]
    );

    if (userRes.rows.length === 0) {
      await registrarAudit({
        usuario_correo: normalizedEmail.slice(0, 150),
        accion: 'LOGIN_FALLIDO',
        detalle: { motivo: 'credenciales_invalidas' },
        ip: getClientIp(req)
      });
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const user = userRes.rows[0];

    if (!user.activo) {
      await registrarAudit({
        usuario_id: user.id,
        usuario_correo: user.correo,
        accion: 'LOGIN_FALLIDO',
        detalle: { motivo: 'cuenta_desactivada' },
        ip: getClientIp(req)
      });
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    if (user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
      return res.status(423).json({ message: 'Cuenta bloqueada temporalmente. Intente más tarde.' });
    }

    const validPass = await bcrypt.compare(password, user.password_hash);
    if (!validPass) {
      await pool.query(`
        UPDATE usuarios
        SET bloqueado_hasta = CASE
              WHEN intentos_fallidos + 1 >= 5 THEN CURRENT_TIMESTAMP + interval '15 minutes'
              ELSE NULL
            END,
            intentos_fallidos = CASE
              WHEN intentos_fallidos + 1 >= 5 THEN 0
              ELSE intentos_fallidos + 1
            END
        WHERE id = $1
      `, [user.id]);
      await registrarAudit({
        usuario_id: user.id,
        usuario_correo: user.correo,
        accion: 'LOGIN_FALLIDO',
        detalle: { motivo: 'credenciales_invalidas' },
        ip: getClientIp(req)
      });
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const updatedUser = await pool.query(
      `UPDATE usuarios
       SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = CURRENT_TIMESTAMP
       WHERE id = $1
       RETURNING id, correo, rol, nombre, token_version, debe_cambiar_password`,
      [user.id]
    );
    const sessionUser = updatedUser.rows[0];
    setSessionCookie(res, sessionUser);

    await registrarAudit({
      usuario_id: sessionUser.id,
      usuario_correo: sessionUser.correo,
      accion: 'LOGIN_EXITOSO',
      ip: getClientIp(req)
    });

    res.json({ user: toPublicUser(sessionUser) });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error en el servidor.' });
  }
});

app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const userRes = await pool.query(
      'SELECT id, correo, rol, nombre, debe_cambiar_password FROM usuarios WHERE id = $1 AND activo = true',
      [req.user.id]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json({ user: toPublicUser(userRes.rows[0]) });
  } catch (err) {
    res.status(500).json({ message: 'Error en el servidor.' });
  }
});

app.post('/api/auth/change-password', verifyToken, async (req, res) => {
  const { current_password: currentPassword, new_password: newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ message: 'La contraseña actual y la nueva son obligatorias.' });
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) return res.status(400).json({ message: passwordError });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userRes = await client.query('SELECT * FROM usuarios WHERE id = $1 FOR UPDATE', [req.user.id]);
    if (userRes.rows.length === 0 || !userRes.rows[0].activo) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    const user = userRes.rows[0];
    const currentIsValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!currentIsValid) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La contraseña actual no es correcta.' });
    }
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'La nueva contraseña debe ser distinta de la actual.' });
    }

    const hash = await bcrypt.hash(newPassword, 12);
    const updated = await client.query(`
      UPDATE usuarios
      SET password_hash = $1,
          debe_cambiar_password = false,
          password_actualizado_en = CURRENT_TIMESTAMP,
          token_version = token_version + 1,
          intentos_fallidos = 0,
          bloqueado_hasta = NULL
      WHERE id = $2
      RETURNING id, correo, rol, nombre, token_version, debe_cambiar_password
    `, [hash, user.id]);

    await insertarAudit(client, {
      usuario_id: user.id,
      usuario_correo: user.correo,
      accion: 'CAMBIAR_PASSWORD_PROPIA',
      entidad: 'usuario',
      entidad_id: user.id,
      ip: getClientIp(req)
    });
    await client.query('COMMIT');

    const sessionUser = updated.rows[0];
    setSessionCookie(res, sessionUser);
    res.json({ message: 'Contraseña actualizada.', user: toPublicUser(sessionUser) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err.message);
    res.status(500).json({ message: 'No fue posible actualizar la contraseña.' });
  } finally {
    client.release();
  }
});

app.post('/api/auth/logout', async (req, res) => {
  const token = req.cookies.token;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      await registrarAudit({
        usuario_id: decoded.id,
        usuario_correo: decoded.correo,
        accion: 'LOGOUT',
        entidad: 'usuario',
        entidad_id: decoded.id,
        ip: getClientIp(req)
      });
    } catch {
      // La cookie se limpia aunque la sesión haya vencido.
    }
  }
  res.clearCookie('token', cookieOptions);
  res.json({ message: 'Sesión cerrada exitosamente.' });
});

// COURSES
app.get('/api/courses', verifyToken, async (req, res) => {
  try {
    const resC = await pool.query('SELECT * FROM curso ORDER BY nombre_curso ASC');
    res.json(resC.rows);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener cursos.' });
  }
});

// SUPERFICIE HEREDADA DE ASISTENCIA
//
// El producto vigente controla ingresos y atrasos. Estos endpoints se
// conservan bloqueados durante la transición para que instalaciones antiguas
// reciban una respuesta inequívoca sin permitir nuevas ausencias, inferencias
// de asistencia ni mutaciones sobre el flujo histórico.
const legacyAttendanceGone = (req, res) => res.status(410).json({
  code: 'MODULO_ASISTENCIA_DESCONTINUADO',
  message: 'Esta función fue retirada. Utiliza el módulo institucional de puntualidad y atrasos.',
  replacement: '/api/puntualidad'
});

app.all([
  '/api/attendance/config',
  '/api/asistencia/today',
  '/api/asistencia/today-stats',
  '/api/asistencia/range-stats',
  '/api/asistencia/inasistencias',
  '/api/asistencia/history',
  '/api/admin/reportes/asistencia',
  '/api/asistencia/justificar-nueva',
  '/api/asistencia/registrar-ausencia',
  '/api/asistencia/justificaciones',
  '/api/asistencia/alertas-tempranas'
], verifyToken, legacyAttendanceGone);

app.all('/api/asistencia/:id/justificar', verifyToken, legacyAttendanceGone);
app.all('/api/asistencia/justificacion/:id', verifyToken, legacyAttendanceGone);
app.all('/api/asistencia/download/:id', verifyToken, legacyAttendanceGone);
app.put('/api/asistencia/:id', verifyToken, legacyAttendanceGone);
app.delete('/api/asistencia/:id', verifyToken, legacyAttendanceGone);

// ATTENDANCE CONFIGURATION
app.get('/api/attendance/config', verifyToken, async (req, res) => {
  try {
    const configRes = await pool.query('SELECT * FROM configuracion_asistencia LIMIT 1');
    if (configRes.rows.length === 0) {
      // Create default
      const inserted = await pool.query(
        "INSERT INTO configuracion_asistencia (hora_entrada, hora_limite_atraso) VALUES ('08:00:00', '08:15:00') RETURNING *"
      );
      return res.json(inserted.rows[0]);
    }
    res.json(configRes.rows[0]);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener configuración.' });
  }
});

app.post('/api/attendance/config', verifyToken, verifyRole(['admin']), async (req, res) => {
  const { hora_entrada, hora_limite_atraso } = req.body;
  try {
    const check = await pool.query('SELECT id FROM configuracion_asistencia LIMIT 1');
    if (check.rows.length === 0) {
      await pool.query(
        'INSERT INTO configuracion_asistencia (hora_entrada, hora_limite_atraso) VALUES ($1, $2)',
        [hora_entrada || '08:00:00', hora_limite_atraso || '08:15:00']
      );
    } else {
      await pool.query(
        'UPDATE configuracion_asistencia SET hora_entrada = $1, hora_limite_atraso = $2 WHERE id = $3',
        [hora_entrada, hora_limite_atraso, check.rows[0].id]
      );
    }
    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'ACTUALIZAR_CONFIG_ASISTENCIA',
      detalle: { hora_entrada, hora_limite_atraso },
      ip: getClientIp(req)
    });
    res.json({ message: 'Configuración actualizada.' });
  } catch (err) {
    res.status(500).json({ message: 'Error al actualizar configuración.' });
  }
});

// STUDENTS CRUD
app.get('/api/students', verifyToken, verifyRole(['admin']), async (req, res) => {
  try {
    const query = `
      SELECT ${STUDENT_PUBLIC_FIELDS}, c.nombre_curso as grade
      FROM alumno a
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      ORDER BY a.paterno ASC, a.nombres ASC
    `;
    const resStudents = await pool.query(query);
    res.json(resStudents.rows);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener miembros.' });
  }
});

app.get('/api/students/search', verifyToken, async (req, res) => {
  const { q } = req.query;
  const searchTerm = `%${(q || '').toString().trim().toLowerCase()}%`;

  try {
    const query = `
      SELECT a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv, a.rol, c.nombre_curso
      FROM alumno a
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE a.activo = true
        AND (
          LOWER(a.nombres || ' ' || a.paterno || ' ' || COALESCE(a.materno, '')) LIKE $1
          OR LOWER(a.rut || '-' || a.dv) LIKE $1
          OR LOWER(a.rut) LIKE $1
          OR LOWER(a.nombre_usuario) LIKE $1
        )
      LIMIT 15
    `;
    const result = await pool.query(query, [searchTerm]);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error en búsqueda' });
  }
});

app.get('/api/students/scan/:barcode', verifyToken, async (req, res) => {
  const { barcode } = req.params;
  const { tipo_registro } = req.query; // Entrada / Salida
  const cleanBarcode = sanitizeText(barcode).toUpperCase().replace(/\./g, '');

  try {
    // 1. Resolve barcode (RUT, QR, or ERP UUID)
    const query = `
      SELECT a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv, a.rol, a.activo as alumno_activo, c.nombre_curso
      FROM alumno a
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE a.rut = $1
         OR a.codigo_barra = $1
         OR LOWER(a.uuid_erp) = LOWER($1)
         OR LOWER(a.nombre_usuario) = LOWER($1)
    `;

    // Try finding by RUT directly or raw barcode
    let result = await pool.query(query, [cleanBarcode]);
    if (result.rows.length === 0) {
      // Try resolving barcode from RUT split (e.g. if barcode is 23704570K, check if rut=23704570 and dv=K)
      const parsed = normalizeRutAndDv(cleanBarcode);
      if (parsed.rut) {
        result = await pool.query(query, [parsed.rut]);
      }
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Miembro no encontrado.' });
    }

    const alumno = result.rows[0];

    if (!alumno.alumno_activo) {
      return res.status(403).json({ message: 'Miembro inactivo en el sistema.' });
    }

    // 2. Check check-in limit
    const configRes = await pool.query('SELECT * FROM configuracion_asistencia LIMIT 1');
    const config = configRes.rows[0] || { hora_entrada: '08:00:00', hora_limite_atraso: '08:15:00' };

    const currentTimeStr = await getInstitutionalClock();

    const { status: calculatedStatus, severidad } = calculateStatusAndSeverity(tipo_registro || 'Entrada', currentTimeStr, config);

    // 3. Check if already registered today
    const checkQuery = `
      SELECT id_registro, hora, estado FROM attendance_registrations
      WHERE id_alumno = $1 AND fecha = CURRENT_DATE AND tipo_registro = $2 AND anulado = false
    `;
    const checkRes = await pool.query(checkQuery, [alumno.id_alumno, tipo_registro || 'Entrada']);
    const alreadyRegistered = checkRes.rows.length > 0;
    const registroPrevio = checkRes.rows[0] || null;

    res.json({
      alumno,
      alreadyRegistered,
      registroPrevio,
      restricciones: calculatedStatus === 'Atrasado' ? [`Ingreso Atrasado (${severidad})`] : [],
      statusPropuesto: calculatedStatus,
      severidad
    });

  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error al procesar escaneo.' });
  }
});

app.get('/api/students/:id/status', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { tipo_registro } = req.query; // Entrada / Salida

  try {
    const query = `
      SELECT a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv, a.rol, a.activo as alumno_activo, c.nombre_curso
      FROM alumno a
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE a.id_alumno = $1
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Miembro no encontrado.' });
    }

    const alumno = result.rows[0];

    // Check check-in limit
    const configRes = await pool.query('SELECT * FROM configuracion_asistencia LIMIT 1');
    const config = configRes.rows[0] || { hora_entrada: '08:00:00', hora_limite_atraso: '08:15:00' };

    const currentTimeStr = await getInstitutionalClock();

    const { status: calculatedStatus, severidad } = calculateStatusAndSeverity(tipo_registro || 'Entrada', currentTimeStr, config);

    // Check if already registered today
    const checkQuery = `
      SELECT id_registro, hora, estado FROM attendance_registrations
      WHERE id_alumno = $1 AND fecha = CURRENT_DATE AND tipo_registro = $2 AND anulado = false
    `;
    const checkRes = await pool.query(checkQuery, [alumno.id_alumno, tipo_registro || 'Entrada']);
    const alreadyRegistered = checkRes.rows.length > 0;

    res.json({
      alumno,
      alreadyRegistered,
      restricciones: calculatedStatus === 'Atrasado' ? [`Ingreso Atrasado (${severidad})`] : [],
      statusPropuesto: calculatedStatus,
      severidad
    });
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener estado.' });
  }
});

// ATTENDANCE REGISTRATIONS
app.post('/api/asistencia', verifyToken, async (req, res) => {
  const { id_alumno } = req.body;
  if (!id_alumno) {
    return res.status(400).json({ message: 'ID del alumno es requerido.' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const studentRes = await client.query('SELECT id_alumno, activo FROM alumno WHERE id_alumno = $1 FOR SHARE', [id_alumno]);
    if (studentRes.rows.length === 0 || !studentRes.rows[0].activo) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Alumno activo no encontrado.' });
    }
    const configRes = await client.query('SELECT * FROM configuracion_asistencia LIMIT 1');
    const config = configRes.rows[0] || { hora_entrada: '08:00:00', hora_limite_atraso: '08:15:00' };
    const currentTimeStr = await getInstitutionalClock(client);
    const { status, severidad } = calculateStatusAndSeverity('Entrada', currentTimeStr, config);
    const origen = req.user.rol === 'lector' ? 'lector' : 'manual';
    const insertQuery = `
      INSERT INTO attendance_registrations
        (id_alumno, fecha, hora, estado, tipo_registro, severidad, origen, registrado_por, creado_en)
      VALUES ($1, CURRENT_DATE, LOCALTIME, $2, 'Entrada', $3, $4, $5, CURRENT_TIMESTAMP)
      ON CONFLICT (id_alumno, fecha, tipo_registro) WHERE anulado = false DO NOTHING
      RETURNING *
    `;
    const result = await client.query(insertQuery, [id_alumno, status, severidad, origen, req.user.id]);
    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'Registro ya realizado hoy.' });
    }
    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'REGISTRAR_INGRESO',
      entidad: 'registro_puntualidad',
      entidad_id: result.rows[0].id_registro,
      detalle: { id_alumno, estado: status, severidad, origen, endpoint_legacy: true },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err.message);
    if (err.code === '23505') return res.status(409).json({ message: 'Registro ya realizado hoy.' });
    res.status(500).json({ message: 'Error al registrar el ingreso.' });
  } finally {
    client.release();
  }
});

app.get('/api/asistencia/today', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT r.id_registro, r.fecha, r.hora, r.estado, r.tipo_registro, r.comentario,
             r.severidad, r.justificado, r.tipo_justificacion, r.comentario_justificacion,
             COALESCE(r.archivo_justificacion, CASE WHEN r.documento_id IS NOT NULL THEN 'documento_adjunto' END) AS archivo_justificacion,
             r.documento_id,
             a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv, a.rol, c.nombre_curso as grade
      FROM attendance_registrations r
      JOIN alumno a ON r.id_alumno = a.id_alumno
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE r.fecha = CURRENT_DATE
      ORDER BY r.hora DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener registros de hoy.' });
  }
});

app.get('/api/asistencia/today-stats', verifyToken, async (req, res) => {
  try {
    const statsRes = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM alumno WHERE rol = 'Estudiante' AND activo = true) AS total_alumnos,
        COUNT(DISTINCT id_alumno) FILTER (
          WHERE tipo_registro = 'Entrada' AND estado = 'Presente'
        )::int AS presentes,
        COUNT(DISTINCT id_alumno) FILTER (
          WHERE tipo_registro = 'Entrada' AND estado = 'Atrasado'
        )::int AS atrasados,
        COUNT(DISTINCT id_alumno) FILTER (
          WHERE tipo_registro = 'Entrada' AND estado = 'Ausente'
        )::int AS ausentes
      FROM attendance_registrations
      WHERE fecha = CURRENT_DATE
    `);
    const row = statsRes.rows[0];
    const presentCount = row.presentes || 0;
    const late = row.atrasados || 0;
    const absent = row.ausentes || 0;
    const totalStudents = row.total_alumnos || 0;

    res.json({
      total: presentCount + late,
      presentes: presentCount,
      atrasados: late,
      absent: absent,
      totalAlumnos: totalStudents
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error al obtener estadísticas de hoy.' });
  }
});


app.get('/api/asistencia/range-stats', verifyToken, async (req, res) => {
  const { desde, hasta, id_curso, justificado, severidad } = req.query;
  if (!desde || !hasta) {
    return res.status(400).json({ message: 'Faltan parámetros desde/hasta.' });
  }

  try {
    // 1. Total active students
    let totalStudentsQuery = "SELECT COUNT(*) FROM alumno a JOIN matricula m ON a.id_alumno = m.id_alumno WHERE a.rol = 'Estudiante' AND a.activo = true";
    let totalStudentsParams = [];
    if (id_curso) {
      totalStudentsQuery += " AND m.id_curso = $1";
      totalStudentsParams.push(id_curso);
    }
    const totalStudentsRes = await pool.query(totalStudentsQuery, totalStudentsParams);
    const totalStudents = parseInt(totalStudentsRes.rows[0].count, 10);

    // 2. Active days in range (days with at least one scan)
    let activeDaysQuery = `
      SELECT COUNT(DISTINCT r.fecha)
      FROM attendance_registrations r
      LEFT JOIN alumno a ON r.id_alumno = a.id_alumno
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      WHERE r.fecha >= $1 AND r.fecha <= $2
    `;
    let activeDaysParams = [desde, hasta];
    if (id_curso) {
      activeDaysQuery += " AND m.id_curso = $3";
      activeDaysParams.push(id_curso);
    }
    const activeDaysRes = await pool.query(activeDaysQuery, activeDaysParams);
    const activeDays = Math.max(1, parseInt(activeDaysRes.rows[0].count, 10) || 1);

    // 3. Total unjustified absences (estado = 'Ausente' AND justificado = false)
    let totalInasistenciasQuery = `
      SELECT COUNT(*)
      FROM attendance_registrations r
      LEFT JOIN alumno a ON r.id_alumno = a.id_alumno
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      WHERE r.fecha >= $1 AND r.fecha <= $2 AND r.estado = 'Ausente' AND (r.justificado = false OR r.justificado IS NULL) AND r.tipo_registro = 'Entrada'
    `;
    let totalInasistenciasParams = [desde, hasta];
    if (id_curso) {
      totalInasistenciasQuery += " AND m.id_curso = $3";
      totalInasistenciasParams.push(id_curso);
    }
    const totalInasistenciasRes = await pool.query(totalInasistenciasQuery, totalInasistenciasParams);
    const totalInasistencias = parseInt(totalInasistenciasRes.rows[0].count, 10);

    // 4. Total late arrivals (estado = 'Atrasado')
    let totalAtrasadosQuery = `
      SELECT COUNT(*)
      FROM attendance_registrations r
      LEFT JOIN alumno a ON r.id_alumno = a.id_alumno
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      WHERE r.fecha >= $1 AND r.fecha <= $2 AND r.estado = 'Atrasado' AND r.tipo_registro = 'Entrada'
    `;
    let totalAtrasadosParams = [desde, hasta];
    let totalAtrasadosIdx = 3;
    if (id_curso) {
      totalAtrasadosQuery += ` AND m.id_curso = $${totalAtrasadosIdx}`;
      totalAtrasadosParams.push(id_curso);
      totalAtrasadosIdx++;
    }
    if (severidad) {
      totalAtrasadosQuery += ` AND r.severidad = $${totalAtrasadosIdx}`;
      totalAtrasadosParams.push(severidad);
      totalAtrasadosIdx++;
    }
    const totalAtrasadosRes = await pool.query(totalAtrasadosQuery, totalAtrasadosParams);
    const totalAtrasadosVal = parseInt(totalAtrasadosRes.rows[0].count, 10);

    // 5. Total justified late arrivals
    let totalAtrasadosJustificadosQuery = `
      SELECT COUNT(*)
      FROM attendance_registrations r
      LEFT JOIN alumno a ON r.id_alumno = a.id_alumno
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      WHERE r.fecha >= $1 AND r.fecha <= $2 AND r.estado = 'Atrasado' AND r.justificado = true AND r.tipo_registro = 'Entrada'
    `;
    let totalAtrasadosJustificadosParams = [desde, hasta];
    let totalAtrasadosJustificadosIdx = 3;
    if (id_curso) {
      totalAtrasadosJustificadosQuery += ` AND m.id_curso = $${totalAtrasadosJustificadosIdx}`;
      totalAtrasadosJustificadosParams.push(id_curso);
      totalAtrasadosJustificadosIdx++;
    }
    if (severidad) {
      totalAtrasadosJustificadosQuery += ` AND r.severidad = $${totalAtrasadosJustificadosIdx}`;
      totalAtrasadosJustificadosParams.push(severidad);
      totalAtrasadosJustificadosIdx++;
    }
    const totalAtrasadosJustificadosRes = await pool.query(totalAtrasadosJustificadosQuery, totalAtrasadosJustificadosParams);
    const totalAtrasadosJustificados = parseInt(totalAtrasadosJustificadosRes.rows[0].count, 10);

    // 6. Total justified absences (estado = 'Ausente' AND justificado = true)
    let totalAusentesJustificadosQuery = `
      SELECT COUNT(*)
      FROM attendance_registrations r
      LEFT JOIN alumno a ON r.id_alumno = a.id_alumno
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      WHERE r.fecha >= $1 AND r.fecha <= $2 AND r.estado = 'Ausente' AND r.justificado = true AND r.tipo_registro = 'Entrada'
    `;
    let totalAusentesJustificadosParams = [desde, hasta];
    let totalAusentesJustificadosIdx = 3;
    if (id_curso) {
      totalAusentesJustificadosQuery += ` AND m.id_curso = $${totalAusentesJustificadosIdx}`;
      totalAusentesJustificadosParams.push(id_curso);
      totalAusentesJustificadosIdx++;
    }
    const totalAusentesJustificadosRes = await pool.query(totalAusentesJustificadosQuery, totalAusentesJustificadosParams);
    const totalAusentesJustificados = parseInt(totalAusentesJustificadosRes.rows[0].count, 10);

    // 7. Ingresos realmente registrados a tiempo. No se presume presencia por falta de registro.
    let totalPresentesQuery = `
      SELECT COUNT(*)
      FROM attendance_registrations r
      LEFT JOIN alumno a ON r.id_alumno = a.id_alumno
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      WHERE r.fecha >= $1 AND r.fecha <= $2 AND r.estado = 'Presente' AND r.tipo_registro = 'Entrada'
    `;
    const totalPresentesParams = [desde, hasta];
    if (id_curso) {
      totalPresentesQuery += ' AND m.id_curso = $3';
      totalPresentesParams.push(id_curso);
    }
    const totalPresentesRes = await pool.query(totalPresentesQuery, totalPresentesParams);
    const totalPresentes = parseInt(totalPresentesRes.rows[0].count, 10);

    // 8. Daily late arrivals (line chart)
    let dailyLateQuery = `
      SELECT r.fecha::TEXT as fecha, COUNT(*) as count
      FROM attendance_registrations r
      LEFT JOIN alumno a ON r.id_alumno = a.id_alumno
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      WHERE r.fecha >= $1 AND r.fecha <= $2 AND r.estado = 'Atrasado' AND r.tipo_registro = 'Entrada'
    `;
    let dailyLateParams = [desde, hasta];
    let dailyLateIdx = 3;
    if (id_curso) {
      dailyLateQuery += ` AND m.id_curso = $${dailyLateIdx}`;
      dailyLateParams.push(id_curso);
      dailyLateIdx++;
    }
    if (justificado !== undefined && justificado !== '') {
      dailyLateQuery += ` AND r.justificado = $${dailyLateIdx}`;
      dailyLateParams.push(justificado === 'true');
      dailyLateIdx++;
    }
    if (severidad) {
      dailyLateQuery += ` AND r.severidad = $${dailyLateIdx}`;
      dailyLateParams.push(severidad);
      dailyLateIdx++;
    }
    dailyLateQuery += ` GROUP BY r.fecha ORDER BY r.fecha ASC`;
    const dailyLateRes = await pool.query(dailyLateQuery, dailyLateParams);

    // 9. Daily absences (line chart)
    let dailyAbsencesQuery = `
      SELECT r.fecha::TEXT as fecha, COUNT(*) as count
      FROM attendance_registrations r
      LEFT JOIN alumno a ON r.id_alumno = a.id_alumno
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      WHERE r.fecha >= $1 AND r.fecha <= $2 AND r.estado = 'Ausente' AND r.tipo_registro = 'Entrada'
    `;
    let dailyAbsencesParams = [desde, hasta];
    let dailyAbsencesIdx = 3;
    if (id_curso) {
      dailyAbsencesQuery += ` AND m.id_curso = $${dailyAbsencesIdx}`;
      dailyAbsencesParams.push(id_curso);
      dailyAbsencesIdx++;
    }
    dailyAbsencesQuery += ` GROUP BY r.fecha ORDER BY r.fecha ASC`;
    const dailyAbsencesRes = await pool.query(dailyAbsencesQuery, dailyAbsencesParams);

    // 10. Late arrivals by course (bar chart)
    let courseLateQuery = `
      SELECT c.nombre_curso as curso, COUNT(r.id_registro) as count
      FROM attendance_registrations r
      JOIN alumno a ON r.id_alumno = a.id_alumno
      JOIN matricula m ON a.id_alumno = m.id_alumno
      JOIN curso c ON m.id_curso = c.id_curso
      WHERE r.fecha >= $1 AND r.fecha <= $2 AND r.estado = 'Atrasado' AND r.tipo_registro = 'Entrada'
    `;
    let courseLateParams = [desde, hasta];
    let courseLateIdx = 3;
    if (id_curso) {
      courseLateQuery += ` AND m.id_curso = $${courseLateIdx}`;
      courseLateParams.push(id_curso);
      courseLateIdx++;
    }
    if (justificado !== undefined && justificado !== '') {
      courseLateQuery += ` AND r.justificado = $${courseLateIdx}`;
      courseLateParams.push(justificado === 'true');
      courseLateIdx++;
    }
    if (severidad) {
      courseLateQuery += ` AND r.severidad = $${courseLateIdx}`;
      courseLateParams.push(severidad);
      courseLateIdx++;
    }
    courseLateQuery += ` GROUP BY c.nombre_curso ORDER BY count DESC`;
    const courseLateRes = await pool.query(courseLateQuery, courseLateParams);

    // 11. Hourly slot distribution starting from 08:15
    let slotLateQuery = `
      SELECT
         CASE
           WHEN r.hora >= '08:15:00' AND r.hora <= '08:20:00' THEN '08:15 - 08:20'
           WHEN r.hora > '08:20:00' AND r.hora <= '08:25:00' THEN '08:21 - 08:25'
           WHEN r.hora > '08:25:00' AND r.hora <= '08:30:00' THEN '08:26 - 08:30'
           WHEN r.hora > '08:30:00' AND r.hora <= '08:40:00' THEN '08:31 - 08:40'
           ELSE 'Después 08:40'
         END as slot,
         COUNT(*) as count
      FROM attendance_registrations r
      LEFT JOIN alumno a ON r.id_alumno = a.id_alumno
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      WHERE r.fecha >= $1 AND r.fecha <= $2 AND r.estado = 'Atrasado' AND r.tipo_registro = 'Entrada'
    `;
    let slotLateParams = [desde, hasta];
    let slotLateIdx = 3;
    if (id_curso) {
      slotLateQuery += ` AND m.id_curso = $${slotLateIdx}`;
      slotLateParams.push(id_curso);
      slotLateIdx++;
    }
    if (justificado !== undefined && justificado !== '') {
      slotLateQuery += ` AND r.justificado = $${slotLateIdx}`;
      slotLateParams.push(justificado === 'true');
      slotLateIdx++;
    }
    if (severidad) {
      slotLateQuery += ` AND r.severidad = $${slotLateIdx}`;
      slotLateParams.push(severidad);
      slotLateIdx++;
    }
    slotLateQuery += ` GROUP BY slot`;
    const slotLateRes = await pool.query(slotLateQuery, slotLateParams);

    // 12. Absences by course (bar chart)
    let courseAbsencesQuery = `
      SELECT c.nombre_curso as curso, COUNT(r.id_registro) as count
      FROM attendance_registrations r
      JOIN alumno a ON r.id_alumno = a.id_alumno
      JOIN matricula m ON a.id_alumno = m.id_alumno
      JOIN curso c ON m.id_curso = c.id_curso
      WHERE r.fecha >= $1 AND r.fecha <= $2 AND r.estado = 'Ausente' AND r.tipo_registro = 'Entrada'
    `;
    let courseAbsencesParams = [desde, hasta];
    let courseAbsencesIdx = 3;
    if (id_curso) {
      courseAbsencesQuery += ` AND m.id_curso = $${courseAbsencesIdx}`;
      courseAbsencesParams.push(id_curso);
      courseAbsencesIdx++;
    }
    courseAbsencesQuery += ` GROUP BY c.nombre_curso ORDER BY count DESC`;
    const courseAbsencesRes = await pool.query(courseAbsencesQuery, courseAbsencesParams);

    res.json({
      totalAlumnos: totalStudents,
      diasActivos: activeDays,
      totalPresentes: totalPresentes,
      totalAtrasados: totalAtrasadosVal,
      totalAtrasadosJustificados: totalAtrasadosJustificados,
      totalInasistencias: totalInasistencias,
      totalJustificados: totalAusentesJustificados,
      dailyLate: dailyLateRes.rows,
      dailyAbsences: dailyAbsencesRes.rows,
      courseLate: courseLateRes.rows,
      courseAbsences: courseAbsencesRes.rows,
      slotLate: slotLateRes.rows
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error al obtener estadísticas del período.' });
  }
});

app.get('/api/asistencia/inasistencias', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  const { fecha } = req.query;
  const dateToUse = fecha || new Date().toISOString().substring(0, 10);
  try {
    const query = `
      SELECT a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv, c.nombre_curso as grade, c.id_curso,
             r.id_registro, r.justificado, r.tipo_justificacion, r.comentario_justificacion,
             COALESCE(r.archivo_justificacion, CASE WHEN r.documento_id IS NOT NULL THEN 'documento_adjunto' END) AS archivo_justificacion,
             r.documento_id, r.hora, r.estado
      FROM attendance_registrations r
      JOIN alumno a ON r.id_alumno = a.id_alumno
      JOIN matricula m ON a.id_alumno = m.id_alumno
      JOIN curso c ON m.id_curso = c.id_curso
      WHERE a.rol = 'Estudiante' AND a.activo = true
        AND r.fecha = $1
        AND r.estado = 'Ausente'
        AND r.tipo_registro = 'Entrada'
      ORDER BY c.nombre_curso ASC, a.paterno ASC, a.nombres ASC
    `;
    const result = await pool.query(query, [dateToUse]);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error al obtener alumnos inasistentes.' });
  }
});

app.get('/api/asistencia/history', verifyToken, async (req, res) => {
  const { from, to } = req.query;
  try {
    const query = `
      SELECT r.id_registro, r.fecha, r.hora, r.estado, r.tipo_registro, r.comentario,
             r.severidad, r.justificado, r.tipo_justificacion, r.comentario_justificacion,
             COALESCE(r.archivo_justificacion, CASE WHEN r.documento_id IS NOT NULL THEN 'documento_adjunto' END) AS archivo_justificacion,
             r.documento_id,
             a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv, a.rol, c.nombre_curso as grade
      FROM attendance_registrations r
      JOIN alumno a ON r.id_alumno = a.id_alumno
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE r.fecha >= $1 AND r.fecha <= $2
      ORDER BY r.fecha DESC, r.hora DESC
    `;
    const result = await pool.query(query, [from, to]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener historial.' });
  }
});

// ATTENDANCE REPORTS
app.get('/api/admin/reportes/asistencia', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  const { desde, hasta, tipo, cursoId, alumnoId, alumnosIds } = req.query;
  if (!desde || !hasta) return res.status(400).json({ message: 'Faltan fechas desde/hasta' });

  try {
    const params = [desde, hasta];
    let paramIndex = 3;
    const isSegmented = !!(cursoId || alumnoId || alumnosIds);

    let query = '';

    if (!isSegmented) {
      // Masivo
      let whereExtra = '';
      if (tipo === 'presente') {
        whereExtra += ` AND LOWER(r.estado) = 'presente'`;
      } else if (tipo === 'atrasado') {
        whereExtra += ` AND LOWER(r.estado) = 'atrasado'`;
      } else if (tipo === 'salida') {
        whereExtra += ` AND LOWER(r.tipo_registro) = 'salida'`;
      }

      query = `
        SELECT
          a.id_alumno, a.rut, a.dv, a.nombres, a.paterno, a.materno, a.email,
          c.nombre_curso,
          r.fecha::TEXT as fecha_registro, r.estado as estado_asistencia, r.tipo_registro, r.hora,
          r.severidad, r.justificado, r.tipo_justificacion, r.comentario_justificacion,
          COALESCE(r.archivo_justificacion, CASE WHEN r.documento_id IS NOT NULL THEN 'documento_adjunto' END) AS archivo_justificacion,
          r.documento_id
        FROM attendance_registrations r
        JOIN alumno a ON r.id_alumno = a.id_alumno
        LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
        LEFT JOIN curso c ON m.id_curso = c.id_curso
        WHERE r.fecha >= $1 AND r.fecha <= $2
        ${whereExtra}
        ORDER BY a.paterno ASC, a.materno ASC, a.nombres ASC, r.fecha ASC
      `;
    } else {
      // Segmentado
      let whereExtraSegmento = '';
      let whereExtraTipo = '';

      if (tipo === 'presente') {
        whereExtraTipo = ` AND LOWER(r.estado) = 'presente'`;
      } else if (tipo === 'atrasado') {
        whereExtraTipo = ` AND LOWER(r.estado) = 'atrasado'`;
      } else if (tipo === 'salida') {
        whereExtraTipo = ` AND LOWER(r.tipo_registro) = 'salida'`;
      }

      if (cursoId) {
        whereExtraSegmento += ` AND m.id_curso = $${paramIndex}`;
        params.push(parseInt(cursoId, 10));
        paramIndex++;
      }

      if (alumnoId) {
        whereExtraSegmento += ` AND a.id_alumno = $${paramIndex}`;
        params.push(parseInt(alumnoId, 10));
        paramIndex++;
      }

      if (alumnosIds) {
        const idsArray = alumnosIds.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id));
        if (idsArray.length > 0) {
          whereExtraSegmento += ` AND a.id_alumno = ANY($${paramIndex}::int[])`;
          params.push(idsArray);
          paramIndex++;
        }
      }

      query = `
        SELECT
          a.id_alumno, a.rut, a.dv, a.nombres, a.paterno, a.materno, a.email,
          c.nombre_curso,
          r.fecha::TEXT as fecha_registro, r.estado as estado_asistencia, r.tipo_registro, r.hora,
          r.severidad, r.justificado, r.tipo_justificacion, r.comentario_justificacion,
          COALESCE(r.archivo_justificacion, CASE WHEN r.documento_id IS NOT NULL THEN 'documento_adjunto' END) AS archivo_justificacion,
          r.documento_id
        FROM alumno a
        LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
        LEFT JOIN curso c ON m.id_curso = c.id_curso
        LEFT JOIN attendance_registrations r ON a.id_alumno = r.id_alumno
          AND r.fecha >= $1 AND r.fecha <= $2
          ${whereExtraTipo}
        WHERE a.activo = true
          ${whereExtraSegmento}
        ORDER BY a.paterno ASC, a.materno ASC, a.nombres ASC, r.fecha ASC
      `;
    }

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Error');
  }
});

app.delete('/api/asistencia/:id', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM attendance_registrations WHERE id_registro = $1', [id]);
    res.json({ message: 'Registro eliminado.' });
  } catch (err) {
    res.status(500).json({ message: 'Error al eliminar registro.' });
  }
});

app.put('/api/asistencia/:id', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  const { id } = req.params;
  const { estado, comentario } = req.body;
  try {
    await pool.query(
      'UPDATE attendance_registrations SET estado = $1, comentario = $2 WHERE id_registro = $3',
      [estado, comentario, id]
    );
    res.json({ message: 'Registro actualizado.' });
  } catch (err) {
    res.status(500).json({ message: 'Error al actualizar registro.' });
  }
});

app.post('/api/asistencia/:id/justificar', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  const { id } = req.params;
  const { tipo_justificacion, comentario_justificacion, fileName, fileData } = req.body;
  if (!['medica', 'apoderado'].includes(tipo_justificacion)) {
    return res.status(400).json({ message: 'El tipo de justificación no es válido.' });
  }
  if (String(comentario_justificacion || '').length > 2000) {
    return res.status(400).json({ message: 'El comentario no puede superar 2.000 caracteres.' });
  }
  const client = await pool.connect();
  let createdDocument = null;
  let obsoleteStoredName = null;
  try {
    await client.query('BEGIN');
    const checkRecord = await client.query(
      'SELECT estado, id_alumno, fecha, documento_id, archivo_justificacion FROM attendance_registrations WHERE id_registro = $1 FOR UPDATE',
      [id]
    );
    if (checkRecord.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Registro no encontrado.' });
    }
    const record = checkRecord.rows[0];
    if (record.estado === 'Atrasado' && tipo_justificacion === 'medica') {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Los atrasos solo pueden ser justificados por apoderados, no médicamente.' });
    }
    if (record.estado !== 'Atrasado' && tipo_justificacion === 'medica'
        && !fileData && !record.documento_id && !record.archivo_justificacion) {
      await client.query('ROLLBACK');
      return res.status(400).json({ message: 'Una justificación médica requiere un certificado adjunto.' });
    }

    if (fileData && fileName && record.estado !== 'Atrasado' && tipo_justificacion === 'medica') {
      createdDocument = await createDocument(client, {
        fileData,
        fileName,
        userId: req.user.id
      });
    }

    const query = `
      UPDATE attendance_registrations
      SET justificado = true,
          tipo_justificacion = $1,
          comentario_justificacion = $2,
          documento_id = COALESCE($3, documento_id),
          archivo_justificacion = CASE WHEN $3 IS NOT NULL THEN NULL ELSE archivo_justificacion END
      WHERE id_registro = $4
      RETURNING *
    `;
    const result = await client.query(query, [
      record.estado === 'Atrasado' ? 'apoderado' : tipo_justificacion,
      comentario_justificacion,
      createdDocument?.id_documento || null,
      id
    ]);

    if (createdDocument && record.documento_id && record.documento_id !== createdDocument.id_documento) {
      obsoleteStoredName = await deleteDocumentIfUnreferenced(client, record.documento_id);
    }

    await client.query('COMMIT');
    if (obsoleteStoredName) {
      await removeStoredFile(obsoleteStoredName).catch((error) => console.error('No se pudo limpiar un archivo obsoleto:', error.message));
    }

    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: record.estado === 'Atrasado' ? 'JUSTIFICAR_ATRASO' : 'JUSTIFICAR_AUSENCIA',
      entidad: 'asistencia',
      entidad_id: parseInt(id, 10),
      detalle: {
        id_alumno: record.id_alumno,
        fecha: record.fecha,
        tipo_justificacion: record.estado === 'Atrasado' ? 'apoderado' : tipo_justificacion,
        comentario_justificacion,
        documento_id: createdDocument?.id_documento || record.documento_id || null
      },
      ip: getClientIp(req)
    });

    res.json(result.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (createdDocument?.nombre_almacenado) await removeStoredFile(createdDocument.nombre_almacenado).catch(() => {});
    console.error(err.message);
    const status = err instanceof DocumentValidationError ? err.statusCode : 500;
    res.status(status).json({ message: status === 400 ? err.message : 'Error al procesar la justificación.' });
  } finally {
    client.release();
  }
});

app.post('/api/asistencia/justificar-nueva', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  const { id_alumno, fecha, fecha_inicio, fecha_fin, tipo_justificacion, comentario_justificacion, fileName, fileData } = req.body;

  if (!id_alumno) {
    return res.status(400).json({ message: 'ID del alumno es requerido.' });
  }
  if (!['medica', 'apoderado'].includes(tipo_justificacion)) {
    return res.status(400).json({ message: 'El tipo de justificación no es válido.' });
  }
  if (tipo_justificacion === 'medica' && (!fileData || !fileName)) {
    return res.status(400).json({ message: 'Una justificación médica requiere un certificado adjunto.' });
  }
  if (String(comentario_justificacion || '').length > 2000) {
    return res.status(400).json({ message: 'El comentario no puede superar 2.000 caracteres.' });
  }

  const client = await pool.connect();
  let createdDocument = null;
  const filesToDelete = [];
  try {
    await client.query('BEGIN');
    if (fileData && fileName && tipo_justificacion === 'medica') {
      createdDocument = await createDocument(client, { fileData, fileName, userId: req.user.id });
    }

    let datesToProcess = [];
    if (fecha_inicio && fecha_fin) {
      const curr = new Date(fecha_inicio + 'T12:00:00');
      const end = new Date(fecha_fin + 'T12:00:00');
      if (Number.isNaN(curr.getTime()) || Number.isNaN(end.getTime()) || curr > end) {
        throw new DocumentValidationError('El rango de fechas no es válido.');
      }
      const rangeDays = Math.floor((end - curr) / 86400000) + 1;
      if (rangeDays > 90) {
        throw new DocumentValidationError('El rango no puede superar 90 días.');
      }
      while (curr <= end) {
        const day = curr.getDay();
        if (day !== 0 && day !== 6) {
          datesToProcess.push(curr.toISOString().substring(0, 10));
        }
        curr.setDate(curr.getDate() + 1);
      }
    } else {
      datesToProcess.push(fecha || new Date().toISOString().substring(0, 10));
    }

    if (datesToProcess.length === 0) {
      await client.query('ROLLBACK');
      if (createdDocument?.nombre_almacenado) await removeStoredFile(createdDocument.nombre_almacenado);
      return res.status(400).json({ message: 'No hay días hábiles en el rango seleccionado.' });
    }

    const processedIds = [];

    for (const targetDate of datesToProcess) {
      const checkQuery = `
        SELECT id_registro, estado, documento_id FROM attendance_registrations
        WHERE id_alumno = $1 AND fecha = $2 AND tipo_registro = 'Entrada'
      `;
      const checkRes = await client.query(`${checkQuery} FOR UPDATE`, [id_alumno, targetDate]);

      if (checkRes.rows.length > 0) {
        const record = checkRes.rows[0];
        const isAtrasado = record.estado === 'Atrasado';

        const previousDocumentId = record.documento_id;
        await client.query(`
          UPDATE attendance_registrations
          SET justificado = true,
              tipo_justificacion = $1,
              comentario_justificacion = $2,
              documento_id = COALESCE($3, documento_id),
              archivo_justificacion = CASE WHEN $3 IS NOT NULL THEN NULL ELSE archivo_justificacion END
          WHERE id_registro = $4
        `, [
          isAtrasado ? 'apoderado' : tipo_justificacion,
          comentario_justificacion,
          isAtrasado ? null : createdDocument?.id_documento || null,
          record.id_registro
        ]);

        if (!isAtrasado && createdDocument && previousDocumentId && previousDocumentId !== createdDocument.id_documento) {
          const obsolete = await deleteDocumentIfUnreferenced(client, previousDocumentId);
          if (obsolete) filesToDelete.push(obsolete);
        }

        processedIds.push(record.id_registro);
      } else {
        const insertRes = await client.query(`
          INSERT INTO attendance_registrations
            (id_alumno, fecha, hora, estado, tipo_registro, justificado, tipo_justificacion, comentario_justificacion, documento_id)
          VALUES ($1, $2, CURRENT_TIME, 'Ausente', 'Entrada', true, $3, $4, $5)
          RETURNING id_registro
        `, [id_alumno, targetDate, tipo_justificacion, comentario_justificacion, createdDocument?.id_documento || null]);

        processedIds.push(insertRes.rows[0].id_registro);
      }
    }

    if (createdDocument) {
      const unusedNewDocument = await deleteDocumentIfUnreferenced(client, createdDocument.id_documento);
      if (unusedNewDocument) filesToDelete.push(unusedNewDocument);
    }

    await client.query('COMMIT');
    for (const storedName of filesToDelete) {
      await removeStoredFile(storedName).catch((error) => console.error('No se pudo limpiar un archivo obsoleto:', error.message));
    }

    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: (fecha_inicio && fecha_fin) ? 'JUSTIFICAR_RANGO' : 'JUSTIFICAR_AUSENCIA_NUEVA',
      entidad: 'asistencia',
      entidad_id: processedIds[0],
      detalle: {
        id_alumno,
        fecha_inicio: fecha_inicio || null,
        fecha_fin: fecha_fin || null,
        fecha: (!fecha_inicio) ? (fecha || new Date().toISOString().substring(0, 10)) : null,
        tipo_justificacion,
        comentario_justificacion,
        documento_id: createdDocument?.id_documento || null,
        dias_procesados: datesToProcess,
        ids_registros: processedIds
      },
      ip: getClientIp(req)
    });

    res.json({ message: 'Justificación registrada con éxito.', ids: processedIds });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (createdDocument?.nombre_almacenado) await removeStoredFile(createdDocument.nombre_almacenado).catch(() => {});
    console.error(err.message);
    const status = err instanceof DocumentValidationError ? err.statusCode : 500;
    res.status(status).json({ message: status === 400 ? err.message : 'Error al registrar la justificación.' });
  } finally {
    client.release();
  }
});

app.post('/api/asistencia/registrar-ausencia', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  const { id_alumno, fecha } = req.body;
  if (!id_alumno) {
    return res.status(400).json({ message: 'ID del alumno es requerido.' });
  }

  const targetDate = fecha || new Date().toISOString().substring(0, 10);

  try {
    // Check if registration exists for that date
    const checkQuery = `
      SELECT id_registro, estado FROM attendance_registrations
      WHERE id_alumno = $1 AND fecha = $2 AND tipo_registro = 'Entrada'
    `;
    const checkRes = await pool.query(checkQuery, [id_alumno, targetDate]);

    if (checkRes.rows.length > 0) {
      const record = checkRes.rows[0];
      if (record.estado === 'Ausente') {
        return res.status(409).json({ message: 'Este alumno ya está registrado como Ausente hoy.' });
      } else {
        return res.status(400).json({ message: `No se puede marcar como Ausente: el alumno tiene un registro de ${record.estado} hoy.` });
      }
    }

    // Insert Ausente
    const insertRes = await pool.query(`
      INSERT INTO attendance_registrations (id_alumno, fecha, hora, estado, tipo_registro, justificado)
      VALUES ($1, $2, CURRENT_TIME, 'Ausente', 'Entrada', false)
      RETURNING id_registro
    `, [id_alumno, targetDate]);

    const id_registro = insertRes.rows[0].id_registro;

    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'REGISTRAR_AUSENCIA_MANUAL',
      entidad: 'asistencia',
      entidad_id: id_registro,
      detalle: {
        id_alumno,
        fecha: targetDate
      },
      ip: getClientIp(req)
    });

    res.json({ message: 'Ausencia registrada con éxito.', id_registro });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error al registrar la ausencia.' });
  }
});

app.delete('/api/asistencia/justificacion/:id', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  const { id } = req.params;
  const client = await pool.connect();
  const filesToDelete = [];
  try {
    await client.query('BEGIN');
    const checkRecord = await client.query(
      `SELECT id_registro, id_alumno, fecha, estado, archivo_justificacion, documento_id
       FROM attendance_registrations WHERE id_registro = $1 FOR UPDATE`,
      [id]
    );

    if (checkRecord.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Registro no encontrado.' });
    }

    const record = checkRecord.rows[0];

    if (record.estado === 'Ausente') {
      await client.query('DELETE FROM attendance_registrations WHERE id_registro = $1', [id]);
    } else {
      await client.query(`
        UPDATE attendance_registrations
        SET justificado = false,
            tipo_justificacion = null,
            comentario_justificacion = null,
            archivo_justificacion = null,
            documento_id = null
        WHERE id_registro = $1
      `, [id]);
    }

    if (record.documento_id) {
      const storedName = await deleteDocumentIfUnreferenced(client, record.documento_id);
      if (storedName) filesToDelete.push(storedName);
    }

    if (record.archivo_justificacion) {
      const legacyReferences = await client.query(
        'SELECT COUNT(*)::int AS total FROM attendance_registrations WHERE archivo_justificacion = $1',
        [record.archivo_justificacion]
      );
      if (legacyReferences.rows[0].total === 0) filesToDelete.push(record.archivo_justificacion);
    }

    await client.query('COMMIT');
    for (const storedName of filesToDelete) {
      await removeStoredFile(storedName).catch((error) => console.error('No se pudo limpiar un archivo obsoleto:', error.message));
    }

    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'REVOCAR_JUSTIFICACION',
      entidad: 'asistencia',
      entidad_id: parseInt(id, 10),
      detalle: {
        id_alumno: record.id_alumno,
        fecha: record.fecha,
        estado: record.estado,
        archivo_eliminado: record.archivo_justificacion,
        documento_id: record.documento_id
      },
      ip: getClientIp(req)
    });

    res.json({ message: 'Justificación eliminada/revocada con éxito.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err.message);
    res.status(500).json({ message: 'Error al eliminar la justificación.' });
  } finally {
    client.release();
  }
});

app.get('/api/asistencia/justificaciones', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  const { desde, hasta, id_curso, search } = req.query;
  try {
    let query = `
      SELECT r.id_registro, r.fecha, r.hora, r.estado, r.tipo_registro, r.comentario,
             r.severidad, r.justificado, r.tipo_justificacion, r.comentario_justificacion,
             COALESCE(r.archivo_justificacion, CASE WHEN r.documento_id IS NOT NULL THEN 'documento_adjunto' END) AS archivo_justificacion,
             r.documento_id,
             a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv, a.rol, c.nombre_curso as grade, c.id_curso
      FROM attendance_registrations r
      JOIN alumno a ON r.id_alumno = a.id_alumno
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE r.justificado = true
    `;
    const params = [];
    let idx = 1;

    if (desde) {
      query += ` AND r.fecha >= $${idx}`;
      params.push(desde);
      idx++;
    }
    if (hasta) {
      query += ` AND r.fecha <= $${idx}`;
      params.push(hasta);
      idx++;
    }
    if (id_curso) {
      query += ` AND c.id_curso = $${idx}`;
      params.push(id_curso);
      idx++;
    }
    if (search) {
      query += ` AND (LOWER(a.nombres) LIKE $${idx} OR LOWER(a.paterno) LIKE $${idx} OR LOWER(a.materno) LIKE $${idx} OR LOWER(a.rut) LIKE $${idx})`;
      params.push(`%${search.toLowerCase()}%`);
      idx++;
    }

    query += ` ORDER BY r.fecha DESC, r.hora DESC`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error al obtener las justificaciones.' });
  }
});

app.get('/api/asistencia/alertas-tempranas', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  try {
    // 1. Get all active students
    const studentsRes = await pool.query(`
      SELECT a.id_alumno, a.nombres, a.paterno, a.materno, a.rut, a.dv, c.nombre_curso as grade
      FROM alumno a
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE a.rol = 'Estudiante' AND a.activo = true
    `);
    const students = studentsRes.rows;

    // 2. Get all school days (dates with at least one scan or marked absent/justified)
    const schoolDaysRes = await pool.query(`
      SELECT DISTINCT fecha::text as fecha
      FROM attendance_registrations
      WHERE tipo_registro = 'Entrada'
      ORDER BY fecha ASC
    `);
    const schoolDays = schoolDaysRes.rows.map(r => r.fecha);

    // 3. Get all entrance scan records
    const scansRes = await pool.query(`
      SELECT id_alumno, fecha::text as fecha, estado, justificado
      FROM attendance_registrations
      WHERE tipo_registro = 'Entrada'
    `);

    // Group scans by student and date
    const scansMap = {};
    scansRes.rows.forEach(r => {
      if (!scansMap[r.id_alumno]) {
        scansMap[r.id_alumno] = {};
      }
      scansMap[r.id_alumno][r.fecha] = { estado: r.estado, justificado: r.justificado };
    });

    const alerts = {};

    students.forEach(student => {
      const id = student.id_alumno;
      const studentScans = scansMap[id] || {};

      let presentDays = 0;
      let justifiedDays = 0;
      let unjustifiedDays = 0;

      schoolDays.forEach(date => {
        const scan = studentScans[date];
        if (scan) {
          if (scan.estado === 'Presente' || scan.estado === 'Atrasado') {
            presentDays++;
          } else if (scan.estado === 'Ausente' && scan.justificado) {
            justifiedDays++;
          } else {
            unjustifiedDays++;
          }
        } else {
          presentDays++;
        }
      });

      // Calculate consecutive unjustified absences by scanning backward
      let consecutiveUnjustified = 0;
      for (let i = schoolDays.length - 1; i >= 0; i--) {
        const date = schoolDays[i];
        const scan = studentScans[date];
        const isUnjustified = scan && (scan.estado === 'Ausente' && !scan.justificado);
        if (isUnjustified) {
          consecutiveUnjustified++;
        } else {
          break;
        }
      }

      const totalDays = schoolDays.length;
      const rate = totalDays > 0 ? (unjustifiedDays / totalDays) * 100 : 0;

      alerts[id] = {
        id_alumno: id,
        totalDays,
        presentDays,
        justifiedDays,
        unjustifiedDays,
        rate: parseFloat(rate.toFixed(1)),
        consecutive: consecutiveUnjustified,
        alertaCritica: rate > 10,
        alertaConsecutiva: consecutiveUnjustified >= 3
      };
    });

    res.json(alerts);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error al calcular alertas tempranas.' });
  }
});

app.get('/api/asistencia/download/:id', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `SELECT r.archivo_justificacion,
              d.nombre_original, d.nombre_almacenado, d.mime_type
       FROM attendance_registrations r
       LEFT JOIN justification_documents d ON d.id_documento = r.documento_id
       WHERE r.id_registro = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'No existe archivo adjunto para esta justificación.' });
    }

    const document = result.rows[0];
    const storedName = document.nombre_almacenado || document.archivo_justificacion;
    const filePath = resolveDocumentPath(storedName);
    if (!filePath) return res.status(404).json({ message: 'El archivo no es válido o ya no existe.' });

    await fs.promises.access(filePath, fs.constants.R_OK);
    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
    if (document.mime_type) res.type(document.mime_type);
    res.download(filePath, document.nombre_original || storedName);
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ message: 'El archivo no fue encontrado en el servidor.' });
    console.error(err.message);
    res.status(500).json({ message: 'Error al descargar el archivo.' });
  }
});


// BULK SYNC EXCEL IMPORT
app.post('/api/students/bulk-sync', verifyToken, verifyRole(['admin']), async (req, res) => {
  const rows = Array.isArray(req.body?.students) ? req.body.students : [];
  if (!rows.length) {
    return res.status(400).json({ message: 'No se recibieron filas para procesar.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const summary = {
      total: rows.length,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      warnings: [],
      errors: []
    };

    for (let index = 0; index < rows.length; index++) {
      const excelRowNumber = index + 2;
      const rowSavepoint = `students_sync_row_${index}`;
      await client.query(`SAVEPOINT ${rowSavepoint}`);

      try {
        const rawRow = rows[index];

        // 1. PICK VALUES FROM EXCEL COLUMNS
        const uuidErp = pickRowValue(rawRow, ['ID de Usuario (no modificar)', 'id usuario', 'id_usuario', 'uuid_erp']);
        const rutInput = pickRowValue(rawRow, ['RUT', 'run', 'id']);
        const nombresInput = pickRowValue(rawRow, ['Nombres', 'nombre', 'name']);
        const apellidosInput = pickRowValue(rawRow, ['Apellidos', 'apellido', 'lastname']);
        const emailInput = pickRowValue(rawRow, ['Email', 'correo', 'mail']);
        const telefonoInput = pickRowValue(rawRow, ['Teléfono', 'telefono', 'phone']);
        const rolInput = pickRowValue(rawRow, ['Rol', 'rol', 'role']);
        const cursoInput = pickRowValue(rawRow, ['Curso', 'grade']);
        const seccionInput = pickRowValue(rawRow, ['Sección', 'seccion']);
        const generoInput = pickRowValue(rawRow, ['Género', 'genero', 'gender']);
        const nacimientoInput = pickRowValue(rawRow, ['Fecha Nacimiento', 'fecha_nacimiento', 'nacimiento']);
        const userUsername = pickRowValue(rawRow, ['Nombre Usuario', 'nombre_usuario', 'username']);
        const rutApoderado = pickRowValue(rawRow, ['RUT Apoderados', 'apoderado_rut', 'rut_apoderado']);
        const snapshotRow = sanitizeSnapshotRow(rawRow);

        // 2. NORMALIZATIONS
        const { rut, dv } = normalizeRutAndDv(rutInput);
        if (!rut) {
          summary.errors.push({ row: excelRowNumber, message: 'RUT vacío o inválido.' });
          await client.query(`RELEASE SAVEPOINT ${rowSavepoint}`);
          continue;
        }

        if (!nombresInput) {
          summary.errors.push({ row: excelRowNumber, message: 'Falta nombre del usuario.' });
          await client.query(`RELEASE SAVEPOINT ${rowSavepoint}`);
          continue;
        }

        // Split apellidos into paterno / materno
        const surnameParts = (apellidosInput || '').split(/\s+/).filter(Boolean);
        const paterno = surnameParts.length > 0 ? surnameParts[0] : 'Sin Apellido';
        const materno = surnameParts.length > 1 ? surnameParts.slice(1).join(' ') : '';

        const rol = rolInput || 'Estudiante';
        const email = emailInput || null;
        const telefono = telefonoInput || null;
        const seccion = seccionInput || null;
        const genero = generoInput || null;
        const fechaNacimiento = normalizeDateInput(nacimientoInput);
        const username = userUsername || (nombresInput.charAt(0) + paterno).toLowerCase().replace(/\s+/g, '');
        // Barcode is clean RUT + DV
        const codigoBarra = (rut + (dv || '')).toUpperCase();

        // 3. RESOLVE COURSE
        let courseId = null;
        if (cursoInput) {
          const courseLookup = await client.query('SELECT id_curso FROM curso WHERE LOWER(nombre_curso) = LOWER($1) LIMIT 1', [cursoInput]);
          if (courseLookup.rows.length > 0) {
            courseId = courseLookup.rows[0].id_curso;
          } else {
            const insertedCourse = await client.query(
              'INSERT INTO curso (nombre_curso) VALUES ($1) RETURNING id_curso',
              [cursoInput]
            );
            courseId = insertedCourse.rows[0].id_curso;
          }
        }

        // 4. CHECK EXISTING BY RUT OR UUID
        const studentLookup = await client.query(
          `SELECT a.id_alumno, a.uuid_erp, a.rut,
                  COALESCE(s.raw_payload = $3::jsonb, false) AS sin_cambios
           FROM alumno a
           LEFT JOIN alumno_excel_snapshot s ON s.id_alumno = a.id_alumno
           WHERE a.rut = $1 OR (a.uuid_erp IS NOT NULL AND a.uuid_erp = $2)
           LIMIT 1`,
          [rut, uuidErp, JSON.stringify(snapshotRow)]
        );
        const existing = studentLookup.rows[0] || null;

        let idAlumno;
        if (!existing) {
          // INSERT
          const insRes = await client.query(
            `INSERT INTO alumno (
              uuid_erp, rut, dv, nombres, paterno, materno, email, telefono, rol,
              seccion, genero, fecha_nacimiento, nombre_usuario, rut_apoderado, codigo_barra
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             RETURNING id_alumno`,
            [
              uuidErp || null, rut, dv || null, nombresInput, paterno, materno || null,
              email, telefono, rol, seccion, genero, fechaNacimiento, username, rutApoderado, codigoBarra
            ]
          );
          idAlumno = insRes.rows[0].id_alumno;
          summary.inserted++;
        } else if (!existing.sin_cambios) {
          // UPDATE if different
          idAlumno = existing.id_alumno;

          const updateQuery = `
            UPDATE alumno
            SET uuid_erp = COALESCE($1, uuid_erp),
                dv = $2,
                nombres = $3,
                paterno = $4,
                materno = $5,
                email = COALESCE($6, email),
                telefono = COALESCE($7, telefono),
                rol = $8,
                seccion = COALESCE($9, seccion),
                genero = COALESCE($10, genero),
                fecha_nacimiento = COALESCE($11, fecha_nacimiento),
                nombre_usuario = COALESCE($12, nombre_usuario),
                rut_apoderado = COALESCE($13, rut_apoderado),
                codigo_barra = $14,
                fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE id_alumno = $15
          `;
          await client.query(updateQuery, [
            uuidErp || null, dv || null, nombresInput, paterno, materno || null,
            email, telefono, rol, seccion, genero, fechaNacimiento, username, rutApoderado, codigoBarra,
            idAlumno
          ]);
          summary.updated++;
        } else {
          idAlumno = existing.id_alumno;
          summary.unchanged++;
        }

        // 5. UPDATE MATRICULA / CURSO LINK
        if (courseId) {
          const matRes = await client.query('SELECT id_matricula, id_curso FROM matricula WHERE id_alumno = $1 LIMIT 1', [idAlumno]);
          if (matRes.rows.length === 0) {
            await client.query('INSERT INTO matricula (id_alumno, id_curso) VALUES ($1, $2)', [idAlumno, courseId]);
          } else if (matRes.rows[0].id_curso !== courseId) {
            await client.query('UPDATE matricula SET id_curso = $1 WHERE id_matricula = $2', [courseId, matRes.rows[0].id_matricula]);
          }
        }

        // 6. Guardar snapshot saneado. La importación nunca crea ni modifica cuentas de acceso.
        await client.query(
          `INSERT INTO alumno_excel_snapshot (id_alumno, raw_payload, fecha_importacion)
           VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
           ON CONFLICT (id_alumno)
           DO UPDATE SET raw_payload = EXCLUDED.raw_payload, fecha_importacion = EXCLUDED.fecha_importacion`,
          [idAlumno, JSON.stringify(snapshotRow)]
        );

        await client.query(`RELEASE SAVEPOINT ${rowSavepoint}`);
      } catch (rowError) {
        await client.query(`ROLLBACK TO SAVEPOINT ${rowSavepoint}`);
        await client.query(`RELEASE SAVEPOINT ${rowSavepoint}`);
        console.error(`[bulk-sync] Row error at row ${excelRowNumber}:`, rowError.message);
        summary.errors.push({ row: excelRowNumber, message: rowError.message });
      }
    }

    await client.query('COMMIT');
    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'IMPORTACION_ALUMNOS',
      detalle: { total: summary.total, insertados: summary.inserted, actualizados: summary.updated, errores: summary.errors.length },
      ip: getClientIp(req)
    });
    res.json(summary);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err.message);
    res.status(500).json({ message: 'Error al sincronizar datos del colegio.' });
  } finally {
    client.release();
  }
});

// GET SINGLE STUDENT DETAILS
app.get('/api/students/:id/details', verifyToken, verifyRole(['admin']), async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT ${STUDENT_PUBLIC_FIELDS}, c.nombre_curso as grade
      FROM alumno a
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE a.id_alumno = $1
    `;
    const resA = await pool.query(query, [id]);
    if (resA.rows.length === 0) return res.status(404).json({ message: 'Miembro no encontrado.' });

    res.json({
      alumno: resA.rows[0]
    });
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener detalles.' });
  }
});

// CREATE STUDENT
app.post('/api/students', verifyToken, verifyRole(['admin']), async (req, res) => {
  const { rut, dv, nombres, paterno, materno, email, telefono, rol, grade } = req.body;
  if (!rut || !nombres || !paterno) {
    return res.status(400).json({ message: 'RUT, nombres y apellido paterno son requeridos.' });
  }
  const cleanRut = rut.replace(/\D/g, '');
  const cleanDv = (dv || '').toUpperCase();
  const codigoBarra = cleanRut + cleanDv;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const duplicate = await client.query('SELECT id_alumno FROM alumno WHERE rut = $1', [cleanRut]);
    if (duplicate.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ message: 'RUT ya registrado en el sistema.' });
    }

    const ins = await client.query(
      `INSERT INTO alumno (rut, dv, nombres, paterno, materno, email, telefono, rol, codigo_barra)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id_alumno`,
      [cleanRut, cleanDv, nombres, paterno, materno || null, email || null, telefono || null, rol || 'Estudiante', codigoBarra]
    );
    const idAlumno = ins.rows[0].id_alumno;

    // Course association
    if (grade) {
      let courseId;
      const courseLookup = await client.query('SELECT id_curso FROM curso WHERE LOWER(nombre_curso) = LOWER($1) LIMIT 1', [grade]);
      if (courseLookup.rows.length > 0) {
        courseId = courseLookup.rows[0].id_curso;
      } else {
        const insertedCourse = await client.query(
          'INSERT INTO curso (nombre_curso) VALUES ($1) ON CONFLICT (nombre_curso) DO UPDATE SET nombre_curso = EXCLUDED.nombre_curso RETURNING id_curso',
          [grade]
        );
        courseId = insertedCourse.rows[0].id_curso;
      }
      await client.query('INSERT INTO matricula (id_alumno, id_curso) VALUES ($1, $2)', [idAlumno, courseId]);
    }

    await client.query('COMMIT');

    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'CREAR_ALUMNO',
      entidad: 'alumno',
      entidad_id: idAlumno,
      detalle: { nombres, paterno, rut },
      ip: getClientIp(req)
    });

    res.json({ id_alumno: idAlumno, message: 'Miembro creado exitosamente.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(err.message);
    if (err.code === '23505') return res.status(409).json({ message: 'El RUT, usuario o código de barra ya se encuentra registrado.' });
    res.status(500).json({ message: 'Error al crear miembro.' });
  } finally {
    client.release();
  }
});

// UPDATE STUDENT
app.put('/api/students/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { nombres, paterno, materno, email, telefono, rol, grade } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE alumno
       SET nombres = $1, paterno = $2, materno = $3, email = $4, telefono = $5, rol = $6
       WHERE id_alumno = $7 RETURNING id_alumno`,
      [nombres, paterno, materno || null, email || null, telefono || null, rol, id]
    );
    if (updated.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Miembro no encontrado.' });
    }

    if (grade) {
      let courseId;
      const courseLookup = await client.query('SELECT id_curso FROM curso WHERE LOWER(nombre_curso) = LOWER($1) LIMIT 1', [grade]);
      if (courseLookup.rows.length > 0) {
        courseId = courseLookup.rows[0].id_curso;
      } else {
        const insertedCourse = await client.query(
          'INSERT INTO curso (nombre_curso) VALUES ($1) ON CONFLICT (nombre_curso) DO UPDATE SET nombre_curso = EXCLUDED.nombre_curso RETURNING id_curso',
          [grade]
        );
        courseId = insertedCourse.rows[0].id_curso;
      }
      await pool.query(
        `INSERT INTO matricula (id_alumno, id_curso) VALUES ($1, $2)
         ON CONFLICT (id_alumno) DO UPDATE SET id_curso = EXCLUDED.id_curso`,
        [id, courseId]
      );
    }

    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'EDITAR_ALUMNO',
      entidad: 'alumno',
      entidad_id: id,
      detalle: { nombres, paterno },
      ip: getClientIp(req)
    });

    res.json({ message: 'Miembro actualizado exitosamente.' });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ message: 'Error al actualizar miembro.' });
  } finally {
    client.release();
  }
});

// DELETE STUDENT
app.delete('/api/students/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE alumno SET activo = false WHERE id_alumno = $1', [id]);

    await registrarAudit({
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'DESACTIVAR_ALUMNO',
      entidad: 'alumno',
      entidad_id: id,
      ip: getClientIp(req)
    });

    res.json({ message: 'Miembro desactivado exitosamente.' });
  } catch (err) {
    res.status(500).json({ message: 'Error al desactivar miembro.' });
  }
});

// SYSTEM USERS CRUD
app.get('/api/users', verifyToken, verifyRole(['admin']), async (req, res) => {
  try {
    const resU = await pool.query(`
      SELECT id, correo, rol, nombre, fecha_creacion, activo, debe_cambiar_password,
             ultimo_acceso, password_actualizado_en
      FROM usuarios
      ORDER BY activo DESC, COALESCE(nombre, correo) ASC
    `);
    res.json(resU.rows);
  } catch (err) {
    res.status(500).json({ message: 'Error al obtener usuarios.' });
  }
});

app.post('/api/users', verifyToken, verifyRole(['admin']), async (req, res) => {
  const { correo, password, rol, nombre } = req.body;
  if (!correo || !password || !rol) {
    return res.status(400).json({ message: 'Faltan campos requeridos.' });
  }
  const normalizedEmail = normalizeEmail(correo);
  const emailError = validateEmail(normalizedEmail);
  if (emailError) return res.status(400).json({ message: emailError });
  if (!validateSystemRole(rol)) {
    return res.status(400).json({ message: 'El rol seleccionado no es válido.' });
  }
  const passwordError = validatePassword(password);
  if (passwordError) return res.status(400).json({ message: passwordError });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(password, 12);
    const created = await client.query(
      `INSERT INTO usuarios (correo, password_hash, rol, nombre, debe_cambiar_password)
       VALUES ($1, $2, $3, $4, true)
       RETURNING id, correo, rol, nombre, fecha_creacion, activo, debe_cambiar_password`,
      [normalizedEmail, hash, rol, sanitizeText(nombre).slice(0, 100) || null]
    );
    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'CREAR_USUARIO',
      entidad: 'usuario',
      entidad_id: created.rows[0].id,
      detalle: { correo: normalizedEmail, rol, nombre: sanitizeText(nombre).slice(0, 100) || null },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');
    res.status(201).json({ message: 'Usuario creado con contraseña temporal.', user: created.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ message: 'Ya existe una cuenta con ese correo.' });
    res.status(500).json({ message: 'Error al crear usuario.' });
  } finally {
    client.release();
  }
});

app.put('/api/users/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { correo, password, rol, nombre } = req.body;
  const normalizedEmail = normalizeEmail(correo);
  const emailError = validateEmail(normalizedEmail);
  if (emailError) return res.status(400).json({ message: emailError });
  if (!validateSystemRole(rol)) return res.status(400).json({ message: 'El rol seleccionado no es válido.' });
  if (password) {
    const passwordError = validatePassword(password);
    if (passwordError) return res.status(400).json({ message: passwordError });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const targetRes = await client.query('SELECT * FROM usuarios WHERE id = $1 FOR UPDATE', [id]);
    if (targetRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    const target = targetRes.rows[0];

    if (target.activo && target.rol === 'admin' && rol !== 'admin') {
      const adminCount = await client.query("SELECT COUNT(*)::int AS total FROM usuarios WHERE rol = 'admin' AND activo = true");
      if (adminCount.rows[0].total <= 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'No se puede quitar el rol al último administrador.' });
      }
    }

    const safeName = sanitizeText(nombre).slice(0, 100) || null;
    const securityChanged = target.correo !== normalizedEmail || target.rol !== rol || Boolean(password);
    let hash = null;
    if (password) {
      hash = await bcrypt.hash(password, 12);
    }

    const updated = await client.query(`
      UPDATE usuarios
      SET correo = $1,
          password_hash = COALESCE($2, password_hash),
          rol = $3,
          nombre = $4,
          debe_cambiar_password = CASE
            WHEN $2::text IS NOT NULL AND id <> $5 THEN true
            WHEN $2::text IS NOT NULL THEN false
            ELSE debe_cambiar_password
          END,
          password_actualizado_en = CASE WHEN $2::text IS NOT NULL THEN CURRENT_TIMESTAMP ELSE password_actualizado_en END,
          token_version = token_version + CASE WHEN $6 THEN 1 ELSE 0 END
      WHERE id = $7
      RETURNING id, correo, rol, nombre, token_version, fecha_creacion, activo,
                debe_cambiar_password, ultimo_acceso, password_actualizado_en
    `, [normalizedEmail, hash, rol, safeName, req.user.id, securityChanged, id]);

    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: 'EDITAR_USUARIO',
      entidad: 'usuario',
      entidad_id: parseInt(id, 10),
      detalle: {
        antes: { correo: target.correo, rol: target.rol, nombre: target.nombre },
        despues: { correo: normalizedEmail, rol, nombre: safeName },
        cambio_password: Boolean(password)
      },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');

    const user = updated.rows[0];
    if (parseInt(id, 10) === req.user.id && securityChanged) setSessionCookie(res, user);
    res.json({ message: 'Usuario actualizado.', user });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') return res.status(409).json({ message: 'Ya existe una cuenta con ese correo.' });
    res.status(500).json({ message: 'Error al actualizar usuario.' });
  } finally {
    client.release();
  }
});

const setUserActiveStatus = async (req, res, forcedStatus = null) => {
  const { id } = req.params;
  const requestedStatus = forcedStatus === null ? req.body?.activo : forcedStatus;
  if (typeof requestedStatus !== 'boolean') {
    return res.status(400).json({ message: 'El estado activo debe ser verdadero o falso.' });
  }
  if (!requestedStatus && parseInt(id, 10) === req.user.id) {
    return res.status(409).json({ message: 'No puedes desactivar la cuenta con la que tienes la sesión iniciada.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const targetRes = await client.query('SELECT id, correo, rol, nombre, activo FROM usuarios WHERE id = $1 FOR UPDATE', [id]);
    if (targetRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }
    const target = targetRes.rows[0];
    if (!requestedStatus && target.activo && target.rol === 'admin') {
      const adminCount = await client.query("SELECT COUNT(*)::int AS total FROM usuarios WHERE rol = 'admin' AND activo = true");
      if (adminCount.rows[0].total <= 1) {
        await client.query('ROLLBACK');
        return res.status(409).json({ message: 'No se puede desactivar el último administrador.' });
      }
    }

    const updated = await client.query(`
      UPDATE usuarios
      SET activo = $1,
          token_version = token_version + CASE WHEN activo IS DISTINCT FROM $1 THEN 1 ELSE 0 END,
          intentos_fallidos = CASE WHEN $1 THEN 0 ELSE intentos_fallidos END,
          bloqueado_hasta = CASE WHEN $1 THEN NULL ELSE bloqueado_hasta END
      WHERE id = $2
      RETURNING id, correo, rol, nombre, activo, debe_cambiar_password, fecha_creacion,
                ultimo_acceso, password_actualizado_en
    `, [requestedStatus, id]);

    const action = requestedStatus ? 'ACTIVAR_USUARIO' : 'DESACTIVAR_USUARIO';
    await insertarAudit(client, {
      usuario_id: req.user.id,
      usuario_correo: req.user.correo,
      accion: action,
      entidad: 'usuario',
      entidad_id: parseInt(id, 10),
      detalle: { correo: target.correo, rol: target.rol, nombre: target.nombre, activo: requestedStatus },
      ip: getClientIp(req)
    });
    await client.query('COMMIT');
    res.json({
      message: requestedStatus ? 'Usuario activado.' : 'Usuario desactivado.',
      user: updated.rows[0]
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    res.status(500).json({ message: 'Error al cambiar el estado del usuario.' });
  } finally {
    client.release();
  }
};

app.patch('/api/users/:id/status', verifyToken, verifyRole(['admin']), (req, res) => setUserActiveStatus(req, res));
app.delete('/api/users/:id', verifyToken, verifyRole(['admin']), (req, res) => setUserActiveStatus(req, res, false));

// SYSTEM AUDIT
app.get('/api/audit', verifyToken, verifyRole(['admin']), async (req, res) => {
  const { accion, usuario_correo, desde, hasta, page = '1', limit = '20' } = req.query;

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const params = [];
  let idx = 1;

  if (accion)          { conditions.push(`a.accion = $${idx++}`);                          params.push(accion.trim()); }
  if (usuario_correo)  { conditions.push(`a.usuario_correo ILIKE $${idx++}`);              params.push(`%${usuario_correo.trim()}%`); }
  if (desde)           { conditions.push(`a.fecha >= $${idx++}`);                          params.push(desde); }
  if (hasta)           { conditions.push(`a.fecha < ($${idx++}::date + interval '1 day')`); params.push(hasta); }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM audit_log a ${whereClause}`,
      params
    );
    const total = parseInt(countRes.rows[0].count, 10);

    const dataRes = await pool.query(
      `SELECT a.id, a.usuario_id, a.usuario_correo, u.nombre AS usuario_nombre,
              a.accion, a.entidad, a.entidad_id, a.detalle, a.ip, a.fecha
       FROM audit_log a
       LEFT JOIN usuarios u ON u.id = a.usuario_id
       ${whereClause}
       ORDER BY a.fecha DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limitNum, offset]
    );

    res.json({ total, page: pageNum, pages: Math.ceil(total / limitNum) || 1, rows: dataRes.rows });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error al obtener auditoría.' });
  }
});

const ensureBaseData = async (isNewSchema) => {
  await pool.query(`
    INSERT INTO configuracion_asistencia (hora_entrada, hora_limite_atraso)
    SELECT '08:00:00', '08:15:00'
    WHERE NOT EXISTS (SELECT 1 FROM configuracion_asistencia)
  `);

  const baseCourses = [
    'Pre-Kinder', 'Kinder', '1° Básico', '2° Básico', '3° Básico', '4° Básico',
    '5° Básico', '6° Básico', '7° Básico', '8° Básico',
    '1° Medio', '2° Medio', '3° Medio', '4° Medio'
  ];
  for (const course of baseCourses) {
    await pool.query(
      'INSERT INTO curso (nombre_curso) VALUES ($1) ON CONFLICT (nombre_curso) DO NOTHING',
      [course]
    );
  }

  if (!isNewSchema) return;
  const hash = await bcrypt.hash(getDefaultUserPassword(), 12);
  await pool.query(
    "INSERT INTO usuarios (correo, password_hash, rol, nombre, debe_cambiar_password) VALUES ($1, $2, 'lector', 'Lector Puerta', true) ON CONFLICT (correo) DO NOTHING",
    ['lector@ldsm.local', hash]
  );
  await pool.query(
    "INSERT INTO usuarios (correo, password_hash, rol, nombre, debe_cambiar_password) VALUES ($1, $2, 'admin', 'Administrador General', true) ON CONFLICT (correo) DO NOTHING",
    ['admin@ldsm.local', hash]
  );
};

const startServer = async () => {
  const isNewSchema = await bootstrapBaseSchema();
  await runMigrations(pool);
  await ensureBaseData(isNewSchema);

  return app.listen(PORT, () => {
    console.log(`Servidor listo en el puerto ${PORT}`);
  });
};

if (require.main === module) {
  startServer().catch((error) => {
    console.error('No fue posible iniciar el servidor:', error.message);
    process.exit(1);
  });
}

module.exports = { app, bootstrapBaseSchema, ensureBaseData, startServer };
