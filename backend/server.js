const express = require('express');
const cors = require('cors');
const pool = require('./db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const { createHash, randomUUID } = require('crypto');
const { rateLimit } = require('express-rate-limit');
require('dotenv').config();

const { verifyToken, verifyPermission, verifyAnyPermission, JWT_SECRET } = require('./middleware/auth');
const { runMigrations } = require('./migrations');
const {
  normalizeEmail,
  sanitizeSnapshotRow,
  validateEmail,
  validatePassword
} = require('./utils/security');
const { calculateDelayMinutes, calculateStatusAndSeverity } = require('./utils/punctuality');
const { isIsoDate, validateDateRange } = require('./utils/validation');
const {
  MANUAL_IDENTITY_TYPES,
  normalizeManualStudentIdentity,
  normalizeStudentPayload,
  sanitizeStudentText,
  validateManualStudentIdentity,
  validateStudentPayload,
  validateStudentRut
} = require('./utils/students');
const { normalizeErpStudentIdentity } = require('./utils/studentErpIdentity');
const { findCourseMatch, normalizeCourseKey } = require('./utils/courseImport');
const { evaluateStudentReconciliation } = require('./utils/studentReconciliation');
const {
  compareStudentFields,
  detectIdentifierCollision,
  validateImportMode
} = require('./utils/studentImportGovernance');
const { createPunctualityRouter } = require('./routes/punctuality');
const { createVisitsRouter } = require('./routes/visits');
const { createOperationsRouter } = require('./routes/operations');
const { createVisitSettingsRouter } = require('./routes/visitSettings');
const { createFamiliesRouter } = require('./routes/families');
const { createStudentGovernanceRouter } = require('./routes/studentGovernance');
const { createCoexistenceRouter } = require('./routes/coexistence');
const { createStudentDocumentsRouter } = require('./routes/studentDocuments');
const { createAnalyticsRouter } = require('./routes/analytics');
const { createFollowUpRouter } = require('./routes/followUp');
const { createInternalChatRouter } = require('./routes/internalChat');
const { startInstitutionalReportScheduler } = require('./services/institutionalReportScheduler');
const { startInstitutionalFollowUpScheduler } = require('./services/institutionalFollowUpService');
const { registerAuthRoutes } = require('./routes/auth');
const { registerStudentRoutes } = require('./routes/students');
const { registerUserRoutes } = require('./routes/users');
const { registerAuditRoutes } = require('./routes/audit');
const { registerProfileRoutes } = require('./routes/profiles');
const { assignEnrollment, closeEnrollment } = require('./services/enrollmentService');
const { recordOperationalEvent } = require('./services/operationalEventService');
const {
  buildStudentIdentifierCandidates
} = require('./services/studentIdentifierService');
const {
  attachPermissionProfile,
  countActivePermissionHolders,
  getAccessProfile,
  getAccessProfiles,
  getPermissionCatalog,
  getRecommendedPermissions,
  normalizeProfileCode,
  replaceProfilePermissions,
  replaceUserPermissionOverrides,
  validatePermissionSelection
} = require('./utils/permissions');

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
if (String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true') {
  const secureVariants = allowedOrigins
    .filter(origin => origin.startsWith('http://'))
    .map(origin => origin.replace(/^http:\/\//, 'https://'));
  allowedOrigins = [...new Set([...allowedOrigins, ...secureVariants])];
}
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
  profile_name: user.profile_name || user.rol,
  nombre: user.nombre,
  cargo: user.cargo || null,
  personal_profile: user.personal_profile || null,
  debe_cambiar_password: Boolean(user.debe_cambiar_password),
  permissions: Array.isArray(user.permissions) ? user.permissions : [],
  recommended_permissions: Array.isArray(user.recommended_permissions) ? user.recommended_permissions : []
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

  // Cuando el ERP o la API entregan el DV en una columna/campo separado,
  // el cuerpo corresponde íntegramente al RUN y no debe perder su último dígito.
  if (rawDv) {
    return {
      rut: rawRut.replace(/\D/g, ''),
      dv: rawDv.replace(/[^0-9K]/g, '').slice(0, 1)
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

const getImportedStudentFields = (row) => {
  const apellidos = pickRowValue(row, ['Apellidos', 'apellido', 'lastname']);
  const surnameParts = apellidos.split(/\s+/).filter(Boolean);
  const curso = pickRowValue(row, ['Curso', 'grade']);
  return {
    uuid_erp: pickRowValue(row, ['ID de Usuario (no modificar)', 'id usuario', 'id_usuario', 'uuid_erp']),
    rut: pickRowValue(row, ['RUT', 'run', 'id']),
    dv: pickRowValue(row, ['DV', 'dígito verificador', 'digito verificador']),
    tipo_documento: pickRowValue(row, [
      'Tipo de documento',
      'tipo documento',
      'tipo_documento',
      'document type'
    ]),
    pais_emisor_documento: pickRowValue(row, [
      'País emisor',
      'Pais emisor',
      'país documento',
      'pais_documento',
      'country'
    ]),
    nombres: pickRowValue(row, ['Nombres', 'nombre', 'name']),
    apellidos,
    paterno: surnameParts[0] || '',
    materno: surnameParts.slice(1).join(' '),
    email: pickRowValue(row, ['Email', 'correo', 'mail']),
    telefono: pickRowValue(row, ['Teléfono', 'telefono', 'phone']),
    rol: pickRowValue(row, ['Rol', 'rol', 'role']) || 'Estudiante',
    curso,
    grade: curso,
    seccion: pickRowValue(row, ['Sección', 'seccion']),
    genero: pickRowValue(row, ['Género', 'genero', 'gender']),
    fecha_nacimiento: normalizeDateInput(pickRowValue(row, ['Fecha Nacimiento', 'fecha_nacimiento', 'nacimiento'])),
    nombre_usuario: pickRowValue(row, ['Nombre Usuario', 'nombre_usuario', 'username']),
    rut_apoderado: pickRowValue(row, ['RUT Apoderados', 'apoderado_rut', 'rut_apoderado'])
  };
};

const summarizeStudentImportRows = (rows) => {
  const counts = rows.reduce((summary, row) => {
    summary[row.status] = (summary[row.status] || 0) + 1;
    return summary;
  }, {});

  return {
    total: rows.length,
    valid: counts.VALIDA || 0,
    suggested: counts.EQUIVALENCIA_SUGERIDA || 0,
    unknown: counts.CURSO_DESCONOCIDO || 0,
    rejected: (counts.RECHAZADA || 0)
      + (counts.DUPLICADA_ARCHIVO || 0)
      + (counts.CONFLICTO_IDENTIDAD || 0)
      + (counts.COLISION_UUID_RUT || 0)
      + (counts.COLISION_IDENTIFICADORES || 0),
    conflicts: (counts.CONFLICTO_IDENTIDAD || 0)
      + (counts.COLISION_UUID_RUT || 0)
      + (counts.COLISION_IDENTIFICADORES || 0)
      + (counts.FICHA_INACTIVA_REAPARECE || 0),
    identifier_collisions: (counts.COLISION_UUID_RUT || 0)
      + (counts.COLISION_IDENTIFICADORES || 0),
    inactive_reappearances: rows.filter((row) => row.inactive_reappearance).length,
    manual_links: rows.filter((row) => row.reconciliation?.code === 'VINCULAR_MANUAL').length,
    accepted_by_erp_id: rows.filter((row) => row.identity?.acceptedByErpId).length,
    run_chile: rows.filter((row) => row.identity?.identityType === 'RUN_CHILE').length,
    ipe_mineduc: rows.filter((row) => row.identity?.identityType === 'IPE_MINEDUC').length,
    documentos_extranjeros: rows.filter((row) => row.identity?.identityType === 'DOCUMENTO_EXTRANJERO').length,
    solo_id_erp: rows.filter((row) => row.identity?.identityType === 'ID_ERP').length,
    without_course: rows.filter((row) => !row.curso_origen).length
  };
};

const buildStudentImportPreview = (rows, courses) => {
  const seenRuts = new Set();
  const seenErpIds = new Set();
  const seenDocuments = new Set();
  const preview = rows.map((row, index) => {
    const fields = getImportedStudentFields(row);
    const identity = normalizeErpStudentIdentity({
      uuidErp: fields.uuid_erp,
      rutInput: fields.rut,
      dvInput: fields.dv,
      documentTypeInput: fields.tipo_documento,
      countryCodeInput: fields.pais_emisor_documento,
      normalizeRutAndDv
    });
    const match = findCourseMatch(fields.curso, courses);
    const errors = [];
    const warnings = [];
    let status = 'VALIDA';

    if (!identity.canIdentify) {
      errors.push('Falta un RUT chileno válido o el identificador obligatorio del ERP.');
    }
    if (!fields.nombres) errors.push('Falta el nombre.');
    if (!fields.curso) {
      warnings.push('Sin curso informado; la persona se importará sin matrícula vigente.');
    }
    if (identity.identityType === 'IPE_MINEDUC') {
      warnings.push('Identificador provisorio escolar reconocido desde la fuente ERP.');
    } else if (identity.identityType === 'DOCUMENTO_EXTRANJERO') {
      warnings.push('Documento extranjero aceptado por formato y procedencia ERP; no se presenta como RUN chileno.');
      if (!identity.countryCode || !fields.tipo_documento) {
        warnings.push('Para una validación documental completa, informe tipo de documento y país emisor.');
      }
    } else if (identity.identityType === 'ID_ERP') {
      warnings.push('Sin documento informado; la ficha se identificará mediante el UUID único del ERP.');
    }

    const rutKey = identity.rut ? `${identity.rut}-${identity.dv}` : null;
    if (rutKey && seenRuts.has(rutKey)) {
      status = 'DUPLICADA_ARCHIVO';
      errors.push('El RUT está repetido dentro de la planilla.');
    }
    if (rutKey) seenRuts.add(rutKey);

    if (identity.uuidErp && seenErpIds.has(identity.uuidErp)) {
      status = 'DUPLICADA_ARCHIVO';
      errors.push('El identificador ERP está repetido dentro de la planilla.');
    }
    if (identity.uuidErp) seenErpIds.add(identity.uuidErp);

    const documentKey = !identity.hasValidRut ? identity.barcode : null;
    if (documentKey && seenDocuments.has(documentKey)) {
      status = 'DUPLICADA_ARCHIVO';
      errors.push('El documento está repetido dentro de la planilla.');
    }
    if (documentKey) seenDocuments.add(documentKey);

    if (errors.length && status !== 'DUPLICADA_ARCHIVO') status = 'RECHAZADA';
    if (!errors.length && fields.curso && match.kind === 'suggested') status = 'EQUIVALENCIA_SUGERIDA';
    if (!errors.length && fields.curso && match.kind === 'unknown') status = 'CURSO_DESCONOCIDO';

    return {
      row: index + 2,
      rut: fields.rut,
      dv: identity.dv,
      rut_normalizado: identity.rut,
      documento_erp: identity.documentoErp,
      tipo_identificador: identity.identityType,
      tipo_documento_extranjero: identity.foreignDocumentType,
      pais_emisor_documento: identity.countryCode,
      uuid_erp: identity.uuidErp,
      identity,
      nombres: fields.nombres,
      apellidos: fields.apellidos,
      imported: {
        ...fields,
        rut: identity.rut,
        dv: identity.dv,
        documento_erp: identity.documentoErp,
        tipo_identificador: identity.identityType,
        tipo_documento_extranjero: identity.foreignDocumentType,
        pais_emisor_documento: identity.countryCode
      },
      curso_origen: fields.curso,
      curso_key: normalizeCourseKey(fields.curso),
      status,
      errors,
      warnings,
      course: match.kind === 'exact' ? match.course : null,
      suggestion: match.course ? {
        id_curso: match.course.id_curso,
        nombre_curso: match.course.nombre_curso,
        score: Number(match.score.toFixed(2))
      } : null
    };
  });

  return {
    rows: preview,
    summary: summarizeStudentImportRows(preview)
  };
};

const enrichStudentImportPreview = async (preview, queryable = pool) => {
  const ruts = [...new Set(
    preview.rows
      .map((row) => row.rut_normalizado)
      .filter(Boolean)
  )];
  const uuids = [...new Set(
    preview.rows
      .map((row) => row.uuid_erp)
      .filter(Boolean)
  )];
  const documents = [...new Set(
    preview.rows
      .filter((row) => !row.identity?.hasValidRut)
      .map((row) => row.identity?.barcode)
      .filter(Boolean)
  )];
  const rowIdentifierCandidates = preview.rows.map((row) => (
    buildStudentIdentifierCandidates({
      identity: row.identity,
      barcode: row.codigo_barra,
      source: 'ERP'
    })
  ));
  const identifierValues = [...new Set(
    rowIdentifierCandidates
      .flat()
      .map((candidate) => candidate.normalizedValue)
      .filter(Boolean)
  )];
  if (!ruts.length && !uuids.length && !documents.length && !identifierValues.length) {
    return preview;
  }

  const existingResult = await queryable.query(
    `SELECT a.id_alumno, a.rut, a.dv, a.documento_erp,
            a.tipo_identificador, a.tipo_documento_extranjero, a.pais_emisor_documento,
            a.nombres, a.paterno, a.materno, a.activo,
            a.uuid_erp, a.email, a.telefono, a.rol, a.seccion, a.genero,
            a.fecha_nacimiento, a.nombre_usuario, a.rut_apoderado,
            a.origen_alta, a.erp_vinculado_en,
            c.nombre_curso AS grade
     FROM alumno a
     LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
     LEFT JOIN curso c ON c.id_curso = m.id_curso
     WHERE a.fusionado_en_id IS NULL
       AND (
         a.rut = ANY($1::text[])
         OR a.uuid_erp = ANY($2::text[])
         OR REGEXP_REPLACE(UPPER(COALESCE(a.documento_erp, '')), '[^0-9A-Z]', '', 'g') = ANY($3::text[])
       )`,
    [ruts, uuids, documents]
  );
  const existingByRut = new Map(
    existingResult.rows
      .filter((student) => student.rut)
      .map((student) => [student.rut, student])
  );
  const existingByUuid = new Map(
    existingResult.rows
      .filter((student) => student.uuid_erp)
      .map((student) => [student.uuid_erp, student])
  );
  const existingByDocument = new Map(
    existingResult.rows
      .filter((student) => student.documento_erp)
      .map((student) => [
        String(student.documento_erp).toUpperCase().replace(/[^0-9A-Z]/g, ''),
        student
      ])
  );
  const identifierResult = identifierValues.length
    ? await queryable.query(
      `SELECT ai.tipo, ai.valor_normalizado, ai.pais_emisor,
              a.id_alumno, a.rut, a.dv, a.documento_erp,
              a.tipo_identificador, a.tipo_documento_extranjero, a.pais_emisor_documento,
              a.nombres, a.paterno, a.materno, a.activo,
              a.uuid_erp, a.email, a.telefono, a.rol, a.seccion, a.genero,
              a.fecha_nacimiento, a.nombre_usuario, a.rut_apoderado,
              a.origen_alta, a.erp_vinculado_en,
              c.nombre_curso AS grade
       FROM alumno_identificador ai
       INNER JOIN alumno a ON a.id_alumno = ai.id_alumno
       LEFT JOIN matricula_actual m ON m.id_alumno = a.id_alumno
       LEFT JOIN curso c ON c.id_curso = m.id_curso
       WHERE a.fusionado_en_id IS NULL
         AND ai.estado <> 'REVOCADO'
         AND ai.valor_normalizado = ANY($1::text[])`,
      [identifierValues]
    )
    : { rows: [] };
  const existingByIdentifier = new Map();
  for (const student of identifierResult.rows) {
    const key = [
      student.tipo,
      student.valor_normalizado,
      student.pais_emisor || ''
    ].join(':');
    const matches = existingByIdentifier.get(key) || [];
    if (!matches.some((match) => Number(match.id_alumno) === Number(student.id_alumno))) {
      matches.push(student);
    }
    existingByIdentifier.set(key, matches);
  }

  const rows = preview.rows.map((row, index) => {
    const rutMatch = row.rut_normalizado ? existingByRut.get(row.rut_normalizado) || null : null;
    const uuidMatch = row.uuid_erp ? existingByUuid.get(row.uuid_erp) || null : null;
    const documentMatch = !row.identity?.hasValidRut && row.identity?.barcode
      ? existingByDocument.get(row.identity.barcode) || null
      : null;
    const identifierMatches = rowIdentifierCandidates[index]
      .flatMap((candidate) => (
        existingByIdentifier.get([
          candidate.type,
          candidate.normalizedValue,
          candidate.countryCode || ''
        ].join(':')) || []
      ));
    const allMatches = [
      rutMatch,
      uuidMatch,
      documentMatch,
      ...identifierMatches
    ].filter(Boolean);
    const uniqueMatches = [...new Map(
      allMatches.map((match) => [Number(match.id_alumno), match])
    ).values()];
    const collision = detectIdentifierCollision({
      rutMatch,
      uuidMatch,
      documentMatch,
      identifierMatches
    });
    const existing = uniqueMatches[0] || null;
    const reconciliation = evaluateStudentReconciliation(row, existing);
    const comparison = existing ? compareStudentFields(row.imported, existing) : [];
    const next = {
      ...row,
      reconciliation,
      identifier_collision: collision,
      inactive_reappearance: existing?.activo === false,
      field_comparison: comparison,
      existing_student: existing ? {
        id_alumno: existing.id_alumno,
        nombre: `${existing.nombres} ${existing.paterno} ${existing.materno || ''}`.trim(),
        curso: existing.grade || null,
        activo: existing.activo,
        origen_alta: existing.origen_alta
      } : null
    };

    if (collision && !['RECHAZADA', 'DUPLICADA_ARCHIVO'].includes(row.status)) {
      next.status = 'COLISION_IDENTIFICADORES';
      next.errors = [...(row.errors || []), collision.message];
    } else if (reconciliation.blocking && !['RECHAZADA', 'DUPLICADA_ARCHIVO'].includes(row.status)) {
      next.status = 'CONFLICTO_IDENTIDAD';
      next.errors = [
        ...(row.errors || []),
        `El RUT coincide, pero difieren ${reconciliation.differences.join(' y ')}. Revise la ficha antes de importar.`
      ];
    } else if (existing && existing.activo === false && row.status === 'VALIDA') {
      next.status = 'FICHA_INACTIVA_REAPARECE';
      next.errors = [
        ...(row.errors || []),
        'La nómina contiene una ficha inactiva. Debe comprobar su reincorporación antes de reactivarla.'
      ];
    }
    return next;
  });

  return {
    ...preview,
    rows,
    summary: summarizeStudentImportRows(rows)
  };
};

const STUDENT_PUBLIC_FIELDS = `
  a.id_alumno, a.uuid_erp, a.rut, a.dv, a.documento_erp,
  a.tipo_identificador, a.tipo_documento_extranjero, a.pais_emisor_documento,
  a.nombres, a.paterno, a.materno,
  a.email, a.telefono, a.rol, a.seccion, a.genero, a.fecha_nacimiento,
  a.nombre_usuario, a.rut_apoderado, a.activo, a.fecha_actualizacion,
  a.codigo_barra, a.origen_alta, a.erp_vinculado_en, a.creado_manualmente_por,
  a.motivo_alta_manual, a.detalle_alta_manual, a.creado_manualmente_en,
  a.fusionado_en_id
`;


const getInstitutionalClock = async (queryable = pool) => {
  const result = await queryable.query("SELECT TO_CHAR(LOCALTIME, 'HH24:MI:SS') AS hora");
  return result.rows[0].hora;
};

// AUDIT HELPER
const insertarAudit = async (queryable, { usuario_id, usuario_correo, accion, entidad, entidad_id, detalle, ip }) => {
  await queryable.query(
    `INSERT INTO audit_log
       (usuario_id, usuario_correo, accion, entidad, entidad_id, detalle, ip,
        perfil_codigo_snapshot, perfil_nombre_snapshot)
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       (SELECT u.rol FROM usuarios u WHERE u.id = $1),
       (SELECT COALESCE(p.nombre, u.rol)
        FROM usuarios u
        LEFT JOIN perfiles_acceso p ON p.codigo = u.rol
        WHERE u.id = $1)
     )`,
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
  verifyPermission,
  verifyAnyPermission,
  insertarAudit,
  getClientIp
}));

app.use('/api/visitas', createVisitsRouter({
  pool,
  verifyToken,
  verifyPermission,
  verifyAnyPermission,
  insertarAudit,
  getClientIp
}));

app.use('/api/operaciones', createOperationsRouter({
  pool,
  verifyToken,
  verifyPermission,
  verifyAnyPermission,
  insertarAudit,
  getClientIp
}));

app.use('/api/configuracion-visitas', createVisitSettingsRouter({
  pool,
  verifyToken,
  verifyPermission,
  insertarAudit,
  getClientIp
}));

app.use('/api/familias', createFamiliesRouter({
  pool,
  verifyToken,
  verifyPermission,
  insertarAudit,
  getClientIp
}));

app.use('/api/padron', createStudentGovernanceRouter({
  pool,
  verifyToken,
  verifyPermission,
  verifyAnyPermission,
  insertarAudit,
  getClientIp
}));

app.use('/api/convivencia', createCoexistenceRouter({
  pool,
  verifyToken,
  verifyPermission,
  insertarAudit,
  getClientIp
}));

app.use('/api/documentos-estudiantes', createStudentDocumentsRouter({
  pool,
  verifyToken,
  verifyPermission,
  verifyAnyPermission,
  insertarAudit
}));

app.use('/api/analitica', createAnalyticsRouter({
  pool,
  verifyToken,
  verifyPermission,
  insertarAudit,
  getClientIp
}));

app.use('/api/seguimiento', createFollowUpRouter({
  pool,
  verifyToken,
  verifyPermission,
  verifyAnyPermission,
  insertarAudit,
  getClientIp
}));

app.use('/api/chat', createInternalChatRouter({
  pool,
  verifyToken,
  verifyPermission,
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

const routeContext = {
  app,
  pool,
  bcrypt,
  jwt,
  fs,
  path,
  createHash,
  loginLimiter,
  verifyToken,
  verifyPermission,
  verifyAnyPermission,
  JWT_SECRET,
  normalizeEmail,
  sanitizeSnapshotRow,
  validateEmail,
  validatePassword,
  calculateDelayMinutes,
  calculateStatusAndSeverity,
  isIsoDate,
  validateDateRange,
  MANUAL_IDENTITY_TYPES,
  normalizeManualStudentIdentity,
  normalizeStudentPayload,
  sanitizeStudentText,
  validateManualStudentIdentity,
  validateStudentPayload,
  validateStudentRut,
  normalizeErpStudentIdentity,
  findCourseMatch,
  normalizeCourseKey,
  evaluateStudentReconciliation,
  compareStudentFields,
  detectIdentifierCollision,
  validateImportMode,
  assignEnrollment,
  closeEnrollment,
  recordOperationalEvent,
  attachPermissionProfile,
  countActivePermissionHolders,
  getAccessProfile,
  getAccessProfiles,
  getPermissionCatalog,
  getRecommendedPermissions,
  normalizeProfileCode,
  replaceProfilePermissions,
  replaceUserPermissionOverrides,
  validatePermissionSelection,
  cookieOptions,
  toPublicUser,
  setSessionCookie,
  sanitizeText,
  normalizeHeaderKey,
  pickRowValue,
  normalizeRutAndDv,
  normalizeDateInput,
  getImportedStudentFields,
  summarizeStudentImportRows,
  buildStudentImportPreview,
  enrichStudentImportPreview,
  STUDENT_PUBLIC_FIELDS,
  getInstitutionalClock,
  insertarAudit,
  registrarAudit,
  getClientIp
};
registerAuthRoutes(routeContext);
registerStudentRoutes(routeContext);
registerUserRoutes(routeContext);
registerAuditRoutes(routeContext);
registerProfileRoutes(routeContext);

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
    "INSERT INTO usuarios (correo, password_hash, rol, nombre, cargo, debe_cambiar_password) VALUES ($1, $2, 'lector', 'Lector Puerta', 'Portería', true) ON CONFLICT (correo) DO NOTHING",
    ['lector@ldsm.local', hash]
  );
  await pool.query(
    "INSERT INTO usuarios (correo, password_hash, rol, nombre, cargo, debe_cambiar_password) VALUES ($1, $2, 'admin', 'Administrador General', 'Administrador/a del sistema', true) ON CONFLICT (correo) DO NOTHING",
    ['admin@ldsm.local', hash]
  );
};

const startServer = async () => {
  const isNewSchema = await bootstrapBaseSchema();
  await runMigrations(pool);
  await ensureBaseData(isNewSchema);

  return app.listen(PORT, () => {
    console.log(`Servidor listo en el puerto ${PORT}`);
    startInstitutionalReportScheduler(pool);
    startInstitutionalFollowUpScheduler(pool);
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
    logger.info(`[OPERACIÓN] ${signal}: cerrando conexiones de forma segura.`);

    const forcedExit = setTimeout(() => {
      logger.error('[OPERACIÓN] El cierre seguro excedió el tiempo máximo.');
      processReference.exit(1);
    }, timeoutMs);
    forcedExit.unref?.();

    server.close(async (serverError) => {
      try {
        await databasePool.end();
      } catch (databaseError) {
        logger.error(`[OPERACIÓN] Error cerrando PostgreSQL: ${databaseError.message}`);
        processReference.exitCode = 1;
      } finally {
        clearTimeout(forcedExit);
      }

      if (serverError) {
        logger.error(`[OPERACIÓN] Error cerrando HTTP: ${serverError.message}`);
        processReference.exitCode = 1;
      } else {
        logger.info('[OPERACIÓN] Servicio detenido correctamente.');
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
