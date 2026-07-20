const express = require('express');
const cors = require('cors');
const pool = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const { randomUUID } = require('crypto');
const { rateLimit } = require('express-rate-limit');
require('dotenv').config();

const { verifyToken, verifyRole, JWT_SECRET } = require('./middleware/auth');
const { runMigrations } = require('./migrations');
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

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,100}$/;

app.use((req, res, next) => {
  const suppliedRequestId = String(req.get('x-request-id') || '');
  const requestId = REQUEST_ID_PATTERN.test(suppliedRequestId) ? suppliedRequestId : randomUUID();
  const startedAt = process.hrtime.bigint();

  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  res.on('finish', () => {
    if (req.path === '/api/health' || req.path.startsWith('/api/health/')) return;

    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    console.info(JSON.stringify({
      event: 'http_request',
      request_id: requestId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      duration_ms: Number(durationMs.toFixed(2)),
      user_id: req.user?.id || null
    }));
  });

  next();
});

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
  skip: (req) => req.path === '/health' || req.path.startsWith('/health/'),
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
  secure: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true',
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

// OPERATIONAL HEALTH
app.get('/api/health/live', (req, res) => {
  res.json({
    status: 'OK',
    service: 'ldsm-puntualidad',
    uptime_seconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

const readinessHandler = async (req, res) => {
  try {
    const database = await pool.query(`
      SELECT
        current_database() AS name,
        to_regclass('public.schema_migrations') IS NOT NULL AS migrations_ready
    `);
    const ready = Boolean(database.rows[0]?.migrations_ready);

    res.status(ready ? 200 : 503).json({
      status: ready ? 'OK' : 'ERROR',
      service: 'ldsm-puntualidad',
      database: ready ? 'ready' : 'migrations_unavailable',
      timestamp: new Date().toISOString()
    });
  } catch {
    res.status(503).json({
      status: 'ERROR',
      service: 'ldsm-puntualidad',
      database: 'unavailable',
      timestamp: new Date().toISOString()
    });
  }
};

app.get('/api/health/ready', readinessHandler);
app.get('/api/health', readinessHandler);

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
// permanecen bloqueados para que instalaciones antiguas reciban una respuesta
// inequívoca. La implementación heredada ya no forma parte del servidor activo.
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
          OR LOWER(a.rut || '-' || COALESCE(a.dv, '')) LIKE $1
          OR LOWER(a.rut || COALESCE(a.dv, '')) LIKE $1
          OR LOWER(COALESCE(a.codigo_barra, '')) LIKE $1
          OR LOWER(a.rut) LIKE $1
          OR LOWER(COALESCE(a.nombre_usuario, '')) LIKE $1
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
// Alias transitorio de ingreso: conserva lectores instalados mientras se migra
// su destino a POST /api/puntualidad/registros. Aplica las mismas reglas.
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

const registerShutdownHandlers = (server, options = {}) => {
  const databasePool = options.databasePool || pool;
  const logger = options.logger || console;
  const processReference = options.processReference || process;
  const timeoutMs = options.timeoutMs || 10000;
  let shuttingDown = false;

  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`[OPERACION] ${signal}: cerrando conexiones de forma segura.`);

    const forcedExit = setTimeout(() => {
      logger.error('[OPERACION] El cierre seguro excedio el tiempo maximo.');
      processReference.exit(1);
    }, timeoutMs);
    forcedExit.unref?.();

    server.close(async (serverError) => {
      try {
        await databasePool.end();
      } catch (databaseError) {
        logger.error(`[OPERACION] Error cerrando PostgreSQL: ${databaseError.message}`);
        processReference.exitCode = 1;
      } finally {
        clearTimeout(forcedExit);
      }

      if (serverError) {
        logger.error(`[OPERACION] Error cerrando HTTP: ${serverError.message}`);
        processReference.exitCode = 1;
      } else {
        logger.info('[OPERACION] Servicio detenido correctamente.');
      }
    });
  };

  processReference.once('SIGTERM', () => shutdown('SIGTERM'));
  processReference.once('SIGINT', () => shutdown('SIGINT'));
  return shutdown;
};

if (require.main === module) {
  startServer()
    .then((server) => registerShutdownHandlers(server))
    .catch((error) => {
      console.error('No fue posible iniciar el servidor:', error.message);
      process.exit(1);
    });
}

module.exports = {
  app,
  bootstrapBaseSchema,
  ensureBaseData,
  readinessHandler,
  registerShutdownHandlers,
  startServer
};
