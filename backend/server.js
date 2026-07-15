const express = require('express');
const cors = require('cors');
const pool = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { verifyToken, verifyRole, JWT_SECRET } = require('./middleware/auth');

const app = express();

// CORS CONFIGURATION
const rawOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
let allowedOrigins = rawOrigin.split(',').map(o => o.trim());
const fallbackOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5000',
  'http://127.0.0.1:5000'
];
fallbackOrigins.forEach(origin => {
  if (!allowedOrigins.includes(origin)) {
    allowedOrigins.push(origin);
  }
});

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

app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

const PORT = process.env.PORT || 5000;

const getDefaultUserPassword = () => {
  const password = process.env.DEFAULT_USER_PASSWORD;
  if (!password || password.length < 8) {
    throw new Error('DEFAULT_USER_PASSWORD debe existir y tener al menos 8 caracteres.');
  }
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


const calculateStatusAndSeverity = (tipoRegistro, currentTimeStr, config) => {
  if (tipoRegistro !== 'Entrada') {
    return { status: 'Salida', severidad: 'Normal' };
  }
  
  const threshold = config.hora_limite_atraso || '08:15:00';
  if (currentTimeStr < threshold) {
    return { status: 'Presente', severidad: 'Normal' };
  }

  let graveLimit = '08:30:00';
  if (threshold !== '08:15:00') {
    try {
      const [h, m, s] = threshold.split(':').map(Number);
      const date = new Date();
      date.setHours(h, m + 15, s || 0);
      graveLimit = date.toTimeString().split(' ')[0];
    } catch (e) {
      graveLimit = '08:30:00';
    }
  }

  const severidad = (currentTimeStr <= graveLimit) ? 'Leve' : 'Grave';
  return { status: 'Atrasado', severidad };
};

// AUDIT HELPER
const registrarAudit = async ({ usuario_id, usuario_correo, accion, entidad, entidad_id, detalle, ip }) => {
  try {
    await pool.query(
      `INSERT INTO audit_log (usuario_id, usuario_correo, accion, entidad, entidad_id, detalle, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [usuario_id, usuario_correo, accion, entidad, entidad_id, detalle ? JSON.stringify(detalle) : null, ip]
    );
  } catch (err) {
    console.error('Audit Log Error:', err.message);
  }
};

const getClientIp = (req) => {
  return req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
};

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

const runMigrations = async () => {
  console.log('Ejecutando migraciones de base de datos...');
  try {
    await pool.query("ALTER TABLE attendance_registrations ADD COLUMN IF NOT EXISTS severidad VARCHAR(20) DEFAULT 'Normal'");
    await pool.query("ALTER TABLE attendance_registrations ADD COLUMN IF NOT EXISTS justificado BOOLEAN DEFAULT false");
    await pool.query("ALTER TABLE attendance_registrations ADD COLUMN IF NOT EXISTS tipo_justificacion VARCHAR(50)");
    await pool.query("ALTER TABLE attendance_registrations ADD COLUMN IF NOT EXISTS comentario_justificacion TEXT");
    await pool.query("ALTER TABLE attendance_registrations ADD COLUMN IF NOT EXISTS archivo_justificacion VARCHAR(255)");
    console.log('Migraciones completadas con éxito.');
  } catch (err) {
    console.error('Error al ejecutar migraciones de base de datos:', err.message);
  }
};

// HEALTH CHECK
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// AUTHENTICATION
app.post('/api/auth/login', async (req, res) => {
  const { correo, password } = req.body;
  if (!correo || !password) {
    return res.status(400).json({ message: 'Correo/Usuario y Contraseña son requeridos.' });
  }

  try {
    // Find by email or username
    const userRes = await pool.query(
      'SELECT * FROM usuarios WHERE LOWER(correo) = LOWER($1) OR LOWER(nombre) = LOWER($1) LIMIT 1',
      [correo.trim()]
    );

    if (userRes.rows.length === 0) {
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    const user = userRes.rows[0];

    // Check if blocked
    if (user.bloqueado_hasta && new Date(user.bloqueado_hasta) > new Date()) {
      return res.status(403).json({ message: 'Cuenta bloqueada temporalmente. Intente más tarde.' });
    }

    const validPass = await bcrypt.compare(password, user.password_hash);
    if (!validPass) {
      // Increment failed attempts
      await pool.query('UPDATE usuarios SET intentos_fallidos = intentos_fallidos + 1 WHERE id = $1', [user.id]);
      if (user.intentos_fallidos >= 4) {
        const blockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 mins block
        await pool.query('UPDATE usuarios SET bloqueado_hasta = $1, intentos_fallidos = 0 WHERE id = $2', [blockUntil, user.id]);
      }
      return res.status(401).json({ message: 'Credenciales inválidas.' });
    }

    // Reset failed attempts
    await pool.query('UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { id: user.id, correo: user.correo, rol: user.rol, nombre: user.nombre, token_version: user.token_version },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000 // 12 hours
    });

    registrarAudit({
      usuario_id: user.id,
      usuario_correo: user.correo,
      accion: 'LOGIN_EXITOSO',
      ip: getClientIp(req)
    });

    res.json({
      user: { id: user.id, correo: user.correo, rol: user.rol, nombre: user.nombre }
    });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error en el servidor.' });
  }
});

app.get('/api/auth/me', verifyToken, async (req, res) => {
  try {
    const userRes = await pool.query('SELECT id, correo, rol, nombre FROM usuarios WHERE id = $1', [req.user.id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ message: 'Usuario no encontrado' });
    }
    res.json({ user: userRes.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Error en el servidor.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
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
    registrarAudit({
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
app.get('/api/students', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT a.*, c.nombre_curso as grade
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

    const now = new Date();
    const currentTimeStr = now.toLocaleTimeString([], { hour12: false });

    const { status: calculatedStatus, severidad } = calculateStatusAndSeverity(tipo_registro || 'Entrada', currentTimeStr, config);

    // 3. Check if already registered today
    const checkQuery = `
      SELECT id_registro, hora, estado FROM attendance_registrations
      WHERE id_alumno = $1 AND fecha = CURRENT_DATE AND tipo_registro = $2
    `;
    const checkRes = await pool.query(checkQuery, [alumno.id_alumno, tipo_registro || 'Entrada']);
    const alreadyRegistered = checkRes.rows.length > 0;
    const registroPrevio = checkRes.rows[0] || null;

    res.json({
      alumno,
      alreadyRegistered,
      registroPrevio,
      esBeneficiario: true, // Compatibility flag for scanner UI
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

    const now = new Date();
    const currentTimeStr = now.toLocaleTimeString([], { hour12: false });

    const { status: calculatedStatus, severidad } = calculateStatusAndSeverity(tipo_registro || 'Entrada', currentTimeStr, config);

    // Check if already registered today
    const checkQuery = `
      SELECT id_registro, hora, estado FROM attendance_registrations
      WHERE id_alumno = $1 AND fecha = CURRENT_DATE AND tipo_registro = $2
    `;
    const checkRes = await pool.query(checkQuery, [alumno.id_alumno, tipo_registro || 'Entrada']);
    const alreadyRegistered = checkRes.rows.length > 0;

    res.json({
      alumno,
      alreadyRegistered,
      esBeneficiario: true,
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
  const { id_alumno, tipo_registro } = req.body;
  if (!id_alumno) {
    return res.status(400).json({ message: 'ID del alumno es requerido.' });
  }

  const type = tipo_registro || 'Entrada';

  try {
    // Check duplication
    const duplicateCheck = await pool.query(
      'SELECT id_registro FROM attendance_registrations WHERE id_alumno = $1 AND fecha = CURRENT_DATE AND tipo_registro = $2',
      [id_alumno, type]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(409).json({ message: 'Registro ya realizado hoy.' });
    }

    // Determine status
    const configRes = await pool.query('SELECT * FROM configuracion_asistencia LIMIT 1');
    const config = configRes.rows[0] || { hora_entrada: '08:00:00', hora_limite_atraso: '08:15:00' };

    const now = new Date();
    const currentTimeStr = now.toLocaleTimeString([], { hour12: false });

    const { status, severidad } = calculateStatusAndSeverity(type, currentTimeStr, config);

    const insertQuery = `
      INSERT INTO attendance_registrations (id_alumno, fecha, hora, estado, tipo_registro, severidad)
      VALUES ($1, CURRENT_DATE, CURRENT_TIME, $2, $3, $4)
      RETURNING *
    `;
    const result = await pool.query(insertQuery, [id_alumno, status, type, severidad]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error al registrar asistencia.' });
  }
});

app.get('/api/asistencia/today', verifyToken, async (req, res) => {
  try {
    const query = `
      SELECT r.id_registro, r.fecha, r.hora, r.estado, r.tipo_registro, r.comentario,
             r.severidad, r.justificado, r.tipo_justificacion, r.comentario_justificacion, r.archivo_justificacion,
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
    // Total students active
    const totalStudentsRes = await pool.query("SELECT COUNT(*) FROM alumno WHERE rol = 'Estudiante' AND activo = true");
    const totalStudents = parseInt(totalStudentsRes.rows[0].count, 10);

    // Late scans (status = 'Atrasado' in Entrada)
    const lateRes = await pool.query(
      "SELECT COUNT(DISTINCT id_alumno) FROM attendance_registrations WHERE fecha = CURRENT_DATE AND tipo_registro = 'Entrada' AND estado = 'Atrasado'"
    );
    const late = parseInt(lateRes.rows[0].count, 10);

    // Absent students (explicitly registered as 'Ausente' today)
    const absentRes = await pool.query(
      "SELECT COUNT(DISTINCT id_alumno) FROM attendance_registrations WHERE fecha = CURRENT_DATE AND tipo_registro = 'Entrada' AND estado = 'Ausente'"
    );
    const absent = parseInt(absentRes.rows[0].count, 10);

    // Present students (everyone who is not late and not absent today)
    const presentCount = Math.max(0, totalStudents - late - absent);

    res.json({
      total: late + absent,
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

    // 7. Total present students (total student-days minus delays and all absences)
    const totalStudentDays = totalStudents * activeDays;
    const totalPresentes = Math.max(0, totalStudentDays - totalAtrasadosVal - totalAusentesJustificados - totalInasistencias);

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
             r.id_registro, r.justificado, r.tipo_justificacion, r.comentario_justificacion, r.archivo_justificacion, r.hora, r.estado
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
             r.severidad, r.justificado, r.tipo_justificacion, r.comentario_justificacion, r.archivo_justificacion,
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
  const { desde, hasta, tipo, cursoId, nivelId, alumnoId, alumnosIds } = req.query;
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
          r.fecha::TEXT as fecha_entrega, r.estado as tipo_alimentacion, r.tipo_registro, r.hora,
          r.severidad, r.justificado, r.tipo_justificacion, r.comentario_justificacion, r.archivo_justificacion
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
          r.fecha::TEXT as fecha_entrega, r.estado as tipo_alimentacion, r.tipo_registro, r.hora,
          r.severidad, r.justificado, r.tipo_justificacion, r.comentario_justificacion, r.archivo_justificacion
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

  try {
    const checkRecord = await pool.query(
      "SELECT estado, id_alumno, fecha FROM attendance_registrations WHERE id_registro = $1",
      [id]
    );
    if (checkRecord.rows.length === 0) {
      return res.status(404).json({ message: 'Registro no encontrado.' });
    }
    const record = checkRecord.rows[0];
    if (record.estado === 'Atrasado' && tipo_justificacion === 'medica') {
      return res.status(400).json({ message: 'Los atrasos solo pueden ser justificados por apoderados, no médicamente.' });
    }

    let uniqueName = null;
    if (fileData && fileName && record.estado !== 'Atrasado') {
      const uploadsDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const base64Content = fileData.replace(/^data:.*;base64,/, "");
      const fileExt = path.extname(fileName) || '.pdf';
      uniqueName = `justification_${id}_${Date.now()}${fileExt}`;
      fs.writeFileSync(path.join(uploadsDir, uniqueName), base64Content, 'base64');
    }

    const query = `
      UPDATE attendance_registrations
      SET justificado = true,
          tipo_justificacion = $1,
          comentario_justificacion = $2,
          archivo_justificacion = COALESCE($3, archivo_justificacion)
      WHERE id_registro = $4
      RETURNING *
    `;
    const result = await pool.query(query, [
      record.estado === 'Atrasado' ? 'apoderado' : tipo_justificacion,
      comentario_justificacion,
      uniqueName,
      id
    ]);

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
        archivo: uniqueName
      },
      ip: getClientIp(req)
    });

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error al procesar la justificación.' });
  }
});

app.post('/api/asistencia/justificar-nueva', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  const { id_alumno, fecha, fecha_inicio, fecha_fin, tipo_justificacion, comentario_justificacion, fileName, fileData } = req.body;

  if (!id_alumno) {
    return res.status(400).json({ message: 'ID del alumno es requerido.' });
  }

  try {
    let uniqueName = null;
    if (fileData && fileName && tipo_justificacion === 'medica') {
      const uploadsDir = path.join(__dirname, 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const base64Content = fileData.replace(/^data:.*;base64,/, "");
      const fileExt = path.extname(fileName) || '.pdf';
      uniqueName = `justification_range_${id_alumno}_${Date.now()}${fileExt}`;
      fs.writeFileSync(path.join(uploadsDir, uniqueName), base64Content, 'base64');
    }

    let datesToProcess = [];
    if (fecha_inicio && fecha_fin) {
      const curr = new Date(fecha_inicio + 'T12:00:00');
      const end = new Date(fecha_fin + 'T12:00:00');
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
      return res.status(400).json({ message: 'No hay días hábiles en el rango seleccionado.' });
    }

    const processedIds = [];

    for (const targetDate of datesToProcess) {
      const checkQuery = `
        SELECT id_registro, estado FROM attendance_registrations
        WHERE id_alumno = $1 AND fecha = $2 AND tipo_registro = 'Entrada'
      `;
      const checkRes = await pool.query(checkQuery, [id_alumno, targetDate]);

      if (checkRes.rows.length > 0) {
        const record = checkRes.rows[0];
        const isAtrasado = record.estado === 'Atrasado';

        await pool.query(`
          UPDATE attendance_registrations
          SET justificado = true,
              tipo_justificacion = $1,
              comentario_justificacion = $2,
              archivo_justificacion = COALESCE($3, archivo_justificacion)
          WHERE id_registro = $4
        `, [isAtrasado ? 'apoderado' : tipo_justificacion, comentario_justificacion, isAtrasado ? null : uniqueName, record.id_registro]);
        
        processedIds.push(record.id_registro);
      } else {
        const insertRes = await pool.query(`
          INSERT INTO attendance_registrations (id_alumno, fecha, hora, estado, tipo_registro, justificado, tipo_justificacion, comentario_justificacion, archivo_justificacion)
          VALUES ($1, $2, CURRENT_TIME, 'Ausente', 'Entrada', true, $3, $4, $5)
          RETURNING id_registro
        `, [id_alumno, targetDate, tipo_justificacion, comentario_justificacion, uniqueName]);
        
        processedIds.push(insertRes.rows[0].id_registro);
      }
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
        archivo: uniqueName,
        dias_procesados: datesToProcess,
        ids_registros: processedIds
      },
      ip: getClientIp(req)
    });

    res.json({ message: 'Justificación registrada con éxito.', ids: processedIds });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error al registrar la justificación.' });
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

  try {
    const checkRecord = await pool.query(
      "SELECT id_registro, id_alumno, fecha, estado, archivo_justificacion FROM attendance_registrations WHERE id_registro = $1",
      [id]
    );

    if (checkRecord.rows.length === 0) {
      return res.status(404).json({ message: 'Registro no encontrado.' });
    }

    const record = checkRecord.rows[0];

    if (record.archivo_justificacion) {
      const uploadsDir = path.join(__dirname, 'uploads');
      const filePath = path.join(uploadsDir, record.archivo_justificacion);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (fileErr) {
        console.error('Error deleting file:', fileErr.message);
      }
    }

    if (record.estado === 'Ausente') {
      await pool.query("DELETE FROM attendance_registrations WHERE id_registro = $1", [id]);
    } else {
      await pool.query(`
        UPDATE attendance_registrations
        SET justificado = false,
            tipo_justificacion = null,
            comentario_justificacion = null,
            archivo_justificacion = null
        WHERE id_registro = $1
      `, [id]);
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
        archivo_eliminado: record.archivo_justificacion
      },
      ip: getClientIp(req)
    });

    res.json({ message: 'Justificación eliminada/revocada con éxito.' });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Error al eliminar la justificación.' });
  }
});

app.get('/api/asistencia/justificaciones', verifyToken, verifyRole(['admin', 'secretaria']), async (req, res) => {
  const { desde, hasta, id_curso, search } = req.query;
  try {
    let query = `
      SELECT r.id_registro, r.fecha, r.hora, r.estado, r.tipo_registro, r.comentario,
             r.severidad, r.justificado, r.tipo_justificacion, r.comentario_justificacion, r.archivo_justificacion,
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

app.get('/api/asistencia/download/:id', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('SELECT archivo_justificacion FROM attendance_registrations WHERE id_registro = $1', [id]);
    if (result.rows.length === 0 || !result.rows[0].archivo_justificacion) {
      return res.status(404).json({ message: 'No existe archivo adjunto para esta justificación.' });
    }

    const filename = result.rows[0].archivo_justificacion;
    const filePath = path.join(__dirname, 'uploads', filename);

    if (fs.existsSync(filePath)) {
      res.download(filePath, filename);
    } else {
      res.status(404).json({ message: 'El archivo no fue encontrado en el servidor.' });
    }
  } catch (err) {
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

    const salt = await bcrypt.genSalt(10);
    const defaultUserPassword = getDefaultUserPassword();
    const defaultPassHash = await bcrypt.hash(defaultUserPassword, salt);

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
        const userPassword = pickRowValue(rawRow, ['Contraseña', 'contrasena', 'password']);
        const rutApoderado = pickRowValue(rawRow, ['RUT Apoderados', 'apoderado_rut', 'rut_apoderado']);

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
        const contrasena = userPassword || defaultUserPassword;

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
          'SELECT id_alumno, uuid_erp, rut FROM alumno WHERE rut = $1 OR (uuid_erp IS NOT NULL AND uuid_erp = $2) LIMIT 1',
          [rut, uuidErp]
        );
        const existing = studentLookup.rows[0] || null;

        let idAlumno;
        let rowChanged = false;

        if (!existing) {
          // INSERT
          const insRes = await client.query(
            `INSERT INTO alumno (
              uuid_erp, rut, dv, nombres, paterno, materno, email, telefono, rol,
              seccion, genero, fecha_nacimiento, nombre_usuario, contrasena, rut_apoderado, codigo_barra
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
             RETURNING id_alumno`,
            [
              uuidErp || null, rut, dv || null, nombresInput, paterno, materno || null,
              email, telefono, rol, seccion, genero, fechaNacimiento, username, contrasena, rutApoderado, codigoBarra
            ]
          );
          idAlumno = insRes.rows[0].id_alumno;
          rowChanged = true;
          summary.inserted++;
        } else {
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
                contrasena = COALESCE($13, contrasena),
                rut_apoderado = COALESCE($14, rut_apoderado),
                codigo_barra = $15,
                fecha_actualizacion = CURRENT_TIMESTAMP
            WHERE id_alumno = $16
          `;
          await client.query(updateQuery, [
            uuidErp || null, dv || null, nombresInput, paterno, materno || null,
            email, telefono, rol, seccion, genero, fechaNacimiento, username, contrasena, rutApoderado, codigoBarra,
            idAlumno
          ]);
          rowChanged = true;
          summary.updated++;
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

        // 6. IF ROLE IS SYSTEM ACCESS (ADMIN OR STAFF/PROFESOR), UPSERT SYSTEM USER CREDENTIALS
        if (rol && rol !== 'Estudiante') {
          const userRole = (rol.toLowerCase().includes('admin') || rol.toLowerCase() === 'director') ? 'admin' : 'lector';
          const userEmail = email || `${username}@liceo.cl`;
          const passHash = contrasena ? await bcrypt.hash(contrasena, salt) : defaultPassHash;
          const userFullName = `${nombresInput} ${apellidosInput || ''}`.trim();

          await client.query(
            `INSERT INTO usuarios (correo, password_hash, rol, nombre)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (correo)
             DO UPDATE SET password_hash = EXCLUDED.password_hash, rol = EXCLUDED.rol, nombre = EXCLUDED.nombre`,
            [userEmail, passHash, userRole, userFullName]
          );
        }

        // SAVE SNAPSHOT
        await client.query(
          `INSERT INTO alumno_excel_snapshot (id_alumno, raw_payload, fecha_importacion)
           VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP)
           ON CONFLICT (id_alumno)
           DO UPDATE SET raw_payload = EXCLUDED.raw_payload, fecha_importacion = EXCLUDED.fecha_importacion`,
          [idAlumno, JSON.stringify(rawRow)]
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
    registrarAudit({
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
app.get('/api/students/:id/details', verifyToken, async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      SELECT a.*, c.nombre_curso as grade
      FROM alumno a
      LEFT JOIN matricula m ON a.id_alumno = m.id_alumno
      LEFT JOIN curso c ON m.id_curso = c.id_curso
      WHERE a.id_alumno = $1
    `;
    const resA = await pool.query(query, [id]);
    if (resA.rows.length === 0) return res.status(404).json({ message: 'Miembro no encontrado.' });
    
    // Add stub responses for tables we dropped to keep UI happy if they check details
    res.json({
      alumno: resA.rows[0],
      contactos: [],
      contactosConDetalle: [],
      salud: null,
      emergencia: null,
      pago: null,
      apoyo: null,
      beneficiario: null,
      restricciones: []
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

  try {
    const duplicate = await pool.query('SELECT id_alumno FROM alumno WHERE rut = $1', [cleanRut]);
    if (duplicate.rows.length > 0) {
      return res.status(409).json({ message: 'RUT ya registrado en el sistema.' });
    }

    const ins = await pool.query(
      `INSERT INTO alumno (rut, dv, nombres, paterno, materno, email, telefono, rol, codigo_barra)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id_alumno`,
      [cleanRut, cleanDv, nombres, paterno, materno || null, email || null, telefono || null, rol || 'Estudiante', codigoBarra]
    );
    const idAlumno = ins.rows[0].id_alumno;

    // Course association
    if (grade) {
      let courseId;
      const courseLookup = await pool.query('SELECT id_curso FROM curso WHERE LOWER(nombre_curso) = LOWER($1) LIMIT 1', [grade]);
      if (courseLookup.rows.length > 0) {
        courseId = courseLookup.rows[0].id_curso;
      } else {
        const insertedCourse = await pool.query(
          'INSERT INTO curso (nombre_curso) VALUES ($1) RETURNING id_curso',
          [grade]
        );
        courseId = insertedCourse.rows[0].id_curso;
      }
      await pool.query('INSERT INTO matricula (id_alumno, id_curso) VALUES ($1, $2)', [idAlumno, courseId]);
    }

    registrarAudit({
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
    console.error(err.message);
    res.status(500).json({ message: 'Error al crear miembro.' });
  }
});

// UPDATE STUDENT
app.put('/api/students/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { nombres, paterno, materno, email, telefono, rol, grade } = req.body;
  
  try {
    await pool.query(
      `UPDATE alumno
       SET nombres = $1, paterno = $2, materno = $3, email = $4, telefono = $5, rol = $6
       WHERE id_alumno = $7`,
      [nombres, paterno, materno || null, email || null, telefono || null, rol, id]
    );

    if (grade) {
      let courseId;
      const courseLookup = await pool.query('SELECT id_curso FROM curso WHERE LOWER(nombre_curso) = LOWER($1) LIMIT 1', [grade]);
      if (courseLookup.rows.length > 0) {
        courseId = courseLookup.rows[0].id_curso;
      } else {
        const insertedCourse = await pool.query(
          'INSERT INTO curso (nombre_curso) VALUES ($1) RETURNING id_curso',
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

    registrarAudit({
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
    res.status(500).json({ message: 'Error al actualizar miembro.' });
  }
});

// DELETE STUDENT
app.delete('/api/students/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('UPDATE alumno SET activo = false WHERE id_alumno = $1', [id]);
    
    registrarAudit({
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
    const resU = await pool.query('SELECT id, correo, rol, nombre, fecha_creacion FROM usuarios ORDER BY nombre ASC');
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
  try {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(password, salt);
    await pool.query(
      'INSERT INTO usuarios (correo, password_hash, rol, nombre) VALUES ($1, $2, $3, $4)',
      [correo.trim(), hash, rol, nombre || null]
    );
    res.json({ message: 'Usuario creado exitosamente.' });
  } catch (err) {
    res.status(500).json({ message: 'Error al crear usuario.' });
  }
});

app.put('/api/users/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
  const { id } = req.params;
  const { correo, password, rol, nombre } = req.body;
  try {
    if (password) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(password, salt);
      await pool.query(
        'UPDATE usuarios SET correo = $1, password_hash = $2, rol = $3, nombre = $4, token_version = token_version + 1 WHERE id = $5',
        [correo.trim(), hash, rol, nombre || null, id]
      );
    } else {
      await pool.query(
        'UPDATE usuarios SET correo = $1, rol = $2, nombre = $3 WHERE id = $4',
        [correo.trim(), rol, nombre || null, id]
      );
    }
    res.json({ message: 'Usuario actualizado.' });
  } catch (err) {
    res.status(500).json({ message: 'Error al actualizar usuario.' });
  }
});

app.delete('/api/users/:id', verifyToken, verifyRole(['admin']), async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ message: 'Usuario eliminado.' });
  } catch (err) {
    res.status(500).json({ message: 'Error al eliminar usuario.' });
  }
});

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

// START SERVER
app.listen(PORT, async () => {
  console.log(`Servidor escuchando en el puerto ${PORT}`);
  try {
    const isNewSchema = await bootstrapBaseSchema();
    await runMigrations();
    if (isNewSchema) {
      const salt = await bcrypt.genSalt(10);
      const hash = await bcrypt.hash(getDefaultUserPassword(), salt);
      
      // Default configurations
      await pool.query(
        "INSERT INTO configuracion_asistencia (hora_entrada, hora_limite_atraso) VALUES ('08:00:00', '08:15:00')"
      );
      
      // Default users
      await pool.query(
        "INSERT INTO usuarios (correo, password_hash, rol, nombre) VALUES ($1, $2, 'lector', 'Lector Puerta')",
        ['lector@colegio.cl', hash]
      );
      await pool.query(
        "INSERT INTO usuarios (correo, password_hash, rol, nombre) VALUES ($1, $2, 'admin', 'Administrador General')",
        ['admin@colegio.cl', hash]
      );
    }
  } catch (err) {
    console.error('Error al arrancar/verificar base de datos:', err.message);
  }
});
